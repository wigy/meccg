/**
 * @module reducer-win-conditions
 *
 * Shared resolver for the dice-roll One Ring win conditions (CoE rule 10.39):
 * A New Ringlord (wh-60, Fallen-wizard) and Challenge the Power (ba-52,
 * Balrog). Both cards are permanent events attached to the player's avatar
 * that roll 2d6 and branch on threshold *bands* into one of four outcomes:
 * eliminate the avatar, discard the card, keep it in play, or win the game.
 *
 * The roll is resolved synchronously (there is no support/interaction window
 * on these rolls), so the modifier — `+1 per sage in the company` and/or
 * `+1 per copy of the card in play` — is summed here and the outcome applied
 * immediately. Tests drive the roll via `GameState.cheatRollTotal`.
 *
 * Triggers funnel here from two places: Challenge the Power rolls when it
 * enters play (`chain-reducer.ts` `resolvePermanentEvent`); A New Ringlord
 * rolls during each of the controller's end-of-turn phases
 * (`reducer-end-of-turn.ts` scanner).
 */

import type { GameState, CardDefinitionId, CardInstanceId } from '../index.js';
import { isCharacterCard, isSiteCard } from '../types/cards.js';
import { Skill } from '../types/common.js';
import type { PlayerState } from '../types/state-player.js';
import type { OnEventEffect, WinConditionRollAction, RollBand, RollModifier } from '../types/effects.js';
import { matchesContext } from '../effects/condition-matcher.js';
import { logDetail, logHeading } from './legal-actions/log.js';
import { defById, diceRollEffect, findPlayerAvatar, getCardEffects, roll2d6, toCardInstance } from './reducer-utils.js';
import { oneRingWin } from './reducer-free-council.js';
import { eliminateCharacter } from './pending-reducers.js';
import type { ReducerResult } from './reducer-utils.js';

// `RollBand` / `RollModifier` now live with the card-effect schema in
// types/effects.ts (a `win-condition-roll` is a discriminated TriggeredAction
// member). Re-exported here so existing importers keep their path.
export type { RollBand, RollModifier } from '../types/effects.js';

/** Count untapped-or-not characters in the avatar's company with the sage skill. */
function countSagesInCompany(state: GameState, player: PlayerState, avatarCharId: CardInstanceId): number {
  const company = player.companies.find(c => c.characters.includes(avatarCharId));
  if (!company) return 0;
  let count = 0;
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    const def = defById(state, char.definitionId);
    if (def && isCharacterCard(def) && (def.skills as readonly string[]).includes(Skill.Sage)) count++;
  }
  return count;
}

/** Count copies of a card definition in play across all players (avatar items + cardsInPlay). */
function countCopiesInPlay(state: GameState, defId: CardDefinitionId): number {
  let count = 0;
  for (const p of state.players) {
    for (const c of p.cardsInPlay) if (c.definitionId === defId) count++;
    for (const char of Object.values(p.characters)) {
      for (const item of char.items) if (item.definitionId === defId) count++;
    }
  }
  return count;
}

/** Sum the dynamic roll modifiers declared on the apply. */
function sumModifiers(
  state: GameState,
  player: PlayerState,
  avatarCharId: CardInstanceId,
  sourceDefId: CardDefinitionId,
  modifiers: readonly RollModifier[],
): number {
  let total = 0;
  for (const m of modifiers) {
    if (m === 'sages-in-company') total += countSagesInCompany(state, player, avatarCharId);
    else if (m === 'copies-in-play') total += countCopiesInPlay(state, sourceDefId);
    else if (m === 'other-copies-in-play') total += Math.max(0, countCopiesInPlay(state, sourceDefId) - 1);
  }
  return total;
}

/** Pick the first band whose bounds the modified total satisfies (declaration order). */
function matchBand(total: number, bands: readonly RollBand[]): RollBand | undefined {
  return bands.find(b =>
    (b.lt === undefined || total < b.lt)
    && (b.lte === undefined || total <= b.lte)
    && (b.gt === undefined || total > b.gt)
    && (b.gte === undefined || total >= b.gte),
  );
}

/**
 * Eliminate the avatar character: remove it from its company and the player's
 * character map, place it in the out-of-play pile (CoE 10.01 — eliminated, not
 * discarded), and disperse everything it held so no instance is lost.
 * Delegates to the canonical {@link eliminateCharacter} machinery: items and
 * allies go to the owner's discard pile, attached hazards (corruption cards)
 * to the hazard owner's discard pile, and followers are freed to general
 * influence or discarded.
 */
function eliminateAvatar(state: GameState, playerIndex: number, avatarCharId: CardInstanceId): GameState {
  const player = state.players[playerIndex];
  const avatar = player.characters[avatarCharId];
  if (!avatar) return state;
  return eliminateCharacter(state, playerIndex, avatarCharId, avatar);
}

/** Move the source card (an item attached to the avatar) to the owner's discard pile. */
function discardSourceFromAvatar(
  state: GameState,
  playerIndex: number,
  avatarCharId: CardInstanceId,
  sourceInstanceId: CardInstanceId,
): GameState {
  const player = state.players[playerIndex];
  const avatar = player.characters[avatarCharId];
  if (!avatar) return state;
  const card = avatar.items.find(i => i.instanceId === sourceInstanceId);
  if (!card) return state;

  const newCharacters = {
    ...player.characters,
    [avatarCharId as string]: { ...avatar, items: avatar.items.filter(i => i.instanceId !== sourceInstanceId) },
  };
  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
    discardPile: [...player.discardPile, toCardInstance(card)],
  };
  return { ...state, players: newPlayers };
}

/**
 * Resolve a `win-condition-roll` apply: roll 2d6 + dynamic modifiers and apply
 * the matching band's outcome. Returns the new state plus a dice-roll effect.
 */
export function resolveWinConditionRoll(
  state: GameState,
  opts: {
    readonly sourceInstanceId: CardInstanceId;
    readonly sourceDefinitionId: CardDefinitionId;
    readonly ownerPlayerIndex: number;
    readonly avatarCharId: CardInstanceId;
    readonly apply: WinConditionRollAction;
  },
): ReducerResult {
  const { sourceInstanceId, sourceDefinitionId, ownerPlayerIndex, avatarCharId, apply } = opts;
  const player = state.players[ownerPlayerIndex];
  const bands: readonly RollBand[] = apply.bands;
  const modifiers: readonly RollModifier[] = apply.rollModifiers ?? [];
  const sourceDef = defById(state, sourceDefinitionId);
  const cardName = sourceDef?.name ?? (sourceDefinitionId as string);

  const modifier = sumModifiers(state, player, avatarCharId, sourceDefinitionId, modifiers);
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const total = roll.die1 + roll.die2 + modifier;
  const rollEffect = diceRollEffect(player.name, roll, cardName);
  logHeading(`${cardName}: ${player.name} rolls ${roll.die1} + ${roll.die2}${modifier ? ` + ${modifier}` : ''} = ${total}`);

  let next: GameState = { ...state, rng, cheatRollTotal };
  const band = matchBand(total, bands);
  if (!band) {
    logDetail(`${cardName}: total ${total} matched no band — no effect`);
    return { state: next, effects: [rollEffect] };
  }

  switch (band.outcome) {
    case 'win-game':
      logHeading(`${cardName}: ${player.name} wins with The One Ring (CoE 10.39)`);
      next = oneRingWin(next, player.id, sourceDefinitionId);
      break;
    case 'eliminate-avatar':
      logDetail(`${cardName}: avatar eliminated (total ${total})`);
      next = eliminateAvatar(next, ownerPlayerIndex, avatarCharId);
      break;
    case 'discard-self':
      logDetail(`${cardName}: discarded (total ${total})`);
      next = discardSourceFromAvatar(next, ownerPlayerIndex, avatarCharId, sourceInstanceId);
      break;
    case 'keep':
      logDetail(`${cardName}: stays in play (total ${total})`);
      break;
    case 'gain-mp': {
      // MEBA Challenge the Power 9–10: card stays in play, owner gains `mp`
      // marshalling points, and The One Ring now affects The Balrog.
      const gained = band.mp ?? 0;
      const owner = next.players[ownerPlayerIndex];
      const players = [...next.players] as [PlayerState, PlayerState];
      players[ownerPlayerIndex] = {
        ...owner,
        bonusMiscMarshallingPoints: (owner.bonusMiscMarshallingPoints ?? 0) + gained,
        oneRingAffectsBalrog: true,
      };
      next = { ...next, players };
      logHeading(`${cardName}: ${owner.name} gains ${gained} MP and The One Ring now affects The Balrog (total ${total})`);
      break;
    }
  }
  return { state: next, effects: [rollEffect] };
}

/**
 * End-of-turn scan for `owner-end-of-turn` win-condition rolls (A New
 * Ringlord wh-60). During each of the controller's end-of-turn phases, any
 * card attached to the avatar declaring an `on-event: owner-end-of-turn`
 * `win-condition-roll` effect whose `when` condition matches the current
 * situation makes the roll (CoE 10.39 / card text): `<6` eliminates the
 * avatar, `>9` wins the game, otherwise nothing. The roll is made once
 * (modified `+1 per copy in play`), not once per copy. Returns null when no
 * roll is triggered.
 *
 * The `when` condition is evaluated against
 * `{ bearer: { itemNames }, site: { siteType, playableResources } }` — the
 * avatar's borne item names and the avatar company's current site. A New
 * Ringlord declares "the Fallen-wizard bears The One Ring at a Ruins & Lairs
 * where Information is playable" this way; a missing `when` rolls
 * unconditionally.
 */
export function scanEndOfTurnWinConditions(state: GameState): ReducerResult | null {
  const playerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  if (playerIndex < 0) return null;
  const player = state.players[playerIndex];

  const avatar = findPlayerAvatar(state, player);
  if (!avatar) return null;

  const company = player.companies.find(c => c.characters.includes(avatar.instanceId));
  const siteDef = company?.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  const context = {
    bearer: {
      itemNames: avatar.items
        .map(i => defById(state, i.definitionId)?.name)
        .filter((name): name is string => name !== undefined),
    },
    site: siteDef && isSiteCard(siteDef)
      ? { siteType: siteDef.siteType, playableResources: siteDef.playableResources ?? [] }
      : {},
  };

  // Find the first attached card declaring an owner-end-of-turn win-condition
  // roll whose declared condition (if any) matches the current situation.
  for (const item of avatar.items) {
    const def = defById(state, item.definitionId);
    if (!def) continue;
    const onEvent = getCardEffects(def).find(
      (e): e is OnEventEffect & { apply: WinConditionRollAction } => e.type === 'on-event'
        && e.event === 'owner-end-of-turn'
        && e.apply.type === 'win-condition-roll',
    );
    if (!onEvent) continue;
    if (onEvent.when && !matchesContext(onEvent.when, context)) {
      logDetail(`${def.name}: owner-end-of-turn win-condition roll gated — condition not met (items: [${context.bearer.itemNames.join(', ')}])`);
      continue;
    }
    logDetail(`${def.name}: owner-end-of-turn win-condition roll condition met for ${player.name} — rolling`);
    return resolveWinConditionRoll(state, {
      sourceInstanceId: item.instanceId,
      sourceDefinitionId: item.definitionId,
      ownerPlayerIndex: playerIndex,
      avatarCharId: avatar.instanceId,
      apply: onEvent.apply,
    });
  }
  return null;
}
