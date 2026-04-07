/**
 * @module reducer-utils
 *
 * Shared utility functions used by multiple reducer phase handlers.
 * Includes state cloning, dice rolling, deck exhaustion, company management,
 * and card effect resolution helpers.
 */

import type { GameState, PlayerState, CardInstanceId, CardInstance, CompanyId, GameAction } from '../index.js';
import type { TwoDiceSix, DieRoll, GameEffect } from '../index.js';
import type { Condition } from '../types/effects.js';
import { shuffle, nextInt, CardStatus, getPlayerIndex } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { matchesCondition } from '../effects/index.js';

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


const PILE_NAMES = [
  'hand', 'playDeck', 'discardPile', 'siteDeck', 'siteDiscardPile',
  'sideboard', 'killPile', 'eliminatedPile',
] as const;



/**
 * Counts the total number of card instances across all players' piles,
 * characters, items, allies, cards in play, company sites, and events.
 * Used to mint globally unique instance IDs (e.g. `i-{count}`).
 */
export function countAllInstances(state: GameState): number {
  let count = 0;
  for (const player of state.players) {
    for (const pileName of PILE_NAMES) {
      count += player[pileName].length;
    }
    for (const char of Object.values(player.characters)) {
      count++; // the character itself
      count += char.items.length;
      count += char.allies.length;
    }
    count += player.cardsInPlay.length;
    for (const company of player.companies) {
      if (company.currentSite) count++;
    }
  }
  return count;
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

  return { ...state, players: newPlayers, rng: newRng };
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

  const newDiscard = [...player.discardPile];
  newDiscard.splice(discardIdx, 1);
  newDiscard.push(sideboardCard);

  const newSideboard = [...player.sideboard];
  newSideboard.splice(sideboardIdx, 1);
  newSideboard.push(discardCard);

  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    discardPile: newDiscard,
    sideboard: newSideboard,
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

/**
 * Applies a single game action to the current state.
 *
 * Validation pipeline:
 * 1. Verify the action comes from a player allowed to act in the current context.
 * 2. Verify the action type is legal for the current phase.
 * 3. Dispatch to the phase-specific handler for domain logic.
 *
 * @param state - The current authoritative game state.
 * @param action - The player action to apply.
 * @returns A {@link ReducerResult} with the new state or an error.
 */


/**
 * Checks whether the player submitting the action is allowed to act in the
 * current game context.
 *
 * - During the character draft, both players act simultaneously.
 * - During movement/hazard, the *non-active* player plays hazards.
 * - In all other phases, only the active player may act.
 *
 * @returns An error message if the player is not allowed to act, or
 *          `undefined` if the action is permitted.
 */
export function validateActionPlayer(state: GameState, action: GameAction): string | undefined {
  const phase = state.phaseState.phase;

  // No active player during simultaneous phases (e.g. draft)
  if (state.activePlayer === null) {
    return undefined;
  }

  // During an active chain, the priority player may act
  if (state.chain != null && (action.type === 'pass-chain-priority' || action.type === 'order-passives' || action.type === 'play-short-event' || action.type === 'reveal-on-guard')) {
    if (action.player !== state.chain.priority) {
      return 'You do not have chain priority';
    }
    return undefined;
  }

  // Combat: player validation depends on combat sub-phase
  if (state.combat != null) {
    const combat = state.combat;
    if (action.type === 'assign-strike') {
      const expectedPlayer = combat.assignmentPhase === 'attacker' ? combat.attackingPlayerId : combat.defendingPlayerId;
      return action.player === expectedPlayer ? undefined : `Not the ${combat.assignmentPhase === 'attacker' ? 'attacking' : 'defending'} player`;
    }
    if (action.type === 'resolve-strike' || action.type === 'support-strike') {
      return action.player === combat.defendingPlayerId ? undefined : 'Not the defending player';
    }
    if (action.type === 'body-check-roll') {
      return action.player === combat.attackingPlayerId ? undefined : 'Not the attacking player';
    }
    if (action.type === 'pass' && combat.phase === 'assign-strikes') {
      return action.player === combat.defendingPlayerId ? undefined : 'Not the defending player';
    }
  }

  // During movement/hazard phase, the non-active player plays hazards
  if (phase === 'movement-hazard' && action.type === 'play-hazard') {
    if (action.player === state.activePlayer) {
      return 'Active player cannot play hazards';
    }
    return undefined;
  }

  // Short events (e.g. Twilight) can be played by either player during M/H
  if (phase === 'movement-hazard' && action.type === 'play-short-event') {
    return undefined;
  }

  // During draw-cards and play-hazards steps, both players act
  if (phase === 'movement-hazard' && 'step' in state.phaseState
    && (state.phaseState.step === 'draw-cards' || state.phaseState.step === 'play-hazards' || state.phaseState.step === 'reset-hand')) {
    return undefined;
  }

  // During end-of-turn discard and reset-hand steps, both players act
  if (phase === 'end-of-turn' && 'step' in state.phaseState
    && (state.phaseState.step === 'discard' || state.phaseState.step === 'reset-hand')) {
    return undefined;
  }

  // During site phase on-guard steps, the hazard player acts
  if (phase === 'site' && 'step' in state.phaseState
    && (state.phaseState.step === 'reveal-on-guard-attacks'
      || state.phaseState.awaitingOnGuardReveal)) {
    return undefined;
  }

  // During opponent influence defense, the hazard player rolls
  if (phase === 'site' && action.type === 'opponent-influence-defend'
    && 'pendingOpponentInfluence' in state.phaseState
    && state.phaseState.pendingOpponentInfluence != null) {
    return undefined;
  }

  // During untap, the hazard player can access their sideboard
  if (phase === 'untap') {
    return undefined;
  }

  // During Game Over, any player can send 'finished'
  if (phase === 'game-over') {
    return undefined;
  }

  // During Free Council, currentPlayer (not activePlayer) determines who acts
  if (phase === 'free-council') {
    if (action.player !== state.phaseState.currentPlayer) {
      return 'It is not your turn';
    }
    return undefined;
  }

  // Most actions are taken by the active player
  if (action.player !== state.activePlayer) {
    return 'It is not your turn';
  }

  return undefined;
}

// ---- Setup phase handler ----

/** Dispatches setup phase actions to the appropriate step handler. */


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
        const siteCardInst: CardInstance = { instanceId: c.currentSite.instanceId, definitionId: c.currentSite.definitionId };
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
 * Discards all environment cards belonging to the opposing alignment.
 *
 * When an environment permanent-event enters play, it immediately discards
 * all environment cards of the opposing alignment (CoE environment rules):
 * - Resource environments (e.g. Gates of Morning) discard all hazard environments
 * - Hazard environments (e.g. Doors of Night) discard all resource environments
 *
 * Affected cards are moved from their owner's cardsInPlay to their discardPile.
 *
 * @param state - Current game state (after the card has been added to cardsInPlay).
 * @param filter - A DSL condition evaluated against each card definition in play.
 *                 Cards whose definitions match the filter are discarded.
 * @returns Updated game state with matching cards discarded.
 */
export function discardCardsInPlay(state: GameState, filter: Condition): GameState {
  const newPlayers = clonePlayers(state);
  let discardedAny = false;

  for (let pi = 0; pi < state.players.length; pi++) {
    const player = state.players[pi];
    const toDiscard: CardInstance[] = [];
    const remaining = player.cardsInPlay.filter(card => {
      const cardDef = state.cardPool[card.definitionId as string];
      if (!cardDef) return true;
      if (!matchesCondition(filter, cardDef as unknown as Record<string, unknown>)) return true;
      // This card matches the filter — discard it
      logDetail(`Discarding card in play: ${cardDef.name} (${card.instanceId as string}) from player ${pi}`);
      toDiscard.push({ instanceId: card.instanceId, definitionId: card.definitionId });
      return false;
    });

    if (toDiscard.length > 0) {
      discardedAny = true;
      newPlayers[pi] = {
        ...player,
        cardsInPlay: remaining,
        discardPile: [...player.discardPile, ...toDiscard],
      };
    }
  }

  if (!discardedAny) {
    logDetail('No matching cards in play to discard');
    return state;
  }

  return { ...state, players: newPlayers };
}

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
    cardsInPlay: player.cardsInPlay.filter(c => c.instanceId !== cardInstanceId),
    discardPile: [...player.discardPile, { instanceId: eventCard.instanceId, definitionId: eventCard.definitionId }],
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
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);

  let newState: GameState = { ...state, pendingEffects: remaining };
  if (remaining.length === 0 && current.type === 'card-effect') {
    newState = discardEventCard(newState, current.cardInstanceId, activePlayerIndex);
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
  const newSourcePile = [...sourcePile];
  newSourcePile.splice(cardIdx, 1);

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
    newState = discardEventCard(newState, current.cardInstanceId, playerIndex);
  }
  return { state: newState };
}

/**
 * Resolve (skip) the current pending effect and advance to the next one.
 * If no more effects remain, move the event card from cardsInPlay to discard.
 */

