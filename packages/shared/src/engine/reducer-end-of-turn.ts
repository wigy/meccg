/**
 * @module reducer-end-of-turn
 *
 * End-of-turn phase handlers for the game reducer. Covers card discarding,
 * hand resetting, deck exhaustion during end-of-turn, signaling game end,
 * and transitioning to Free Council.
 */

import type { GameState, EndOfTurnPhaseState, PlayerId, GameAction } from '../index.js';
import { Phase, CardStatus, getPlayerIndex } from '../index.js';
import { resolveHandSize } from './effects/index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { clonePlayers, startDeckExhaust, completeDeckExhaust, handleExchangeSideboard } from './reducer-utils.js';
import { enterUntapPhase } from './reducer-untap.js';
import { sweepExpired } from './pending.js';
import { handleGrantActionApply } from './reducer-organization.js';


/**
 * End-of-turn phase handler (CoE 2.VI).
 *
 * Dispatches to sub-step handlers:
 * 1. discard — voluntary discard by either player
 * 2. reset-hand — draw/discard to base hand size
 * 3. signal-end — resource player ends the turn
 */
export function handleEndOfTurn(state: GameState, action: GameAction): ReducerResult {
  const eotState = state.phaseState as EndOfTurnPhaseState;

  switch (eotState.step) {
    case 'discard':
      return handleEndOfTurnDiscard(state, action, eotState);
    case 'reset-hand':
      return handleEndOfTurnResetHand(state, action, eotState);
    case 'signal-end':
      return handleEndOfTurnSignalEnd(state, action);
    default: {
      const _exhaustive: never = eotState.step;
      return { state, error: `Unknown end-of-turn step` };
    }
  }
}

/**
 * Step 1 (discard): Either player may discard a card from hand.
 *
 * Both players act independently. Each may discard one card or pass.
 * Once both have acted (discard or pass), advance to reset-hand.
 */


/**
 * Step 1 (discard): Either player may discard a card from hand.
 *
 * Both players act independently. Each may discard one card or pass.
 * Once both have acted (discard or pass), advance to reset-hand.
 */
function handleEndOfTurnDiscard(
  state: GameState,
  action: GameAction,
  eotState: EndOfTurnPhaseState,
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);

  /** Mark this player done and advance to reset-hand if both are done. */
  function markDone(updatedState: GameState, updatedEot: EndOfTurnPhaseState): ReducerResult {
    const newDone: [boolean, boolean] = [...updatedEot.discardDone] as [boolean, boolean];
    newDone[playerIndex] = true;

    if (newDone[0] && newDone[1]) {
      logDetail(`End-of-Turn discard: both players done → advancing to reset-hand`);
      return {
        state: {
          ...updatedState,
          phaseState: { ...updatedEot, step: 'reset-hand' as const, discardDone: newDone },
        },
      };
    }

    logDetail(`End-of-Turn discard: player ${action.player as string} done, waiting for other player`);
    return {
      state: {
        ...updatedState,
        phaseState: { ...updatedEot, discardDone: newDone },
      },
    };
  }

  if (action.type === 'pass') {
    logDetail(`End-of-Turn discard: player ${action.player as string} passed`);
    return markDone(state, eotState);
  }

  if (action.type === 'discard-card') {
    const player = state.players[playerIndex];
    const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
    const discardedCard = player.hand[cardIdx];
    const newHand = [...player.hand];
    newHand.splice(cardIdx, 1);

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = {
      ...player,
      hand: newHand,
      discardPile: [...player.discardPile, discardedCard],
    };

    logDetail(`End-of-Turn discard: player ${player.name} discarded 1 card (hand now ${newHand.length})`);
    return markDone({ ...state, players: newPlayers }, eotState);
  }

  if (action.type === 'activate-granted-action' && action.actionId === 'saruman-fetch-spell') {
    // Migrated to generic apply dispatch; re-use the organization-phase
    // handler (shared across phases).
    return handleGrantActionApply(state, action);
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn discard step` };
}

/**
 * Step 2 (reset-hand): Both players draw or discard to base hand size (8).
 *
 * Players above hand size must discard one card at a time. Players below
 * hand size draw all at once. Once both are at hand size, advance to
 * signal-end.
 */


/**
 * Step 2 (reset-hand): Both players draw or discard to base hand size (8).
 *
 * Players above hand size must discard one card at a time. Players below
 * hand size draw all at once. Once both are at hand size, advance to
 * signal-end.
 */
/** Mark a player done in the reset-hand step, advancing to signal-end when both are done. */
function markResetHandDone(state: GameState, eotState: EndOfTurnPhaseState, playerIndex: number): ReducerResult {
  const newDone: [boolean, boolean] = [...eotState.resetHandDone] as [boolean, boolean];
  newDone[playerIndex] = true;

  if (newDone[0] && newDone[1]) {
    logDetail(`End-of-Turn reset-hand: both players done → advancing to signal-end`);
    return {
      state: {
        ...state,
        phaseState: { ...eotState, step: 'signal-end' as const, resetHandDone: newDone },
      },
    };
  }

  logDetail(`End-of-Turn reset-hand: player ${state.players[playerIndex].name} done, waiting for other player`);
  return {
    state: {
      ...state,
      phaseState: { ...eotState, resetHandDone: newDone },
    },
  };
}

function handleEndOfTurnResetHand(
  state: GameState,
  action: GameAction,
  eotState: EndOfTurnPhaseState,
): ReducerResult {
  // Pass during deck exhaust exchange sub-flow: complete the exhaust
  if (action.type === 'pass') {
    const pIdx = getPlayerIndex(state, action.player);
    if (state.players[pIdx].deckExhaustPending) {
      logDetail(`End-of-Turn reset-hand: player ${state.players[pIdx].name} completed deck exhaust exchange`);
      return { state: completeDeckExhaust(state, pIdx) };
    }
  }

  if (action.type === 'pass') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    logDetail(`End-of-Turn reset-hand: player ${player.name} at hand size, passed`);
    return markResetHandDone(state, eotState, playerIndex);
  }

  if (action.type === 'discard-card') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const handSize = resolveHandSize(state, playerIndex);
    const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
    const discardedCard = player.hand[cardIdx];
    const newHand = [...player.hand];
    newHand.splice(cardIdx, 1);

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = {
      ...player,
      hand: newHand,
      discardPile: [...player.discardPile, discardedCard],
    };

    logDetail(`End-of-Turn reset-hand: player ${player.name} discards 1 card (${newHand.length}/${handSize})`);

    const updatedState = { ...state, players: newPlayers };
    // At hand size after discarding → mark done
    if (newHand.length === handSize) {
      return markResetHandDone(updatedState, eotState, playerIndex);
    }

    return { state: updatedState };
  }

  if (action.type === 'deck-exhaust') {
    const playerIndex = getPlayerIndex(state, action.player);
    return { state: startDeckExhaust(state, playerIndex) };
  }

  if (action.type === 'exchange-sideboard') {
    return handleExchangeSideboard(state, action);
  }

  if (action.type === 'draw-cards') {
    const playerIndex = getPlayerIndex(state, action.player);
    const player = state.players[playerIndex];
    const handSize = resolveHandSize(state, playerIndex);

    if (player.playDeck.length === 0) {
      logDetail(`End-of-Turn reset-hand: player ${player.name} has no cards to draw`);
      return markResetHandDone(state, eotState, playerIndex);
    }

    const drawCount = Math.min(action.count, handSize - player.hand.length);
    const cardsToDrawCount = Math.min(drawCount, player.playDeck.length);
    const drawnCards = player.playDeck.slice(0, cardsToDrawCount);
    const newHand = [...player.hand, ...drawnCards];
    const newPlayDeck = player.playDeck.slice(cardsToDrawCount);

    const newPlayers = clonePlayers(state);
    newPlayers[playerIndex] = {
      ...player,
      hand: newHand,
      playDeck: newPlayDeck,
    };

    logDetail(`End-of-Turn reset-hand: player ${player.name} drew ${cardsToDrawCount} cards (${newHand.length}/${handSize})`);

    const updatedState = { ...state, players: newPlayers };
    // At hand size after drawing → mark done
    if (newHand.length === handSize) {
      return markResetHandDone(updatedState, eotState, playerIndex);
    }

    return { state: updatedState };
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn reset-hand step` };
}

/**
 * Step 3 (signal-end): Resource player signals end of turn.
 * Pass switches the active player and advances to the next turn's Untap phase.
 */


/**
 * Step 3 (signal-end): Resource player signals end of turn.
 * Pass switches the active player and advances to the next turn's Untap phase.
 */
function handleEndOfTurnSignalEnd(state: GameState, action: GameAction): ReducerResult {
  if (action.type === 'pass') {
    const currentIndex = getPlayerIndex(state, state.activePlayer!);
    const nextIndex = (currentIndex === 0 ? 1 : 0);
    const nextPlayer = state.players[nextIndex].id;

    // Check if this was the opponent's last turn after a Free Council call
    if (state.lastTurnFor === state.activePlayer) {
      logDetail(`End-of-Turn signal-end: ${action.player as string} finished their last turn → transitioning to Free Council`);
      return {
        state: transitionToFreeCouncil(state, state.activePlayer!),
      };
    }

    // Check auto-end: both players exhausted their deck twice
    if (state.players[0].deckExhaustionCount >= 2 && state.players[1].deckExhaustionCount >= 2) {
      logDetail(`End-of-Turn signal-end: both players exhausted deck twice → transitioning to Free Council`);
      return {
        state: transitionToFreeCouncil(state, state.activePlayer!),
      };
    }

    logDetail(`End-of-Turn signal-end: active player ${action.player as string} ended turn → switching to player ${nextPlayer as string}, turn ${state.turnNumber + 1}`);
    // Sweep turn-scoped pending resolutions and constraints (Stealth, etc.)
    const swept = sweepExpired(state, { kind: 'turn-end' });
    return {
      state: enterUntapPhase({
        ...swept,
        activePlayer: nextPlayer,
        turnNumber: swept.turnNumber + 1,
      }),
    };
  }

  if (action.type === 'call-free-council') {
    const currentIndex = getPlayerIndex(state, state.activePlayer!);
    const nextIndex = (currentIndex === 0 ? 1 : 0);
    const nextPlayer = state.players[nextIndex].id;

    const newPlayers = clonePlayers(state);
    newPlayers[currentIndex] = { ...newPlayers[currentIndex], freeCouncilCalled: true };

    logDetail(`End-of-Turn signal-end: ${action.player as string} called the Free Council — opponent ${nextPlayer as string} gets one last turn`);
    return {
      state: enterUntapPhase({
        ...state,
        players: newPlayers,
        activePlayer: nextPlayer,
        turnNumber: state.turnNumber + 1,
        lastTurnFor: nextPlayer,
      }),
    };
  }

  return { state, error: `Unexpected action '${action.type}' in end-of-turn signal-end step` };
}

/**
 * Creates the initial Free Council phase state. The player who took the last
 * turn performs corruption checks first.
 */


/**
 * Creates the initial Free Council phase state. The player who took the last
 * turn performs corruption checks first.
 */
function transitionToFreeCouncil(state: GameState, lastTurnPlayer: PlayerId): GameState {
  logHeading('Transitioning to Free Council phase');
  return {
    ...state,
    activePlayer: lastTurnPlayer,
    phaseState: {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: lastTurnPlayer,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    },
  };
}


/**
 * Handles actions during the Free Council phase.
 *
 * During 'corruption-checks' step, each player performs corruption checks
 * for their characters in turn. When both players have finished (or passed),
 * final scores are computed and the game transitions to Game Over.
 */

