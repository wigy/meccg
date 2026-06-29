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
import { Skill, SiteType } from '../types/common.js';
import type { PlayerState } from '../types/state-player.js';
import type { TriggeredAction, OnEventEffect } from '../types/effects.js';
import { THE_ONE_RING } from '../card-ids.js';
import { logDetail, logHeading } from './legal-actions/log.js';
import { defById, diceRollEffect, findPlayerAvatar, getCardEffects, roll2d6, toCardInstance } from './reducer-utils.js';
import { oneRingWin } from './reducer-free-council.js';
import type { ReducerResult } from './reducer-utils.js';

/** One threshold band of a {@link TriggeredAction.bands} roll table. */
export interface RollBand {
  /** Match when the modified total is strictly less than this. */
  readonly lt?: number;
  /** Match when the modified total is ≤ this. */
  readonly lte?: number;
  /** Match when the modified total is strictly greater than this. */
  readonly gt?: number;
  /** Match when the modified total is ≥ this. */
  readonly gte?: number;
  /** What happens when this band matches. */
  readonly outcome: 'eliminate-avatar' | 'discard-self' | 'keep' | 'win-game';
}

/** Dynamic roll modifiers summed into the 2d6 total. */
export type RollModifier = 'sages-in-company' | 'copies-in-play' | 'other-copies-in-play';

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
 * discarded), and move every attached item/ally to the player's discard pile so
 * no instance is lost.
 */
function eliminateAvatar(state: GameState, playerIndex: number, avatarCharId: CardInstanceId): GameState {
  const player = state.players[playerIndex];
  const avatar = player.characters[avatarCharId];
  if (!avatar) return state;

  const newCharacters = { ...player.characters };
  delete newCharacters[avatarCharId];

  const discarded = [
    ...avatar.items.map(toCardInstance),
    ...avatar.allies.map(toCardInstance),
  ];

  const newCompanies = player.companies.map(c => ({
    ...c,
    characters: c.characters.filter(id => id !== avatarCharId),
  }));

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = {
    ...player,
    characters: newCharacters,
    companies: newCompanies,
    outOfPlayPile: [...player.outOfPlayPile, toCardInstance(avatar)],
    discardPile: [...player.discardPile, ...discarded],
  };
  return { ...state, players: newPlayers };
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
    readonly apply: TriggeredAction;
  },
): ReducerResult {
  const { sourceInstanceId, sourceDefinitionId, ownerPlayerIndex, avatarCharId, apply } = opts;
  const player = state.players[ownerPlayerIndex];
  const bands = (apply.bands ?? []) as readonly RollBand[];
  const modifiers = (apply.rollModifiers ?? []) as readonly RollModifier[];
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
  }
  return { state: next, effects: [rollEffect] };
}

/** True when the site is a Ruins & Lairs where Information is playable. */
function isInformationRuinsAndLairs(state: GameState, siteDefId: CardDefinitionId): boolean {
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef)) return false;
  return siteDef.siteType === SiteType.RuinsAndLairs
    && (siteDef.playableResources ?? []).includes('information' as never);
}

/**
 * End-of-turn scan for A New Ringlord (wh-60). During each of the controller's
 * end-of-turn phases, if the Fallen-wizard bears The One Ring at a Ruins &
 * Lairs where Information is playable, make the roll (CoE 10.39 / card text):
 * `<6` eliminates the Fallen-wizard, `>9` wins the game, otherwise nothing.
 * The roll is made once (modified `+1 per A New Ringlord in play`), not once
 * per copy. Returns null when no roll is triggered.
 */
export function scanEndOfTurnWinConditions(state: GameState): ReducerResult | null {
  const playerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  if (playerIndex < 0) return null;
  const player = state.players[playerIndex];

  const avatar = findPlayerAvatar(state, player);
  if (!avatar) return null;

  // Avatar must bear The One Ring.
  if (!avatar.items.some(i => i.definitionId === THE_ONE_RING)) return null;

  // Avatar's company must be at a Ruins & Lairs where Information is playable.
  const company = player.companies.find(c => c.characters.includes(avatar.instanceId));
  const siteDefId = company?.currentSite?.definitionId;
  if (!siteDefId || !isInformationRuinsAndLairs(state, siteDefId)) return null;

  // Find the first attached card declaring an owner-end-of-turn win-condition roll.
  for (const item of avatar.items) {
    const def = defById(state, item.definitionId);
    if (!def) continue;
    const onEvent = getCardEffects(def).find(
      (e): e is OnEventEffect => e.type === 'on-event'
        && e.event === 'owner-end-of-turn'
        && e.apply.type === 'win-condition-roll',
    );
    if (!onEvent) continue;
    logDetail(`A New Ringlord end-of-turn scan: ${player.name}'s Fallen-wizard bears The One Ring at an Information R&L — rolling`);
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
