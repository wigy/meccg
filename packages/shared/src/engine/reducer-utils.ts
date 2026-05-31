/**
 * @module reducer-utils
 *
 * Shared utility functions used by multiple reducer phase handlers.
 * Includes state cloning, dice rolling, deck exhaustion, company management,
 * and card effect resolution helpers.
 */

import type { GameState, PlayerState, PlayerId, CardInstanceId, CardInstance, CardDefinitionId, CompanyId, GameAction, Company, CharacterInPlay, CardDefinition } from '../index.js';
import type { TwoDiceSix, DieRoll, GameEffect, DiceRollEffect } from '../index.js';
import type { CardEffect, OnEventEffect, Condition, HazardMaintenanceEffect } from '../types/effects.js';
import type { ResolutionScope } from '../types/pending.js';
import { shuffle, nextInt, CardStatus, Phase, getPlayerIndex, isSiteCard, isAvatarCharacter, GENERAL_INFLUENCE, Race, isCharacterCard, isAllyCard } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { matchesCondition } from '../effects/index.js';
import { resolveDef } from './effects/index.js';
import { enqueueCorruptionCheck } from './pending.js';

/**
 * Result of applying a {@link GameAction} to a {@link GameState}.
 * If `error` is present, `state` is returned unchanged.
 */
export interface ReducerResult {
  readonly state: GameState;
  /** Human-readable error message if the action was rejected. */
  readonly error?: string;
  /** Visual effects to broadcast to clients (dice rolls, etc.). */
  readonly effects?: readonly GameEffect[];
}


/**
 * Roll 2d6, respecting an optional cheat roll target. If `cheatRollTotal` is
 * set on the state, produces dice that sum to that total (using RNG to pick
 * the split) and clears the cheat field. Otherwise uses normal RNG.
 *
 * Returns the roll, updated RNG, and the new cheatRollTotal (null after use).
 */
export function roll2d6(state: GameState): { roll: TwoDiceSix; rng: typeof state.rng; cheatRollTotal: number | null } {
  let rng = state.rng;
  let d1: DieRoll;
  let d2: DieRoll;
  let cheatRollTotal: number | null = state.cheatRollTotal;

  if (cheatRollTotal !== null && cheatRollTotal >= 2 && cheatRollTotal <= 12) {
    // Pick a random valid split for the target total
    const minD1 = Math.max(1, cheatRollTotal - 6);
    const maxD1 = Math.min(6, cheatRollTotal - 1);
    const range = maxD1 - minD1 + 1;
    const [pick, rng2] = nextInt(rng, range);
    rng = rng2;
    d1 = (minD1 + pick) as DieRoll;
    d2 = (cheatRollTotal - d1) as DieRoll;
    cheatRollTotal = null;  // consumed
  } else {
    const [d1raw, rng2] = nextInt(rng, 6);
    const [d2raw, rng3] = nextInt(rng2, 6);
    rng = rng3;
    d1 = (d1raw + 1) as DieRoll;
    d2 = (d2raw + 1) as DieRoll;
  }

  return { roll: { die1: d1, die2: d2 }, rng, cheatRollTotal };
}

/**
 * Build a `dice-roll` visual effect for a 2d6 result. Centralizes the
 * repeated `{ effect: 'dice-roll', playerName, die1: roll.die1, die2: roll.die2, label }`
 * object literal used throughout the reducers to broadcast roll animations.
 */
export function diceRollEffect(playerName: string, roll: TwoDiceSix, label: string): DiceRollEffect {
  return { effect: 'dice-roll', playerName, die1: roll.die1, die2: roll.die2, label };
}

/**
 * Build the {@link ResolutionScope} for a corruption check or other resolution
 * enqueued during a company's combat. Companies resolve hazards in the
 * movement/hazard phase and automatic attacks in the site phase; each phase
 * has its own subphase scope so the queue is swept at the correct boundary.
 * Centralizes the repeated `phase === MovementHazard ? company-mh-subphase :
 * company-site-subphase` selection used across the combat reducers.
 */
export function companySubphaseScope(phase: Phase, companyId: CompanyId): ResolutionScope {
  return phase === Phase.MovementHazard
    ? { kind: 'company-mh-subphase', companyId }
    : { kind: 'company-site-subphase', companyId };
}

/** Creates a mutable copy of the 2-player tuple, preserving the tuple type. */
export function clonePlayers(state: GameState): [PlayerState, PlayerState] {
  return [{ ...state.players[0] }, { ...state.players[1] }];
}

/**
 * Look up a player by their {@link PlayerId}, or `undefined` if no player
 * matches. Centralizes the ubiquitous `state.players.find(p => p.id === id)`
 * lookup. A `null`/`undefined` id (e.g. `state.activePlayer` before a player
 * is active) never matches and yields `undefined`, mirroring the raw `.find`
 * behavior. Callers that know the id is valid (e.g. it came from a validated
 * action or phase state) can assert the result with `!`.
 */
export function playerById(state: GameState, id: PlayerId | null | undefined): PlayerState | undefined {
  return state.players.find(p => p.id === id);
}

/**
 * Look up the active player's state — the player whose id matches
 * `state.activePlayer`. Centralizes the ubiquitous
 * `playerById(state, state.activePlayer)` lookup, mirroring {@link hazardPlayer}
 * for the active side.
 *
 * Returns `undefined` when no player is active yet (e.g. before setup assigns
 * the active player), matching the underlying {@link playerById} behavior.
 * Callers that need the player must handle the `undefined` case explicitly.
 */
export function activePlayerState(state: GameState): PlayerState | undefined {
  return playerById(state, state.activePlayer);
}

/**
 * Look up the hazard player — the non-active player in a two-player game.
 * Centralizes the ubiquitous `state.players.find(p => p.id !== state.activePlayer)!`
 * lookup used wherever a hazard/opponent reference is needed (auto-attacks,
 * on-guard reveals, attacker-chosen defenders, etc.).
 *
 * `activePlayerId` defaults to `state.activePlayer`, but can be passed
 * explicitly when the active player is tracked in a local variable rather
 * than on the state. The result is asserted non-null because every game has
 * exactly two players and the active player is always one of them.
 */
export function hazardPlayer(state: GameState, activePlayerId: PlayerId | null | undefined = state.activePlayer): PlayerState {
  return state.players.find(p => p.id !== activePlayerId)!;
}

/**
 * Immutably update a single player's state.
 *
 * Replaces the common 4-line pattern:
 *   const newPlayers = clonePlayers(state);
 *   newPlayers[i] = { ...player, field: value };
 *   return { ...state, players: newPlayers };
 * with:
 *   return updatePlayer(state, i, p => ({ ...p, field: value }));
 */
export function updatePlayer(
  state: GameState,
  playerIndex: number,
  updater: (p: PlayerState) => PlayerState,
): GameState {
  const players: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  players[playerIndex] = updater(state.players[playerIndex]);
  return { ...state, players };
}

/**
 * Immutably update a single character in a player's `characters` map.
 * Returns the player unchanged if `charId` is not found.
 */
export function updateCharacter(
  player: PlayerState,
  charId: CardInstanceId | string,
  updater: (c: CharacterInPlay) => CharacterInPlay,
): PlayerState {
  const key = charId as string;
  const char = player.characters[key];
  if (!char) return player;
  return {
    ...player,
    characters: { ...player.characters, [key]: updater(char) },
  };
}

/**
 * Produce a {@link ReducerResult} rejecting an action whose `type` did not
 * match the expected value. When `context` is supplied the message names the
 * step the rejection happened in (e.g. `during draw-cards step`).
 */
export function wrongActionType(
  state: GameState,
  action: GameAction,
  expected: GameAction['type'],
  context?: string,
): ReducerResult {
  const msg = context
    ? `Expected '${expected}' during ${context}, got '${action.type}'`
    : `Expected ${expected} action`;
  return { state, error: msg };
}

/**
 * Extract the minimal `{ instanceId, definitionId }` tuple from any card-like
 * object (CardInstance, CardInPlay, CharacterInPlay, etc.). Used when moving
 * a card between piles — downstream piles only care about the tuple, not
 * whatever status/attachment bookkeeping the source location carried.
 */
export function toCardInstance(c: { readonly instanceId: CardInstance['instanceId']; readonly definitionId: CardInstance['definitionId'] }): CardInstance {
  return { instanceId: c.instanceId, definitionId: c.definitionId };
}

/**
 * Look up a card definition from the card pool by its {@link CardDefinitionId}.
 *
 * The pool is keyed by plain `string`, so indexing it with a branded
 * `CardDefinitionId` otherwise requires an `as string` cast at every call site.
 * This helper centralizes that cast and the intent ("get the definition for this
 * id"). Returns `undefined` for an unknown definition id. Complements
 * {@link resolveDef}, which resolves a definition from a {@link CardInstanceId}.
 */
export function defById(state: GameState, definitionId: CardDefinitionId): CardDefinition | undefined {
  return state.cardPool[definitionId as string];
}

/**
 * Look up a card's display name from the card pool by its definition ID.
 *
 * Every {@link CardDefinition} carries a `name`, so the only failure case is
 * an unknown definition ID. When the card is not in the pool, returns
 * `fallback` if provided, otherwise the definition ID as a string. Used
 * throughout the engine for human-readable log labels.
 */
export function cardName(
  state: GameState,
  definitionId: CardDefinitionId,
  fallback?: string,
): string {
  return defById(state, definitionId)?.name ?? fallback ?? (definitionId as string);
}

/**
 * Evaluate a DSL {@link Condition} filter against a {@link CardDefinition}.
 *
 * Card definitions are matched as plain objects so that filters can reference
 * any definition field (name, race, type, keywords, …) via dot paths. The
 * {@link matchesCondition} context type is the structural `Record<string, unknown>`
 * shape, so a definition needs a structural cast at the call boundary; this
 * helper centralizes that cast and the intent ("does this card match the filter?").
 */
export function matchesDefinition(def: CardDefinition, condition: Condition): boolean {
  return matchesCondition(condition, def as unknown as Record<string, unknown>);
}

/**
 * Find the first element matching `id` in a read-only array of card-like
 * objects, or `undefined` if none matches. Centralizes the ubiquitous
 * `pile.find(c => c.instanceId === id)` lookup used to locate a card instance
 * within a specific pile/zone. Complements {@link removeById}.
 */
export function findById<T extends { readonly instanceId: CardInstance['instanceId'] }>(
  arr: readonly T[],
  id: CardInstance['instanceId'],
): T | undefined {
  return arr.find(c => c.instanceId === id);
}

/**
 * Remove the first element matching `id` from a read-only array of card-like
 * objects. Returns the unchanged array reference if no match is found, so
 * callers can short-circuit when nothing changed.
 */
export function removeById<T extends { readonly instanceId: CardInstance['instanceId'] }>(
  arr: readonly T[],
  id: CardInstance['instanceId'],
): readonly T[] {
  const idx = arr.findIndex(c => c.instanceId === id);
  if (idx === -1) return arr;
  return [...arr.slice(0, idx), ...arr.slice(idx + 1)];
}

/**
 * Returns all `on-event` effects from a card definition that match `eventName`.
 * Handles `null`/`undefined` and cards without an `effects` field. Replaces the
 * verbose triple-check `!def || !('effects' in def) || !def.effects` + manual
 * `if (effect.type !== 'on-event') continue; if (effect.event !== X) continue;` pattern.
 */
export function getOnEventEffects(
  def: { readonly effects?: readonly CardEffect[] } | null | undefined,
  eventName: string,
): readonly OnEventEffect[] {
  return (def?.effects ?? []).filter((e): e is OnEventEffect => e.type === 'on-event' && e.event === eventName);
}

/**
 * Returns the effects array from a card definition, or an empty array if the
 * card has no effects or the definition is absent.
 *
 * Eliminates the verbose triple-check `!def || !('effects' in def) || !def.effects`
 * that precedes every `for (const effect of def.effects)` loop.
 */
export function getCardEffects(
  def: CardDefinition | null | undefined,
): readonly CardEffect[] {
  if (!def || !('effects' in def)) return [];
  return (def as { readonly effects?: readonly CardEffect[] }).effects ?? [];
}

/**
 * Returns the first `hazard-maintenance` effect on the card, or `undefined` if
 * none exists. Centralizes the recurring pattern of iterating a card's effects
 * to find the maintenance trigger, used both when computing available legal
 * actions and when validating the chosen payment.
 */
export function findHazardMaintenanceEffect(
  def: CardDefinition | null | undefined,
): HazardMaintenanceEffect | undefined {
  return getCardEffects(def).find(
    (e): e is HazardMaintenanceEffect => e.type === 'hazard-maintenance',
  );
}

/**
 * Returns the player's avatar character (wizard/ringwraith/fallen-wizard/balrog),
 * or `undefined` if the player has no avatar in play. Matches the first character
 * whose definition has `mind === null`.
 */
export function findPlayerAvatar(
  state: GameState,
  player: { readonly characters: Readonly<Record<string, CharacterInPlay>> },
): CharacterInPlay | undefined {
  for (const char of Object.values(player.characters)) {
    const def = resolveDef(state, char.instanceId);
    if (isAvatarCharacter(def)) return char;
  }
  return undefined;
}

/**
 * Iterates a player's characters-in-play, yielding each `[instanceId, char]`
 * pair with the key correctly typed as a {@link CardInstanceId}.
 *
 * The characters map is keyed by instance ID, but `Object.entries` types the
 * keys as plain `string`, forcing callers to cast each key back to a branded
 * `CardInstanceId`. This helper centralizes that cast so phase handlers can
 * iterate characters without per-call-site assertions.
 */
export function characterEntries(
  player: { readonly characters: Readonly<Record<string, CharacterInPlay>> },
): [CardInstanceId, CharacterInPlay][] {
  return Object.entries(player.characters) as [CardInstanceId, CharacterInPlay][];
}

/**
 * Returns the instance IDs of a player's characters-in-play, correctly typed
 * as {@link CardInstanceId}s rather than plain `string`s. See
 * {@link characterEntries} for why the cast is needed.
 */
export function characterIds(
  player: { readonly characters: Readonly<Record<string, CharacterInPlay>> },
): CardInstanceId[] {
  return Object.keys(player.characters) as CardInstanceId[];
}

/**
 * Returns the company that contains the given character, or `undefined` if no
 * company holds it. Centralizes the recurring `companies.find(c =>
 * c.characters.includes(charId))` lookup so phase handlers can locate a
 * character's company without repeating the membership predicate.
 */
export function findCharacterCompany(
  companies: readonly Company[],
  characterId: CardInstanceId,
): Company | undefined {
  return companies.find(c => c.characters.includes(characterId));
}

/**
 * Returns the company with the given id, or `undefined` if none matches.
 * Centralizes the ubiquitous `companies.find(c => c.id === companyId)` lookup
 * used across combat, organization, and pending-resolution handlers to locate a
 * company by its {@link CompanyId}.
 */
export function companyById(
  companies: readonly Company[],
  id: CompanyId,
): Company | undefined {
  return companies.find(c => c.id === id);
}

/**
 * Finds the player and company containing the given character across all players.
 *
 * Each character belongs to exactly one player's company. This helper replaces the
 * recurring nested-loop pattern that iterates `state.players` to find which player
 * and company a character belongs to — used in effect collection where we need to
 * walk the rest of the company's members.
 *
 * Returns `undefined` if the character is not currently in any company (e.g. it
 * has been eliminated or is between phase transitions).
 */
export function findPlayerAndCompany(
  state: GameState,
  characterId: CardInstanceId,
): { readonly player: PlayerState; readonly playerIndex: number; readonly company: Company } | undefined {
  for (let i = 0; i < state.players.length; i++) {
    const player = state.players[i];
    const company = findCharacterCompany(player.companies, characterId);
    if (company) return { player, playerIndex: i, company };
  }
  return undefined;
}

/**
 * Filters a sideboard to the cards whose definitions match `predicate`,
 * returning `{ instanceId, name }` pairs for legal-action generation. Cards
 * whose definitions cannot be resolved from the card pool are skipped.
 */
export function filterSideboardByDef(
  state: GameState,
  sideboard: readonly CardInstance[],
  predicate: (def: CardDefinition) => boolean,
): { instanceId: CardInstanceId; name: string }[] {
  const result: { instanceId: CardInstanceId; name: string }[] = [];
  for (const card of sideboard) {
    const def = state.cardPool[card.definitionId as string];
    if (def && predicate(def)) {
      result.push({ instanceId: card.instanceId, name: def.name });
    }
  }
  return result;
}

/**
 * Counts how many cards with the given name are currently in any player's
 * `cardsInPlay`. Used when checking `duplication-limit` constraints with
 * `scope: "game"` to prevent more than the allowed number of copies being
 * in play simultaneously.
 */
/**
 * Returns the effective general-influence pool for the player.
 * Base pool is 20; permanent events (e.g. Bade to Rule) can add a bonus.
 */
export function effectiveGeneralInfluence(state: GameState, playerId: PlayerId): number {
  return GENERAL_INFLUENCE + (playerById(state, playerId)?.generalInfluenceBonus ?? 0);
}

export function countCopiesInPlay(state: GameState, name: string): number {
  return state.players.reduce((count, p) =>
    count + p.cardsInPlay.filter(c => defById(state, c.definitionId)?.name === name).length,
  0);
}

/**
 * Enter the deck exhaustion sub-flow: return site cards to location deck,
 * set deckExhaustPending so the player can exchange cards with the sideboard.
 */
export function startDeckExhaust(state: GameState, playerIndex: 0 | 1): GameState {
  const player = state.players[playerIndex];
  logHeading(`Deck exhaustion started for ${player.name}`);
  logDetail(`Returning ${player.siteDiscardPile.length} site card(s) to location deck`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    siteDeck: [...player.siteDeck, ...player.siteDiscardPile],
    siteDiscardPile: [],
    deckExhaustPending: true,
    deckExhaustExchangeCount: 0,
  };

  return { ...state, players: newPlayers };
}

/**
 * Complete the deck exhaustion: shuffle the discard pile into a new play deck,
 * increment exhaustion count, and clear the pending flag.
 *
 * Fires `play-deck-exhausted` — discards any permanent event in either
 * player's `cardsInPlay` that declares `on-event: play-deck-exhausted` with
 * `apply: { type: "discard-self" }` (e.g. Safe from the Shadow, Tokens to Show).
 */
export function completeDeckExhaust(state: GameState, playerIndex: 0 | 1): GameState {
  const player = state.players[playerIndex];
  const newExhaustionCount = player.deckExhaustionCount + 1;
  logHeading(`Deck exhaustion #${newExhaustionCount} complete for ${player.name}`);

  const [newPlayDeck, newRng] = shuffle([...player.discardPile], state.rng);
  logDetail(`Shuffled ${player.discardPile.length} card(s) from discard into new play deck`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    playDeck: newPlayDeck,
    discardPile: [],
    deckExhaustionCount: newExhaustionCount,
    deckExhaustPending: false,
    deckExhaustExchangeCount: 0,
  };

  let result: GameState = { ...state, players: newPlayers, rng: newRng };

  // Fire play-deck-exhausted: discard permanent events that auto-discard on deck exhaustion.
  for (let pi = 0; pi < 2; pi++) {
    const p = result.players[pi];
    const toDiscard: typeof p.cardsInPlay[0][] = [];
    for (const card of p.cardsInPlay) {
      const def = result.cardPool[card.definitionId as string] as { readonly effects?: readonly CardEffect[] } | undefined;
      if (getOnEventEffects(def, 'play-deck-exhausted').some(e => e.apply?.type === 'discard-self')) {
        toDiscard.push(card);
      }
    }
    if (toDiscard.length === 0) continue;
    const discardIds = new Set(toDiscard.map(c => c.instanceId));
    const updatedPlayers = result.players.map((pl, idx) => {
      if (idx !== pi) return pl;
      const remaining = pl.cardsInPlay.filter(c => !discardIds.has(c.instanceId));
      const discarded = pl.discardPile.concat(toDiscard.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId })));
      logDetail(`play-deck-exhausted: discarding ${toDiscard.map(c => cardName(result, c.definitionId)).join(', ')} from player ${pl.name} cardsInPlay`);
      return { ...pl, cardsInPlay: remaining, discardPile: discarded };
    });
    result = { ...result, players: updatedPlayers as unknown as typeof result.players };
  }

  return result;
}

/**
 * Handle exchange-sideboard during deck exhaustion sub-flow.
 * Swaps one card between discard pile and sideboard.
 */
export function handleExchangeSideboard(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'exchange-sideboard') return { state, error: 'Expected exchange-sideboard action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  if (!player.deckExhaustPending) {
    return { state, error: 'No deck exhaustion sub-flow active' };
  }
  if (player.deckExhaustExchangeCount >= 5) {
    return { state, error: 'Already exchanged 5 cards' };
  }

  const discardIdx = player.discardPile.findIndex(c => c.instanceId === action.discardCardInstanceId);
  if (discardIdx === -1) {
    return { state, error: 'Card not found in discard pile' };
  }
  const sideboardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  if (sideboardIdx === -1) {
    return { state, error: 'Card not found in sideboard' };
  }

  const discardCard = player.discardPile[discardIdx];
  const sideboardCard = player.sideboard[sideboardIdx];
  const discardName = cardName(state, discardCard.definitionId, '?');
  const sideboardName = cardName(state, sideboardCard.definitionId, '?');
  logDetail(`Exchange: ${discardName} (discard → sideboard) ↔ ${sideboardName} (sideboard → discard)`);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    discardPile: [...removeById(player.discardPile, discardCard.instanceId), sideboardCard],
    sideboard: [...removeById(player.sideboard, sideboardCard.instanceId), discardCard],
    deckExhaustExchangeCount: player.deckExhaustExchangeCount + 1,
  };

  return { state: { ...state, players: newPlayers } };
}

/**
 * Auto-joins the active player's companies that end up at the same
 * non-haven site at the end of all movement/hazard phases (CoE rule
 * 2.IV.6: "The resource player must immediately join any companies at
 * the same non-haven site at the end of a turn's movement/hazard
 * phases"). Companies sharing a haven are left alone — joining havens
 * is always a player choice.
 *
 * Companies are joined in declaration order: the first company at each
 * non-haven site becomes the target, and every subsequent company there
 * has its characters folded into the target and is removed. The merged
 * company keeps `siteCardOwned=true` if any of the merging companies
 * held the physical site card.
 */
export function autoMergeNonHavenCompanies(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  if (player.companies.length < 2) return state;

  // Group companies by site instance id, preserving encounter order.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < player.companies.length; i++) {
    const c = player.companies[i];
    if (!c.currentSite) continue;
    const key = c.currentSite.instanceId as string;
    const existing = groups.get(key);
    if (existing) {
      existing.push(i);
    } else {
      groups.set(key, [i]);
    }
  }

  // Collect indices to remove and the target index per group.
  const mergeMap = new Map<number, number[]>(); // target idx → source idxs to fold in
  for (const [siteInstanceId, indices] of groups) {
    if (indices.length < 2) continue;
    const firstIdx = indices[0];
    const siteDef = state.cardPool[player.companies[firstIdx].currentSite!.definitionId as string];
    const isHaven = siteDef && isSiteCard(siteDef) && siteDef.siteType === 'haven';
    if (isHaven) continue;
    mergeMap.set(firstIdx, indices.slice(1));
    logDetail(`Auto-merge rule 2.IV.6: ${indices.length} companies at non-haven site ${siteDef?.name ?? siteInstanceId} → joining into company ${player.companies[firstIdx].id as string}`);
  }

  if (mergeMap.size === 0) return state;

  const toRemove = new Set<number>();
  for (const sources of mergeMap.values()) for (const s of sources) toRemove.add(s);

  const companies: Company[] = [];
  for (let i = 0; i < player.companies.length; i++) {
    if (toRemove.has(i)) continue;
    const c = player.companies[i];
    const folds = mergeMap.get(i);
    if (!folds || folds.length === 0) {
      companies.push(c);
      continue;
    }
    let characters = [...c.characters];
    let siteCardOwned = c.siteCardOwned;
    let onGuardCards = [...c.onGuardCards];
    let hazards = [...c.hazards];
    for (const srcIdx of folds) {
      const src = player.companies[srcIdx];
      characters = [...characters, ...src.characters];
      siteCardOwned = siteCardOwned || src.siteCardOwned;
      onGuardCards = [...onGuardCards, ...src.onGuardCards];
      hazards = [...hazards, ...src.hazards];
    }
    companies.push({ ...c, characters, siteCardOwned, onGuardCards, hazards });
  }

  const newPlayers: [PlayerState, PlayerState] = [state.players[0], state.players[1]];
  newPlayers[playerIndex] = { ...player, companies };
  return sweepAutoDiscardHazards({ ...state, players: newPlayers });
}

/**
 * Removes companies with no characters and returns their site cards
 * to the player's site deck.
 */
export function cleanupEmptyCompanies(state: GameState): GameState {
  const newPlayers = state.players.map(player => {
    const emptyCompanies = player.companies.filter(c => c.characters.length === 0);
    const keptCompanies = player.companies.filter(c => c.characters.length > 0);

    // Build a set of site instance IDs still occupied by a kept company.
    // If another company is at the same site, the site stays in play (CoE rule 2.07).
    const occupiedSiteIds = new Set(
      keptCompanies.map(c => c.currentSite?.instanceId as string).filter(Boolean),
    );

    // Return sites from empty companies: tapped sites go to discard, untapped to site deck.
    // Skip if another company from the same player is still at that site.
    const untappedSites: CardInstance[] = [];
    const tappedSites: CardInstance[] = [];
    for (const c of emptyCompanies) {
      if (c.currentSite) {
        if (occupiedSiteIds.has(c.currentSite.instanceId as string)) {
          logDetail(`cleanupEmptyCompanies: site ${c.currentSite.instanceId as string} still occupied by another company — leaving in play`);
          continue;
        }
        const siteCardInst = toCardInstance(c.currentSite);
        if (c.currentSite.status === CardStatus.Tapped) {
          tappedSites.push(siteCardInst);
        } else {
          untappedSites.push(siteCardInst);
        }
      }
    }
    const newSiteDeck = [...player.siteDeck, ...untappedSites];
    const newDiscardPile = [...player.discardPile, ...tappedSites];

    return { ...player, companies: keptCompanies, siteDeck: newSiteDeck, discardPile: newDiscardPile };
  });

  return { ...state, players: [newPlayers[0], newPlayers[1]] };
}

/**
 * Fires the `company-composition-changed` event against every attached
 * hazard carrying an `on-event` + `discard-self` effect for that event.
 * When the effect's `when` condition is met, the hazard is discarded to
 * its owner's discard pile — the same pattern Treebeard uses for
 * `company-arrives-at-site`, reused here for hazards that care about
 * company size (e.g. Alone and Unadvised).
 */
export function sweepAutoDiscardHazards(state: GameState): GameState {
  let changed = false;
  const newPlayers = clonePlayers(state);

  for (let pi = 0; pi < 2; pi++) {
    const player = newPlayers[pi];
    for (const company of player.companies) {
      const companyCharCount = company.characters.length;
      for (const charId of company.characters) {
        const char = player.characters[charId as string];
        if (!char) continue;
        const toDiscard: CardInstanceId[] = [];
        for (const hazard of char.hazards) {
          const hDef = state.cardPool[hazard.definitionId as string] as { name?: string; effects?: readonly CardEffect[] } | undefined;
          // Match a move effect that discards self (the hazard itself)
          // to its owner's discard pile. Legacy `discard-self` was
          // migrated to `{ select: 'self', from: 'self-location', to: 'discard' }`.
          const ctx = { company: { characterCount: companyCharCount } };
          const trigger = getOnEventEffects(hDef, 'company-composition-changed').find(
            e => e.apply?.type === 'move' && e.apply.select === 'self' && e.apply.to === 'discard'
              && !!e.when && matchesCondition(e.when, ctx),
          );
          if (trigger) {
            logDetail(`discard-self: "${hDef?.name}" on ${charId as string} (company size ${companyCharCount})`);
            toDiscard.push(hazard.instanceId);
          }
        }
        if (toDiscard.length > 0) {
          changed = true;
          const discardSet = new Set(toDiscard as string[]);
          const discarded = char.hazards.filter(h => discardSet.has(h.instanceId as string));
          const remaining = char.hazards.filter(h => !discardSet.has(h.instanceId as string));
          newPlayers[pi] = {
            ...newPlayers[pi],
            characters: {
              ...newPlayers[pi].characters,
              [charId as string]: { ...newPlayers[pi].characters[charId as string], hazards: remaining },
            },
            discardPile: [...newPlayers[pi].discardPile, ...discarded.map(toCardInstance)],
          };
        }
      }
    }
  }

  return changed ? { ...state, players: [newPlayers[0], newPlayers[1]] as unknown as typeof state.players } : state;
}

/**
 * Fires the `company-membership-changes` event against every company-targeted
 * permanent event (cardsInPlay with a matching `companyId`) that carries an
 * `on-event: company-membership-changes` + `discard-self` effect. Used by
 * Fellowship, which must be discarded whenever any character or ally joins or
 * leaves the company it was played on.
 *
 * Call after any action that changes a company's character or ally roster,
 * passing every affected company ID.
 */
export function sweepCompanyMembershipChangedEvents(
  state: GameState,
  affectedCompanyIds: readonly CompanyId[],
): GameState {
  if (affectedCompanyIds.length === 0) return state;
  const affected = new Set(affectedCompanyIds.map(id => id as string));
  let changed = false;
  const newPlayers = clonePlayers(state);

  for (let pi = 0; pi < 2; pi++) {
    const player = newPlayers[pi];
    const toDiscard: CardInstanceId[] = [];
    for (const card of player.cardsInPlay) {
      if (!affected.has(card.companyId as string)) continue;
      const def = state.cardPool[card.definitionId as string] as { name?: string; effects?: readonly CardEffect[] } | undefined;
      const trigger = getOnEventEffects(def, 'company-membership-changes').find(
        e => e.apply?.type === 'move' && e.apply.select === 'self' && e.apply.to === 'discard',
      );
      if (trigger) {
        logDetail(`company-membership-changes: discarding "${def?.name}" (company ${card.companyId as string})`);
        toDiscard.push(card.instanceId);
      }
    }
    if (toDiscard.length > 0) {
      changed = true;
      const discardSet = new Set(toDiscard as string[]);
      const discarded = player.cardsInPlay.filter(c => discardSet.has(c.instanceId as string));
      newPlayers[pi] = {
        ...newPlayers[pi],
        cardsInPlay: player.cardsInPlay.filter(c => !discardSet.has(c.instanceId as string)),
        discardPile: [...player.discardPile, ...discarded.map(toCardInstance)],
      };
    }
  }

  return changed ? { ...state, players: [newPlayers[0], newPlayers[1]] as unknown as typeof state.players } : state;
}

/**
 * Generate a unique company ID for a player by finding the highest existing
 * index among their companies and incrementing it. This avoids ID collisions
 * that can occur when companies are merged (removing lower-indexed IDs) and
 * then new companies are created.
 */
export function nextCompanyId(player: PlayerState): CompanyId {
  const maxIdx = player.companies.reduce((max, c) => {
    const match = (c.id as string).match(/company-.*-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, -1);
  return `company-${player.id as string}-${maxIdx + 1}` as CompanyId;
}

export function discardEventCard(state: GameState, cardInstanceId: CardInstanceId, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  const eventCard = findById(player.cardsInPlay, cardInstanceId);
  if (!eventCard) return state;
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...newPlayers[playerIndex],
    cardsInPlay: removeById(player.cardsInPlay, cardInstanceId),
    discardPile: [...player.discardPile, toCardInstance(eventCard)],
  };
  return {
    ...state,
    players: newPlayers,
  };
}

/**
 * Resolve (skip) the current pending effect and advance to the next one.
 * If no more effects remain, move the event card from cardsInPlay to discard.
 */
export function resolvePendingEffect(state: GameState): ReducerResult {
  const current = state.pendingEffects[0];
  const remaining = state.pendingEffects.slice(1);
  const effectOwner = current.type === 'card-effect' && current.actor
    ? current.actor
    : state.activePlayer!;
  const ownerIndex = getPlayerIndex(state, effectOwner);

  let newState: GameState = { ...state, pendingEffects: remaining };
  if (remaining.length === 0 && current.type === 'card-effect') {
    if (!current.skipDiscard) {
      newState = discardEventCard(newState, current.cardInstanceId, ownerIndex);
      // For short events with a postCorruptionCheck (e.g. Vilya), enqueue
      // the corruption check even when the player passed the remaining picks.
      if (current.postCorruptionCheck) {
        newState = enqueueCorruptionCheck(newState, {
          source: current.cardInstanceId,
          actor: effectOwner,
          scope: { kind: 'phase', phase: newState.phaseState.phase },
          characterId: current.postCorruptionCheck.characterId,
          modifier: current.postCorruptionCheck.modifier,
          reason: 'card effect',
        });
      }
    }
  }
  // When skipping a fetch-to-deck effect by passing, emit a text notification
  // so both players see that the optional retrieval was declined.
  const skipEffects: import('../index.js').GameEffect[] = [];
  if (current.type === 'card-effect' && current.effect.type === 'fetch-to-deck') {
    const playerName = (state.players.find(p => p.id === effectOwner) as { name: string } | undefined)?.name ?? effectOwner as string;
    const eventDef = resolveDef(state, current.cardInstanceId) as { name?: string } | undefined;
    const cardName = eventDef?.name ?? current.cardInstanceId as string;
    skipEffects.push({ effect: 'text-notification', message: `${playerName} does not retrieve a Man hazard creature (${cardName})` });
  }
  return { state: newState, effects: skipEffects.length > 0 ? skipEffects : undefined };
}

/**
 * Handle fetching a card from sideboard or discard pile into the play deck.
 *
 * Part of the fetch-to-deck effect resolution. The current effect is the
 * first entry in {@link GameState.pendingEffects}. After the fetch,
 * the effect is consumed; if no more effects remain, the event card moves
 * from cardsInPlay to the player's discard pile.
 */
export function handleFetchFromPile(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'fetch-from-pile') return { state, error: 'Expected fetch-from-pile action' };

  if (state.pendingEffects.length === 0) {
    return { state, error: 'No effect sub-flow active' };
  }
  const current = state.pendingEffects[0];
  if (current.type !== 'card-effect' || current.effect.type !== 'fetch-to-deck') {
    return { state, error: `Expected fetch-to-deck effect, got ${current.type}` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Find the card in the specified source pile
  const sourcePile = action.source === 'sideboard' ? player.sideboard : player.discardPile;
  const cardIdx = sourcePile.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) {
    return { state, error: `Card not found in ${action.source as string}` };
  }

  const fetchedCard = sourcePile[cardIdx];
  const def = state.cardPool[fetchedCard.definitionId as string];

  // Validate card matches filter condition
  if (!def || !matchesDefinition(def, current.effect.filter)) {
    return { state, error: 'Card does not match fetch filter' };
  }

  logDetail(`Fetching ${def?.name ?? '?'} from ${action.source as string} → play deck, shuffling`);

  // Remove from source pile, add to play deck, shuffle
  const newSourcePile = removeById(sourcePile, fetchedCard.instanceId);

  const [shuffledDeck, nextRng] = shuffle([...player.playDeck, fetchedCard], state.rng);

  const newPlayers = clonePlayers(state);
  if (action.source === 'sideboard') {
    newPlayers[playerIndex] = { ...player, sideboard: newSourcePile, playDeck: shuffledDeck };
  } else {
    newPlayers[playerIndex] = { ...player, discardPile: newSourcePile, playDeck: shuffledDeck };
  }

  // Decrement the count; if more picks remain, re-enqueue with count-1 so the
  // player is prompted for the next pick (e.g. Vilya's 3-card fetch).
  const newCount = current.effect.type === 'fetch-to-deck' ? current.effect.count - 1 : 0;
  const remaining = newCount > 0
    ? [{ ...current, effect: { ...current.effect, count: newCount } } as import('../types/state-combat.js').PendingEffect, ...state.pendingEffects.slice(1)]
    : state.pendingEffects.slice(1);
  let newState: GameState = { ...state, players: newPlayers, rng: nextRng, pendingEffects: remaining };
  if (remaining.length === 0) {
    if (current.skipDiscard) {
      if (current.postCorruptionCheck) {
        newState = enqueueCorruptionCheck(newState, {
          source: current.cardInstanceId,
          actor: action.player,
          scope: { kind: 'phase', phase: newState.phaseState.phase },
          characterId: current.postCorruptionCheck.characterId,
          modifier: current.postCorruptionCheck.modifier,
          reason: 'Palantír',
        });
      }
    } else {
      newState = discardEventCard(newState, current.cardInstanceId, playerIndex);
      // For short events that have a postCorruptionCheck (e.g. Vilya), enqueue
      // the corruption check after the card is discarded.
      if (current.postCorruptionCheck) {
        newState = enqueueCorruptionCheck(newState, {
          source: current.cardInstanceId,
          actor: action.player,
          scope: { kind: 'phase', phase: newState.phaseState.phase },
          characterId: current.postCorruptionCheck.characterId,
          modifier: current.postCorruptionCheck.modifier,
          reason: 'card effect',
        });
      }
    }
  }
  return { state: newState };
}

/**
 * Returns true if the given company is covert, false if overt.
 *
 * A company is overt if it contains:
 * - Any character with Race.Orc or Race.Troll (rule glossary: "overt").
 * - The Balrog avatar (an avatar character of a Balrog-alignment player).
 * - Any ally carrying a `company-overt` effect (e.g. Regiment of Black Crows,
 *   Great Bats, Great Lord of Goblin-gate, Last Child of Ungoliant).
 *
 * Ringwraith in Fell Rider mode also makes a company overt, but Fell Rider mode
 * is not yet tracked — when it is implemented, add the check here.
 *
 * A company is covert when none of the overt conditions are met (rule glossary:
 * "covert").
 */
export function isCovertCompany(
  company: { readonly characters: readonly CardInstanceId[] },
  player: PlayerState,
  state: GameState,
): boolean {
  const overtRaces = new Set<Race>([Race.Orc, Race.Troll]);

  for (const charId of company.characters) {
    const charData = player.characters[charId as string];
    if (!charData) continue;

    const charDef = defById(state, charData.definitionId);
    if (charDef && isCharacterCard(charDef)) {
      // Orc/Troll race makes company overt
      if (overtRaces.has(charDef.race)) return false;
      // Balrog avatar (avatar character in a Balrog-alignment game) makes company overt
      if (isAvatarCharacter(charDef) && player.alignment === 'balrog') return false;
    }

    // Check allies for company-overt effect
    for (const ally of charData.allies) {
      const allyDef = defById(state, ally.definitionId);
      if (!allyDef || !isAllyCard(allyDef)) continue;
      if (getCardEffects(allyDef).some(e => e.type === 'company-overt')) {
        return false; // overt
      }
    }
  }

  return true; // covert
}
