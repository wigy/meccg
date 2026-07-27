/**
 * @module combat-hazard-play
 *
 * Handles playing a hazard *during* combat (`handleCombatPlayHazard`) and the
 * take-prisoner capture mechanics it can trigger (`findTakePrisonerHazard`,
 * `bindPrisoner`, `applyTakePrisoner`, `applyTakePrisonerAtSite`), plus the
 * shared `getAttackSourceCard` lookup. Extracted wholesale from
 * `reducer-combat.ts`: this cluster calls no other `reducer-combat` function,
 * so relocating it shrinks the combat god-module without forming a cycle —
 * `reducer-combat` imports these handlers one-way from here.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, CombatState, GameAction, CardInstanceId, CardDefinition, HazardHost } from '../index.js';
import type { CharacterInPlay } from '../types/state-cards.js';
import type { ReducerResult } from './reducer-utils.js';
import type { TakePrisonerEffect } from '../types/effects.js';
import { getPlayerIndex } from '../state-utils.js';
import { isSiteCard, isCharacterCard } from '../types/cards.js';
import { CardStatus, Race } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId } from '../types/state.js';
import { defById, findById, getCardEffects, getOnEventEffects, removeById, toCardInstance, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { isWardedAgainst } from './effects/index.js';
import { addConstraint } from './pending.js';

/**
 * Look up the card definition for the attack source in combat.
 * For automatic attacks, returns the site card. For creature attacks,
 * returns the creature card definition.
 */
export function getAttackSourceCard(
  state: GameState,
  combat: CombatState,
): CardDefinition | undefined {
  if (combat.attackSource.type === 'automatic-attack') {
    const siteInstanceId = combat.attackSource.siteInstanceId;
    const siteDefId = resolveInstanceId(state, siteInstanceId);
    if (!siteDefId) return undefined;
    const siteDef = defById(state, siteDefId);
    return siteDef && isSiteCard(siteDef) ? siteDef : undefined;
  }
  if (combat.attackSource.type === 'creature' || combat.attackSource.type === 'played-auto-attack') {
    const creatureDefId = resolveInstanceId(state, combat.attackSource.instanceId);
    if (!creatureDefId) return undefined;
    return defById(state, creatureDefId);
  }
  return undefined;
}

/**
 * Play a hazard permanent-event from the attacker's hand during a
 * combat window (currently `resolve-strike`). Attaches the card to the
 * defender identified by `targetCharacterId` and applies any
 * `self-enters-play-combat` on-event effects it declares — notably
 * `modify-current-strike-prowess`, which adjusts the current strike's
 * prowess (Dragon's Curse: -1).
 *
 * The card's `play-window`, `play-condition` (combat-creature-race),
 * and `play-target.filter` are evaluated by the legal-action emitter
 * in `legal-actions/combat.ts`; the reducer trusts the action to be
 * legal and focuses on state transitions.
 */
export function handleCombatPlayHazard(
  state: GameState,
  action: GameAction,
  combat: CombatState,
): ReducerResult {
  if (action.type !== 'play-hazard') return wrongActionType(state, action, 'play-hazard');
  if (combat.phase !== 'resolve-strike') {
    return { state, error: `play-hazard during combat is only valid in resolve-strike (current: ${combat.phase})` };
  }
  if (action.player !== combat.attackingPlayerId) {
    return { state, error: 'only the attacking player may play hazards during combat' };
  }

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const handCard = findById(hazardPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'card not in hand' };
  const def = defById(state, handCard.definitionId);

  // Left Behind (td-41): a hazard short-event that, "following the attack",
  // peels a non-Wizard character off into a separate company. It is not a
  // permanent-event, so it is handled before the permanent-event gate below.
  const leftBehindEffect = def
    ? getCardEffects(def).find((e): e is import('../types/effects.js').LeftBehindSplitEffect => e.type === 'left-behind-split')
    : undefined;
  if (leftBehindEffect) {
    return handleLeftBehindPlay(state, action, combat, handCard, leftBehindEffect);
  }

  if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'permanent') {
    return { state, error: 'only hazard permanent-events may be played during combat' };
  }

  const defenderIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defenderPlayer = state.players[defenderIndex];
  const targetCharId = action.targetCharacterId;
  if (!targetCharId) return { state, error: 'targetCharacterId required for combat hazard play' };
  const targetChar = defenderPlayer.characters[targetCharId];
  if (!targetChar) return { state, error: 'target character not in defending player' };

  // Remove card from hand
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
  let newState: GameState = updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand }));

  // CoE rule 8.12: hazard actions taken during a strike sequence in the
  // opponent's M/H phase still count against the company's hazard limit.
  // (Combat during the site phase has no hazard-limit bookkeeping.)
  if (newState.phaseState.phase === Phase.MovementHazard) {
    const mhState = newState.phaseState;
    const played = (mhState.hazardsPlayedThisCompany ?? 0) + 1;
    logDetail(`Combat play-hazard: counts against hazard limit (${played})`);
    newState = {
      ...newState,
      phaseState: { ...mhState, hazardsPlayedThisCompany: played },
    };
  }

  // Ward check: a matching ward on the target discards the curse to
  // the hazard player's discard pile instead of attaching it.
  if (isWardedAgainst(newState, defenderIndex, targetCharId, def)) {
    logDetail(`Combat play-hazard: "${def.name}" cancelled by ward on target — routing to attacker's discard`);
    newState = updatePlayer(newState, hazardIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, toCardInstance(handCard)],
    }));
    return { state: newState };
  }

  // Attach to target's hazards
  logDetail(`Combat play-hazard: attaching "${def.name}" to ${targetCharId as string}`);
  newState = updatePlayer(newState, defenderIndex, p => updateCharacter(p, targetCharId as string, c => ({
    ...c,
    hazards: [...c.hazards, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }],
  })));

  // Apply self-enters-play-combat on-event effects declared by the card.
  // Currently supports `modify-current-strike-prowess` which adjusts
  // the current strike's prowess via combat.strikeAssignments[i].strikeProwessBonus.
  // The bonus is added to the defender's effective prowess (a -1 to
  // the attacker's strike prowess is equivalent to +1 to the defender),
  // so the data carries a negative `value` and the reducer flips sign.
  {
    for (const eff of getOnEventEffects(def, 'self-enters-play-combat')) {
      if (eff.apply.type === 'modify-current-strike-prowess') {
        const strikeDelta = eff.apply.value ?? 0;
        const defenderProwessDelta = -strikeDelta;
        logDetail(`Combat play-hazard: "${def.name}" modifies current strike's prowess by ${strikeDelta} (defender +${defenderProwessDelta})`);
        const newAssignments = combat.strikeAssignments.map((a, i) =>
          i === combat.currentStrikeIndex
            ? { ...a, strikeProwessBonus: (a.strikeProwessBonus ?? 0) + defenderProwessDelta }
            : a,
        );
        newState = { ...newState, combat: { ...combat, strikeAssignments: newAssignments } };
      }
    }
  }

  return { state: newState };
}

/**
 * Left Behind (td-41): the attacking (hazard) player plays this short-event on a
 * non-Wizard character in the defending company while it is facing an attack of
 * five or more strikes. The card does not modify the current strike; instead it
 * schedules a {@link PostAttackEffect} with `leftBehindSplit: true` so that, at
 * combat finalization, the character is peeled off into a separate company (see
 * `applyPostAttackEffects`). The card itself is discarded; playing it counts
 * against the company's hazard limit (rule 8.12).
 *
 * Playability (attacker's window, resolve-strike phase, five-strike threshold,
 * non-Wizard target) is enforced by the legal-action emitter `leftBehindActions`
 * in `legal-actions/combat.ts`; this reducer trusts the action and focuses on
 * state transitions.
 */
function handleLeftBehindPlay(
  state: GameState,
  action: Extract<GameAction, { type: 'play-hazard' }>,
  combat: CombatState,
  handCard: import('../types/state.js').CardInstance,
  effect: import('../types/effects.js').LeftBehindSplitEffect,
): ReducerResult {
  const attackStrikes = combat.strikesPerAttack ?? combat.strikesTotal;
  if (attackStrikes < effect.minStrikes) {
    return { state, error: `Left Behind requires an attack of ${effect.minStrikes}+ strikes (this attack has ${attackStrikes})` };
  }

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const defenderIndex = getPlayerIndex(state, combat.defendingPlayerId);
  const defenderPlayer = state.players[defenderIndex];

  const targetCharId = action.targetCharacterId;
  if (!targetCharId) return { state, error: 'targetCharacterId required for Left Behind' };
  const targetChar = defenderPlayer.characters[targetCharId];
  if (!targetChar) return { state, error: 'Left Behind target not in defending player' };
  const targetDef = defById(state, targetChar.definitionId);
  if (!targetDef || !isCharacterCard(targetDef)) return { state, error: 'Left Behind target is not a character' };
  if (targetDef.race === Race.Wizard) return { state, error: 'Left Behind cannot target a Wizard' };
  // The target must belong to the company under attack.
  const defendingCompany = defenderPlayer.companies.find(c => c.id === combat.companyId);
  if (!defendingCompany || !defendingCompany.characters.includes(targetCharId)) {
    return { state, error: 'Left Behind target is not in the company facing the attack' };
  }

  // Remove the card from hand and discard it (a short-event resolves and is spent).
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
  let newState: GameState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
  }));

  // Rule 8.12: hazard actions during a strike sequence in the opponent's M/H
  // phase count against the company's hazard limit.
  if (newState.phaseState.phase === Phase.MovementHazard) {
    const mhState = newState.phaseState;
    const played = (mhState.hazardsPlayedThisCompany ?? 0) + 1;
    logDetail(`Left Behind: counts against hazard limit (${played})`);
    newState = { ...newState, phaseState: { ...mhState, hazardsPlayedThisCompany: played } };
  }

  // Schedule the post-attack split. Guard against duplicates on the same target.
  const already = (combat.postAttackEffects ?? []).some(
    e => e.targetCharacterId === targetCharId && e.leftBehindSplit,
  );
  if (already) {
    logDetail(`Left Behind: ${targetDef.name} already scheduled to split — no-op`);
    return { state: newState };
  }
  logDetail(`Left Behind: scheduling ${targetDef.name} to split off into a separate company following the attack`);
  newState = {
    ...newState,
    combat: {
      ...combat,
      postAttackEffects: [
        ...(combat.postAttackEffects ?? []),
        { targetCharacterId: targetCharId, leftBehindSplit: true },
      ],
    },
  };
  return { state: newState };
}

// ---- Prisoner-taking helpers (Rule 8.35) ----

/**
 * Search `hazards` for a hazard card that carries a `take-prisoner` effect.
 * Returns the host card instance and the effect, or null if not found.
 */
export function findTakePrisonerHazard(
  state: GameState,
  _defPlayerIndex: number,
  hazards: readonly import('../types/state-cards.js').CardInPlay[],
): { hostCard: import('../types/state-cards.js').CardInstance; effect: TakePrisonerEffect } | null {
  for (const h of hazards) {
    const def = defById(state, h.definitionId);
    const eff = getCardEffects(def).find(
      (e): e is TakePrisonerEffect => e.type === 'take-prisoner',
    );
    if (eff) return { hostCard: toCardInstance(h), effect: eff };
  }
  return null;
}

/**
 * Apply the prisoner-taking outcome for a character (CoE rule 8.35):
 *
 * 1. Draw the rescue site card from the hazard player's location deck
 *    (first matching site type found).
 * 2. Discard all non-ring items from the prisoner immediately.
 * 3. Revert followers to general influence (mind subtraction deferred
 *    to the next org phase — tracked by the constraint).
 * 4. Add `character-is-prisoner` active constraint on the character.
 * 5. Add the HazardHost record to `state.hazardHosts`.
 * 6. Remove the host card from the character's `hazards` list
 *    (it now lives in the HazardHost record).
 */
/**
 * Bind a defeated character as a prisoner (CoE 8.35): discard its non-ring
 * items, revert its followers (and itself) to general influence, add a
 * `character-is-prisoner` constraint pointing at `hostCard`, and append a
 * {@link HazardHost} record. Shared by the location-deck rescue-site path
 * ({@link applyTakePrisoner}) and the Troll-purse at-site path
 * ({@link applyTakePrisonerAtSite}); `removeHostFromHazards` strips the host
 * from the prisoner's hazards when the host moves into the HazardHost record
 * (the at-site host stays in cardsInPlay instead).
 */
function bindPrisoner(
  state: GameState,
  defPlayerIndex: number,
  charInstanceId: CardInstanceId,
  charData: CharacterInPlay,
  hostCard: import('../types/state-cards.js').CardInstance,
  rescueSiteCard: import('../types/state-cards.js').CardInstance,
  ownedBy: import('../types/common.js').PlayerId,
  removeHostFromHazards: boolean,
  logPrefix: string,
): GameState {
  const retainedItems = charData.items.filter(item => {
    const itemDef = defById(state, item.definitionId);
    return itemDef && 'cardType' in itemDef
      && typeof (itemDef as { cardType: string }).cardType === 'string'
      && (itemDef as { cardType: string }).cardType.includes('ring-item');
  });
  const discardedItems = charData.items.filter(item => !retainedItems.includes(item));
  if (discardedItems.length > 0) {
    logDetail(`${logPrefix}: discarding ${discardedItems.length} non-ring item(s) from prisoner ${charInstanceId as string}`);
  }
  const followerIds = charData.followers;
  const newCharData = {
    ...charData,
    items: retainedItems,
    ...(removeHostFromHazards ? { hazards: charData.hazards.filter(h => h.instanceId !== hostCard.instanceId) } : {}),
    controlledBy: 'general' as const,
  };
  let newState = updatePlayer(state, defPlayerIndex, p => {
    const updatedChars: Record<CardInstanceId, CharacterInPlay> = { ...p.characters };
    updatedChars[charInstanceId] = newCharData;
    for (const followerId of followerIds) {
      const follower = updatedChars[followerId];
      if (follower && follower.controlledBy === charInstanceId) {
        // Prisoner-taking happens during combat, outside the controlling
        // player's organization phase — defer the freed follower's mind
        // subtraction from general influence (CoE rule 3.13).
        updatedChars[followerId] = { ...follower, controlledBy: 'general', influenceUnsubtracted: true };
      }
    }
    return { ...p, characters: updatedChars, discardPile: [...p.discardPile, ...discardedItems.map(i => toCardInstance(i))] };
  });
  newState = addConstraint(newState, {
    source: hostCard.instanceId,
    sourceDefinitionId: hostCard.definitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'character', characterId: charInstanceId },
    kind: { type: 'character-is-prisoner', hostInstanceId: hostCard.instanceId },
  });
  const newHost: HazardHost = { hostCard, rescueSiteCard, prisoners: [charInstanceId], ownedBy };
  return { ...newState, hazardHosts: [...newState.hazardHosts, newHost] };
}

export function applyTakePrisoner(
  state: GameState,
  defPlayerIndex: number,
  charInstanceId: CardInstanceId,
  takePrisonerResult: { hostCard: import('../types/state-cards.js').CardInstance; effect: TakePrisonerEffect },
): GameState {
  const { hostCard, effect } = takePrisonerResult;
  const hazardPlayerIndex = 1 - defPlayerIndex;
  const hazardPlayer = state.players[hazardPlayerIndex];

  // Find the rescue site card in the hazard player's location deck.
  const rescueSiteIdx = hazardPlayer.siteDeck.findIndex(site => {
    const siteDef = defById(state, site.definitionId);
    if (!siteDef || !('siteType' in siteDef)) return false;
    return effect.rescueSiteTypes.includes((siteDef as { siteType: string }).siteType);
  });
  if (rescueSiteIdx === -1) {
    // No rescue site available — this shouldn't happen if legal-action checks passed,
    // but handle gracefully by skipping prisoner-taking.
    logDetail(`take-prisoner: no rescue site found in hazard player's location deck — skipping`);
    return state;
  }

  const rescueSiteCard = hazardPlayer.siteDeck[rescueSiteIdx];
  logDetail(`take-prisoner: rescue site is ${rescueSiteCard.definitionId as string} (drawn from hazard player's location deck)`);

  // Remove rescue site from hazard player's location deck.
  const newHazardSiteDeck = [
    ...hazardPlayer.siteDeck.slice(0, rescueSiteIdx),
    ...hazardPlayer.siteDeck.slice(rescueSiteIdx + 1),
  ];

  const defPlayer = state.players[defPlayerIndex];
  const charData = defPlayer.characters[charInstanceId];
  if (!charData) return state;

  let newState = bindPrisoner(
    state, defPlayerIndex, charInstanceId, charData,
    hostCard, toCardInstance(rescueSiteCard), hazardPlayer.id, true, 'take-prisoner',
  );
  // Remove the rescue site from the hazard player's location deck.
  newState = updatePlayer(newState, hazardPlayerIndex, p => ({ ...p, siteDeck: newHazardSiteDeck }));

  logDetail(`take-prisoner: ${charInstanceId as string} is now a prisoner of ${hostCard.instanceId as string} at rescue site ${rescueSiteCard.definitionId as string}`);
  return newState;
}

/**
 * Apply the prisoner-taking outcome for a Troll-purse (dm-95) re-faced strike.
 *
 * Unlike {@link applyTakePrisoner}, the rescue site is the bound site itself
 * (the prisoner is "taken prisoner at the site") rather than a site drawn from
 * the hazard player's location deck, and the host card (Troll-purse) stays in
 * play attached to the site — it is a persistent trap that may take further
 * prisoners. As with the general prisoner rule (CoE 8.35) the prisoner's
 * non-ring items are discarded, followers revert to general influence, a
 * `character-is-prisoner` constraint is added, and a HazardHost record is
 * created so the prisoner is tracked (the rescue-attack equals the site's
 * automatic-attacks at the time of rescue).
 */
export function applyTakePrisonerAtSite(
  state: GameState,
  defPlayerIndex: number,
  charInstanceId: CardInstanceId,
  hostInstanceId: CardInstanceId,
  siteInstanceId: CardInstanceId,
): GameState {
  const hazardPlayerIndex = 1 - defPlayerIndex;
  const hazardPlayerState = state.players[hazardPlayerIndex];
  const defPlayer = state.players[defPlayerIndex];
  const charData = defPlayer.characters[charInstanceId];
  if (!charData) return state;

  // The host (Troll-purse) stays in the hazard player's cardsInPlay.
  const hostInPlay = hazardPlayerState.cardsInPlay.find(c => c.instanceId === hostInstanceId);
  if (!hostInPlay) {
    logDetail(`take-prisoner (Troll-purse): host ${hostInstanceId as string} not found in play — skipping`);
    return state;
  }
  const hostCard = toCardInstance(hostInPlay);

  // The rescue site is the bound site itself.
  const siteDefId = resolveInstanceId(state, siteInstanceId);
  if (!siteDefId) {
    logDetail(`take-prisoner (Troll-purse): site ${siteInstanceId as string} not resolvable — skipping`);
    return state;
  }
  const rescueSiteCard = { instanceId: siteInstanceId, definitionId: siteDefId };

  const newState = bindPrisoner(
    state, defPlayerIndex, charInstanceId, charData,
    hostCard, rescueSiteCard, hazardPlayerState.id, false, 'take-prisoner (Troll-purse)',
  );

  logDetail(`take-prisoner (Troll-purse): ${charInstanceId as string} is now a prisoner at site ${siteDefId as string}`);
  return newState;
}
