/**
 * @module test-helpers-queries
 *
 * Read-only query helpers over game state used across the test suite: instance
 * lookups (findCharInstanceId, findHandCardId, charIdAt, companyIdAt, handCardId,
 * draftInstId, siteDeckInstId, getOnGuardCard, findInPile, instanceIdsInPlay,
 * definitionIdsInPlay), legal-action queries (viableActions, viableFor,
 * viableOfType, viablePlayCharacterActions, nonViableOfType,
 * nonViablePlayCharacterActions, firstAction, grantedActionsFor, isGrantedAction),
 * constraint lookups (constraintsFromSource, singleActiveConstraint), and
 * baseProwess / phaseStateAs. Split out of test-helpers.ts (re-exported from
 * there); these pure-leaf helpers call no other test helper, importing only the
 * card pool from test-helpers-constants plus engine modules — so nothing imports
 * this module back (no cycle).
 */

import { expect } from 'vitest';
import { computeLegalActions } from '../index.js';
import type { PlayerId, GameState, CardDefinitionId, CardInstanceId, CardInstance, GameAction, PlayCharacterAction, CharacterCard, ActivateGrantedAction, ActiveConstraint, CompanyId, OnGuardCard } from '../index.js';
import type { EvaluatedAction } from '../rules/types.js';
import { pool } from './test-helpers-constants.js';
import type { PileKey } from './test-helpers-constants.js';

/**
 * Find the draft pool instance ID for a given character definition.
 * Looks up the pool in the current draft state for the given player.
 */
export function draftInstId(state: GameState, playerIndex: number, defId: CardDefinitionId): CardInstanceId {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-draft') {
    throw new Error('Not in character draft phase');
  }
  const draftPool = state.phaseState.setupStep.draftState[playerIndex].pool;
  for (const inst of draftPool) {
    if (inst.definitionId === defId) return inst.instanceId;
  }
  throw new Error(`Definition ${defId} not found in player ${playerIndex}'s draft pool`);
}

/**
 * Find the site-deck instance ID for a given site definition in a player's
 * site deck. Mirrors {@link draftInstId} for sites — used by tests that pair a
 * drafted Hidden Haven (wh-75) with a Ruins & Lairs from the site deck.
 */
export function siteDeckInstId(state: GameState, playerIndex: number, defId: CardDefinitionId): CardInstanceId {
  const siteCard = state.players[playerIndex].siteDeck.find(c => c.definitionId === defId);
  if (!siteCard) throw new Error(`Definition ${defId} not found in player ${playerIndex}'s site deck`);
  return siteCard.instanceId;
}

/** Find the instance ID of a character in play by definition ID. */
export function findCharInstanceId(state: GameState, playerIdx: number, defId: CardDefinitionId): CardInstanceId {
  for (const [key, char] of Object.entries(state.players[playerIdx].characters)) {
    if (char.definitionId === defId) return key as CardInstanceId;
  }
  throw new Error(`Character ${defId} not found for player ${playerIdx}`);
}

/**
 * Find the instance ID of an item borne by any character of a player, matched
 * by item definition ID. Throws if no character bears the item. Used by tests
 * that target a specific item in play (e.g. Barrow-blade dm-119, played "with
 * the Dagger of Westernesse").
 */
export function findItemInstanceId(state: GameState, playerIdx: number, itemDefId: CardDefinitionId): CardInstanceId {
  for (const char of Object.values(state.players[playerIdx].characters)) {
    const item = char.items.find(i => i.definitionId === itemDefId);
    if (item) return item.instanceId;
  }
  throw new Error(`Item ${itemDefId as string} not borne by any character for player ${playerIdx}`);
}

/**
 * The **site definitions** a player may currently declare movement to, as
 * definition IDs resolved through that player's site deck.
 *
 * Tests that care *which version* of a location is offered need the definition,
 * not the instance: a Fallen-wizard's location deck may hold both the hero and
 * the minion card for the same place (CoE rule 1.28), and only the definition ID
 * tells the two apart. Destinations not drawn from the site deck (a sibling
 * company's site already in play) resolve to `undefined` and are dropped.
 */
export function movementDestinationDefIds(
  state: GameState,
  playerId: PlayerId,
  playerIdx: number,
): CardDefinitionId[] {
  const deck = state.players[playerIdx].siteDeck;
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === 'plan-movement')
    .map(ea => (ea.action as { destinationSite: CardInstanceId }).destinationSite)
    .map(instId => deck.find(s => s.instanceId === instId)?.definitionId)
    .filter((defId): defId is CardDefinitionId => defId !== undefined);
}

/** Get all viable actions of a specific type for a player. */
export function viableActions(state: GameState, playerId: PlayerId, actionType: string) {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === actionType);
}

/** All viable actions (of any type) for a player. */
export function viableFor(state: GameState, playerId: PlayerId) {
  return computeLegalActions(state, playerId).filter(ea => ea.viable);
}

/**
 * Filter a pre-computed `EvaluatedAction[]` array to viable entries of
 * the given action type. Use when a test inspects both viable and
 * non-viable entries from the same `computeLegalActions` call.
 */
export function viableOfType(
  actions: readonly EvaluatedAction[],
  actionType: string,
): EvaluatedAction[] {
  return actions.filter(ea => ea.viable && ea.action.type === actionType);
}

/**
 * All viable `play-permanent-event` actions a player can take for hand copies
 * of the given card definition. Used by card tests that assert on the offered
 * targets/modes of a specific permanent event (e.g. Wizard's Trove wh-85).
 */
export function viablePermanentEventPlays(
  state: GameState,
  playerId: PlayerId,
  playerIdx: number,
  defId: CardDefinitionId,
): import('../index.js').PlayPermanentEventAction[] {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === 'play-permanent-event')
    .map(ea => ea.action as import('../index.js').PlayPermanentEventAction)
    .filter(a => state.players[playerIdx].hand.find(
      c => c.instanceId === a.cardInstanceId)?.definitionId === defId);
}

/**
 * Filter a pre-computed `EvaluatedAction[]` array to non-viable entries
 * of the given action type.
 */
export function nonViableOfType(
  actions: readonly EvaluatedAction[],
  actionType: string,
): EvaluatedAction[] {
  return actions.filter(ea => !ea.viable && ea.action.type === actionType);
}

/**
 * Narrow `state.phaseState` to a specific phase-state shape without the
 * noisy inline cast. Callers pick the right type via the generic argument.
 */
export function phaseStateAs<T extends GameState['phaseState']>(state: GameState): T {
  return state.phaseState as T;
}

/**
 * The queued `opponent-influence-defend` attempt payload (attacker roll,
 * influencer contribution, opponent GI, region penalty, …), or `undefined` if
 * no such resolution is pending. Used by opponent-influence tests to inspect the
 * computed modifiers before the defender rolls.
 */
export function opponentInfluenceAttempt(state: GameState) {
  const pending = state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
  return pending?.kind.type === 'opponent-influence-defend' ? pending.kind.attempt : undefined;
}

/** Get all viable play-character actions for a player. */
export function viablePlayCharacterActions(state: GameState, playerId: PlayerId) {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === 'play-character')
    .map(ea => ea.action as PlayCharacterAction);
}

/** Get all non-viable play-character actions for a player. */
export function nonViablePlayCharacterActions(state: GameState, playerId: PlayerId) {
  return computeLegalActions(state, playerId)
    .filter(ea => !ea.viable && ea.action.type === 'play-character')
    .map(ea => ea.action as PlayCharacterAction);
}

/** Get the instance ID of a card in a player's hand by position (default: first card). */
export function handCardId(
  state: GameState,
  playerIdx: number,
  index = 0,
): CardInstanceId {
  const card = state.players[playerIdx].hand[index];
  if (!card) throw new Error(`No card at hand[${index}] for player ${playerIdx}`);
  return card.instanceId;
}

/**
 * Find the instance ID of a hand card by definition ID. Throws if no
 * matching card is in the player's hand. Preferred over the common
 * `state.players[X].hand.find(c => c.definitionId === DEF)!.instanceId`
 * boilerplate when you know the card is present.
 */
export function findHandCardId(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
): CardInstanceId {
  const card = state.players[playerIdx].hand.find(c => c.definitionId === defId);
  if (!card) throw new Error(`No hand card with definitionId ${defId as string} for player ${playerIdx}`);
  return card.instanceId;
}

/**
 * Get an on-guard card placed on a company (defaults to the first company
 * and first on-guard card). Throws if the indices are out of range.
 */
export function getOnGuardCard(
  state: GameState,
  playerIdx: number,
  companyIdx = 0,
  ogIdx = 0,
): OnGuardCard {
  const company = state.players[playerIdx].companies[companyIdx];
  if (!company) throw new Error(`No company at companies[${companyIdx}] for player ${playerIdx}`);
  const og = company.onGuardCards[ogIdx];
  if (!og) throw new Error(`No on-guard card at [${companyIdx}][${ogIdx}] for player ${playerIdx}`);
  return og;
}

/** Get the ID of a player's company (default: first company). */
export function companyIdAt(
  state: GameState,
  playerIdx: number,
  companyIdx = 0,
): CompanyId {
  const company = state.players[playerIdx].companies[companyIdx];
  if (!company) throw new Error(`No company at companies[${companyIdx}] for player ${playerIdx}`);
  return company.id;
}

/** Get the instance ID of a character by its position in a company. */
export function charIdAt(
  state: GameState,
  playerIdx: number,
  companyIdx = 0,
  charIdx = 0,
): CardInstanceId {
  const company = state.players[playerIdx].companies[companyIdx];
  if (!company) throw new Error(`No company at companies[${companyIdx}] for player ${playerIdx}`);
  const id = company.characters[charIdx];
  if (!id) throw new Error(`No character at companies[${companyIdx}].characters[${charIdx}] for player ${playerIdx}`);
  return id;
}

/**
 * Find the first card instance in a player's pile matching the given
 * definition or instance ID. Returns undefined if not found.
 */
export function findInPile(
  state: GameState,
  playerIdx: number,
  pile: PileKey,
  idOrDefId: CardDefinitionId | CardInstanceId,
): CardInstance | undefined {
  const list = state.players[playerIdx][pile];
  return list.find(c => c.definitionId === idOrDefId || c.instanceId === idOrDefId);
}

// ─── Convenience action helpers ─────────────────────────────────────────────

/**
 * Get the first viable action of a given type, optionally narrowed by a
 * predicate. Asserts that a match exists and returns the typed action.
 */
export function firstAction<T extends GameAction = GameAction>(
  state: GameState,
  playerId: PlayerId,
  actionType: string,
  predicate?: (action: T) => boolean,
): T {
  const match = findAction<T>(state, playerId, actionType, predicate);
  expect(match).toBeDefined();
  return match!;
}

/**
 * Find the first viable action of a given type (optionally narrowed by a
 * predicate), or undefined if none. The non-asserting variant of firstAction.
 */
export function findAction<T extends GameAction = GameAction>(
  state: GameState,
  playerId: PlayerId,
  actionType: string,
  predicate?: (action: T) => boolean,
): T | undefined {
  const actions = viableActions(state, playerId, actionType);
  const match = predicate
    ? actions.find(ea => predicate(ea.action as T))
    : actions[0];
  return match ? (match.action as T) : undefined;
}

// ─── Convenience assertions ────────────────────────────────────────────────

/** Base prowess of a character card definition (before any effects/items). */
export function baseProwess(defId: CardDefinitionId): number {
  return (pool[defId as string] as CharacterCard).prowess;
}

/**
 * Viable `activate-granted-action` actions emitted for the given character
 * and action ID. Used to check which granted-action variants (e.g. the
 * standard tap and no-tap variants of `remove-self-on-roll`) are currently
 * on offer.
 */
export function grantedActionsFor(
  state: GameState,
  characterId: CardInstanceId,
  actionId: string,
  playerId: PlayerId,
): ActivateGrantedAction[] {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable)
    .map(ea => ea.action)
    .filter((a): a is ActivateGrantedAction =>
      a.type === 'activate-granted-action'
      && a.characterId === characterId
      && a.actionId === actionId);
}

/** Definition IDs of all permanent-type cards in play for a player. */
export function definitionIdsInPlay(state: GameState, playerIdx: number): string[] {
  return state.players[playerIdx].cardsInPlay.map(c => c.definitionId as string);
}

/** Instance IDs of all permanent-type cards in play for a player. */
export function instanceIdsInPlay(state: GameState, playerIdx: number): CardInstanceId[] {
  return state.players[playerIdx].cardsInPlay.map(c => c.instanceId);
}

/** Predicate that matches an `activate-granted-action` with the given actionId. */
export function isGrantedAction(actionId: string) {
  return (action: { type: string; actionId?: string }): boolean =>
    action.type === 'activate-granted-action' && action.actionId === actionId;
}

/**
 * Return the first (and usually only) constraint on the active company.
 * Spells out a common assertion chain so call sites stay short.
 */
export function singleActiveConstraint(state: GameState): ActiveConstraint {
  expect(state.activeConstraints).toHaveLength(1);
  return state.activeConstraints[0];
}

/** Return every active constraint sourced from the given card instance. */
export function constraintsFromSource(
  state: GameState,
  source: CardInstanceId,
): readonly ActiveConstraint[] {
  return state.activeConstraints.filter(c => c.source === source);
}

/**
 * A race identifier found in the card data, with enough context to name the
 * offender in a failure message.
 */
export interface RaceDataValue {
  /** Card definition the value was found on. */
  readonly cardId: string;
  /** The key that owns the value (e.g. `race`, `enemy.race`, `races`). */
  readonly key: string;
  /** The raw value as stored in the JSON. */
  readonly value: string;
}

/**
 * Walk every card definition and collect the values of all race-typed keys —
 * `race`, `enemy.race`, `target.race`, `races`, and every other key whose name
 * mentions a race — no matter how deeply nested inside effects, conditions or
 * `$in`/`$ne` operator objects. Comma-separated multi-race strings (a few
 * hazard creatures belong to several races at once) are split into their
 * members. Used by the race-vocabulary integrity test.
 */
export function collectRaceValuesFromCardData(): RaceDataValue[] {
  const found: RaceDataValue[] = [];
  const visit = (node: unknown, cardId: string, key: string | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, cardId, key);
      return;
    }
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string' && key !== null && /race/i.test(key)) {
        for (const part of node.split(',')) found.push({ cardId, key, value: part });
      }
      return;
    }
    for (const [childKey, childValue] of Object.entries(node)) {
      // Operator wrappers ($in, $ne, ...) carry the enclosing key's meaning.
      visit(childValue, cardId, childKey.startsWith('$') ? key : childKey);
    }
  };
  for (const card of Object.values(pool)) visit(card, card.id as string, null);
  return found;
}

/**
 * Collect every automatic-attack `creatureType` label printed on a card,
 * including the per-site-type variants of `creatureTypeBySiteType`. These are
 * card text (plural, capitalized) rather than race identifiers and reach the
 * engine only through `normalizeCreatureRace`.
 */
export function collectCreatureTypesFromCardData(): RaceDataValue[] {
  const found: RaceDataValue[] = [];
  const visit = (node: unknown, cardId: string, key: string | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, cardId, key);
      return;
    }
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string' && key !== null && /creatureType/i.test(key)) {
        found.push({ cardId, key, value: node });
      }
      return;
    }
    for (const [childKey, childValue] of Object.entries(node)) {
      visit(childValue, cardId, childKey);
    }
  };
  for (const card of Object.values(pool)) visit(card, card.id as string, null);
  return found;
}
