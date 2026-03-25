/**
 * @module chain-reducer
 *
 * Reducer logic for the chain of effects sub-state.
 *
 * Handles chain initiation, priority passing, resolution loop, nested chains
 * (on-guard interrupts, body checks), and deferred passive condition processing.
 *
 * The chain reducer is called from the main {@link reduce} function when the
 * action type is chain-specific (`pass-chain-priority`, `order-passives`).
 * Card-play actions that are chain-aware (short events, creatures, etc.) call
 * helpers from this module to push entries onto the chain stack.
 */

import type { GameState, GameAction, PlayerId, CardInstanceId, CardDefinitionId, ChainState, ChainEntry, ChainEntryPayload, ChainRestriction } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer.js';

/**
 * Returns the opponent of the given player in a two-player game.
 */
function opponent(state: GameState, playerId: PlayerId): PlayerId {
  return state.players[0].id === playerId ? state.players[1].id : state.players[0].id;
}

/**
 * Creates a new chain of effects with the given first entry.
 *
 * The initiating player's opponent receives priority first (CoE rule 672:
 * the non-initiator may respond before resolution begins).
 *
 * @param state - Current game state (chain must be null).
 * @param declaredBy - The player initiating the chain.
 * @param cardInstanceId - The card being played, or null for non-card entries.
 * @param definitionId - The card definition ID, or null.
 * @param payload - What kind of chain entry this is.
 * @param restriction - Chain restriction mode (default: 'normal').
 * @returns New game state with chain active.
 */
export function initiateChain(
  state: GameState,
  declaredBy: PlayerId,
  cardInstanceId: CardInstanceId | null,
  definitionId: CardDefinitionId | null,
  payload: ChainEntryPayload,
  restriction: ChainRestriction = 'normal',
): GameState {
  logHeading(`Initiating chain of effects`);
  logDetail(`Declared by player ${declaredBy as string}, payload type: ${payload.type}, restriction: ${restriction}`);

  const entry: ChainEntry = {
    index: 0,
    declaredBy,
    cardInstanceId,
    definitionId,
    payload,
    resolved: false,
    negated: false,
  };

  const chain: ChainState = {
    mode: 'declaring',
    entries: [entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
    deferredPassives: [],
    parentChain: state.chain,
    restriction,
  };

  logDetail(`Priority goes to opponent ${chain.priority as string}`);

  return { ...state, chain };
}

/**
 * Pushes a new entry onto an existing chain's stack and flips priority.
 *
 * Called when a player declares an action in response during the declaring phase.
 * The responder's opponent receives priority next.
 *
 * @param state - Current game state (chain must be non-null and in declaring mode).
 * @param declaredBy - The player declaring the response.
 * @param cardInstanceId - The card being played, or null.
 * @param definitionId - The card definition ID, or null.
 * @param payload - What kind of chain entry this is.
 * @returns New game state with entry added and priority flipped.
 */
export function pushChainEntry(
  state: GameState,
  declaredBy: PlayerId,
  cardInstanceId: CardInstanceId | null,
  definitionId: CardDefinitionId | null,
  payload: ChainEntryPayload,
): GameState {
  const chain = state.chain!;
  logDetail(`Pushing chain entry #${chain.entries.length} by player ${declaredBy as string}, payload: ${payload.type}`);

  const entry: ChainEntry = {
    index: chain.entries.length,
    declaredBy,
    cardInstanceId,
    definitionId,
    payload,
    resolved: false,
    negated: false,
  };

  const newChain: ChainState = {
    ...chain,
    entries: [...chain.entries, entry],
    priority: opponent(state, declaredBy),
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  logDetail(`Priority flips to ${newChain.priority as string}`);

  return { ...state, chain: newChain };
}

/**
 * Handles chain-specific actions (`pass-chain-priority`, `order-passives`).
 *
 * Called by the main reducer when `state.chain` is non-null and the action
 * type is a chain action.
 */
export function handleChainAction(state: GameState, action: GameAction): ReducerResult {
  const chain = state.chain;
  if (!chain) {
    return { state, error: 'No active chain' };
  }

  switch (action.type) {
    case 'pass-chain-priority':
      return handlePassChainPriority(state, chain, action.player);
    case 'order-passives':
      // TODO Phase 6: implement ordering of simultaneously-triggered passives
      return { state, error: 'order-passives not yet implemented' };
    default:
      return { state, error: `Unexpected chain action: ${action.type}` };
  }
}

/**
 * Handles a player passing priority in the chain's declaring phase.
 *
 * When a player passes:
 * - If the opponent hasn't passed yet, priority flips to the opponent.
 * - If both players have now passed consecutively, the chain transitions
 *   to resolving mode and auto-resolution begins.
 */
function handlePassChainPriority(state: GameState, chain: ChainState, playerId: PlayerId): ReducerResult {
  logHeading(`Chain: player ${playerId as string} passes priority`);

  if (chain.mode !== 'declaring') {
    return { state, error: 'Cannot pass priority: chain is resolving' };
  }
  if (playerId !== chain.priority) {
    return { state, error: 'Cannot pass priority: you do not have priority' };
  }

  // Check if the other player has already passed
  const otherAlreadyPassed = chain.priorityPlayerPassed
    ? chain.nonPriorityPlayerPassed
    : false;

  // The current priority player is passing. If they were the first to pass,
  // flip priority to the opponent. The "priorityPlayerPassed" always tracks
  // whether the CURRENT priority player has passed.
  // Since we're about to flip priority, the current player's pass becomes
  // the "nonPriorityPlayerPassed" from the new priority holder's perspective.

  if (!otherAlreadyPassed) {
    // First pass — flip priority to opponent, they get a chance to respond
    const newPriority = opponent(state, playerId);
    logDetail(`First pass — priority flips to ${newPriority as string}`);

    const newChain: ChainState = {
      ...chain,
      priority: newPriority,
      priorityPlayerPassed: false,
      nonPriorityPlayerPassed: true,
    };

    return { state: { ...state, chain: newChain } };
  }

  // Both players passed consecutively — transition to resolving
  logDetail(`Both players passed — chain transitions to resolving`);

  const newChain: ChainState = {
    ...chain,
    mode: 'resolving',
    priorityPlayerPassed: false,
    nonPriorityPlayerPassed: false,
  };

  // TODO Phase 3: auto-resolve entries in LIFO order
  return { state: { ...state, chain: newChain } };
}
