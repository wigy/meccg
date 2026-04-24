/**
 * @module reducer-utils
 *
 * Shared utility functions used by multiple reducer phase handlers.
 * Includes state cloning, dice rolling, deck exhaustion, company management,
 * and card effect resolution helpers.
 */

import type { GameState, PlayerState, CardInstanceId, CardInstance, CompanyId, GameAction, Company, CharacterInPlay, CardDefinition } from '../index.js';
import type { TwoDiceSix, DieRoll, GameEffect } from '../index.js';
import type { CardEffect } from '../types/effects.js';
import { shuffle, nextInt, CardStatus, getPlayerIndex, isSiteCard, isAvatarCharacter } from '../index.js';
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

/** Creates a mutable copy of the 2-player tuple, preserving the tuple type. */


export function clonePlayers(state: GameState): [PlayerState, PlayerState] {
  return [{ ...state.players[0] }, { ...state.players[1] }];
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
 * Piles on {@link PlayerState} that contain {@link CardInstance} tuples and
 * can serve as `from`/`to` arguments for {@link movePlayerCard}.
 */
export type PlayerPileName =
  | 'hand'
  | 'playDeck'
  | 'discardPile'
  | 'siteDeck'
  | 'siteDiscardPile'
  | 'sideboard'
  | 'killPile'
  | 'outOfPlayPile';

/**
 * Move a single card instance between two piles on the same player.
 *
 * Returns the unchanged state if the instance is not present in the `from`
 * pile; no error is raised. Appends to the `to` pile unless `opts.prepend`
 * is set (e.g. returning a card to the top of the play deck).
 */
export function movePlayerCard(
  state: GameState,
  playerIndex: number,
  instanceId: CardInstance['instanceId'],
  from: PlayerPileName,
  to: PlayerPileName,
  opts?: { readonly prepend?: boolean },
): GameState {
  if (from === to) return state;
  const player = state.players[playerIndex];
  const fromPile = player[from];
  const idx = fromPile.findIndex(c => c.instanceId === instanceId);
  if (idx === -1) return state;
  const card = fromPile[idx];
  const newFrom = [...fromPile.slice(0, idx), ...fromPile.slice(idx + 1)];
  const moved = toCardInstance(card);
  const toPile = player[to];
  const newTo = opts?.prepend ? [moved, ...toPile] : [...toPile, moved];
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, [from]: newFrom, [to]: newTo };
  return { ...state, players: newPlayers };
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
 * Handles deck exhaustion for a player when their play deck runs empty.
 *
 * Per CoE rules §10:
 * 1. Return discarded site cards to the location deck
 * 2. (TODO: sideboard exchange — player may swap up to 5 cards between
 *    discard pile and sideboard. This is an interactive step to be added later.)
 * 3. Shuffle the discard pile into a new play deck
 * 4. Increment `deckExhaustionCount`
 *
 * This function is called immediately after drawing the last card from the
 * play deck. It is idempotent — calling it when the discard pile is empty
 * results in an empty play deck (no-op reshuffle).
 *
 * @param state - Current game state (player's playDeck should be empty).
 * @param playerIndex - Index (0 or 1) of the player whose deck is exhausted.
 * @returns Updated game state with reshuffled deck and incremented exhaustion count.
 */
/**
 * Enter the deck exhaustion sub-flow: return site cards to location deck,
 * set deckExhaustPending so the player can exchange cards with the sideboard.
 */


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
 */


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
      if (!def?.effects) continue;
      const hasTrigger = def.effects.some(
        e => e.type === 'on-event' && (e).event === 'play-deck-exhausted'
          && (e).apply?.type === 'discard-self',
      );
      if (hasTrigger) toDiscard.push(card);
    }
    if (toDiscard.length === 0) continue;
    const discardIds = new Set(toDiscard.map(c => c.instanceId));
    const updatedPlayers = result.players.map((pl, idx) => {
      if (idx !== pi) return pl;
      const remaining = pl.cardsInPlay.filter(c => !discardIds.has(c.instanceId));
      const discarded = pl.discardPile.concat(toDiscard.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId })));
      logDetail(`play-deck-exhausted: discarding ${toDiscard.map(c => result.cardPool[c.definitionId as string]?.name ?? c.definitionId).join(', ')} from player ${pl.name} cardsInPlay`);
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
  const discardName = state.cardPool[discardCard.definitionId as string]?.name ?? '?';
  const sideboardName = state.cardPool[sideboardCard.definitionId as string]?.name ?? '?';
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

// ---- Setup phase handler ----

/** Dispatches setup phase actions to the appropriate step handler. */


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

    // Return sites from empty companies: tapped sites go to discard, untapped to site deck
    const untappedSites: CardInstance[] = [];
    const tappedSites: CardInstance[] = [];
    for (const c of emptyCompanies) {
      if (c.currentSite) {
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
          const hDef = state.cardPool[hazard.definitionId as string];
          if (!hDef || !('effects' in hDef) || !hDef.effects) continue;
          for (const effect of hDef.effects) {
            if (effect.type !== 'on-event') continue;
            if (effect.event !== 'company-composition-changed') continue;
            // Match a move effect that discards self (the hazard itself)
            // to its owner's discard pile. Legacy `discard-self` was
            // migrated to `{ select: 'self', from: 'self-location', to: 'discard' }`.
            if (effect.apply?.type !== 'move') continue;
            if (effect.apply.select !== 'self') continue;
            if (effect.apply.to !== 'discard') continue;
            if (!effect.when) continue;
            const ctx = { company: { characterCount: companyCharCount } };
            if (matchesCondition(effect.when, ctx)) {
              logDetail(`discard-self: "${hDef.name}" on ${charId as string} (company size ${companyCharCount})`);
              toDiscard.push(hazard.instanceId);
              break;
            }
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

// ---- Character placement handler ----

/**
 * Handles the character placement step where players distribute their
 * characters between starting companies (only when 2 sites were selected).
 */


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

/**
 * Compute the effective company size, accounting for hobbits and orc scouts
 * each counting as half a character (rounded up for the total).
 *
 * Per CoE rules: "The number of characters in a company, with each Hobbit
 * or Orc scout character only counting as half of a character (rounded up)."
 */


/**
 * Handle playing a permanent-event resource card.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */


export function discardEventCard(state: GameState, cardInstanceId: CardInstanceId, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  const eventCard = player.cardsInPlay.find(c => c.instanceId === cardInstanceId);
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
 * Handle playing a resource long-event card during the long-event phase.
 * Removes the card from hand, places it on the chain, and initiates/pushes
 * a chain of effects. The card enters play upon resolution (see chain-reducer).
 */


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
    }
  }
  return { state: newState };
}

/** Move a card from cardsInPlay to the specified player's discard pile. */


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
  if (!def || !matchesCondition(current.effect.filter, def as unknown as Record<string, unknown>)) {
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

  // Consume this effect; if all done, move event card from cardsInPlay → discard
  const remaining = state.pendingEffects.slice(1);
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
    }
  }
  return { state: newState };
}

/**
 * Resolve (skip) the current pending effect and advance to the next one.
 * If no more effects remain, move the event card from cardsInPlay to discard.
 */
