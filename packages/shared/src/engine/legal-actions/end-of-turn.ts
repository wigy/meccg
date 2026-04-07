/**
 * @module legal-actions/end-of-turn
 *
 * Legal actions during the end-of-turn phase (CoE 2.VI).
 *
 * The phase has three steps:
 * 1. **discard** — Either player may voluntarily discard a card from hand.
 * 2. **reset-hand** — Both players draw or discard to reach base hand size (8).
 * 3. **signal-end** — Resource player signals end of turn and may call the
 *    Free Council to trigger the endgame.
 */

import type { GameState, PlayerId, GameAction, EndOfTurnPhaseState } from '../../index.js';
import { FREE_COUNCIL_MP_THRESHOLD, getPlayerIndex } from '../../index.js';
import { resolveHandSize } from '../effects/index.js';
import { logHeading, logDetail } from './log.js';
import { deckExhaustExchangeActions } from './movement-hazard.js';

/**
 * Compute legal actions for a player during the end-of-turn phase.
 *
 * During the 'discard' step, both players may discard any card from hand
 * or pass. During 'reset-hand', players with too many cards must discard
 * and players with too few draw. During 'signal-end', only the active
 * player may pass (ending the turn) or call the Free Council.
 */
export function endOfTurnActions(state: GameState, playerId: PlayerId): GameAction[] {
  const eotState = state.phaseState as EndOfTurnPhaseState;
  const step = eotState.step;
  logHeading(`End-of-Turn legal actions: step '${step}' for player ${playerId as string}`);

  switch (step) {
    case 'discard':
      return discardStepActions(state, playerId);
    case 'reset-hand':
      return resetHandStepActions(state, playerId);
    case 'signal-end':
      return signalEndStepActions(state, playerId);
    default:
      return [];
  }
}

/**
 * Step 1: Either player may discard a card from their own hand, or pass.
 * Both players pass to advance to reset-hand.
 */
function discardStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  const eotState = state.phaseState as EndOfTurnPhaseState;
  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const player = state.players[playerIndex];

  // Already acted this step — no actions
  if (eotState.discardDone[playerIndex]) {
    logDetail(`End-of-Turn discard: player ${player.name} already acted, no actions`);
    return [];
  }

  const actions: GameAction[] = [];

  // Each card in hand can be discarded
  for (const card of player.hand) {
    actions.push({ type: 'discard-card', player: playerId, cardInstanceId: card.instanceId });
  }

  // Always offer pass
  actions.push({ type: 'pass', player: playerId });

  logDetail(`End-of-Turn discard: player ${player.name} has ${player.hand.length} cards in hand, ${actions.length - 1} discard options + pass`);
  return actions;
}

/**
 * Step 2: Both players draw or discard to reach base hand size.
 * Players above hand size must discard; players below draw; at hand size, pass.
 */
function resetHandStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  const eotState = state.phaseState as EndOfTurnPhaseState;
  const playerIndex = state.players[0].id === playerId ? 0 : 1;
  const player = state.players[playerIndex];
  const handSize = resolveHandSize(state, playerIndex);
  const actions: GameAction[] = [];

  // Already done this step — no actions
  if (eotState.resetHandDone[playerIndex]) {
    logDetail(`End-of-Turn reset-hand: player ${player.name} already done, no actions`);
    return [];
  }

  // Deck exhaust exchange sub-flow: only exchange + pass actions
  if (player.deckExhaustPending) {
    return deckExhaustExchangeActions(state, player, playerId);
  }

  if (player.hand.length > handSize) {
    // Must discard down — offer each card as a discard option
    logDetail(`End-of-Turn reset-hand: player ${player.name} has ${player.hand.length} cards, must discard to ${handSize}`);
    for (const card of player.hand) {
      actions.push({ type: 'discard-card', player: playerId, cardInstanceId: card.instanceId });
    }
  } else if (player.hand.length < handSize) {
    if (player.playDeck.length === 0 && player.discardPile.length > 0) {
      // Deck empty but discard has cards — must exhaust before drawing
      logDetail(`End-of-Turn reset-hand: player ${player.name} deck empty — must exhaust`);
      actions.push({ type: 'deck-exhaust', player: playerId });
    } else if (player.playDeck.length === 0) {
      // No cards anywhere — pass
      logDetail(`End-of-Turn reset-hand: player ${player.name} has no cards to draw`);
      actions.push({ type: 'pass', player: playerId });
    } else {
      // Must draw up
      const drawCount = handSize - player.hand.length;
      logDetail(`End-of-Turn reset-hand: player ${player.name} has ${player.hand.length} cards, must draw ${drawCount} to reach ${handSize}`);
      actions.push({ type: 'draw-cards', player: playerId, count: drawCount });
    }
  } else {
    // At hand size — pass (nothing to do)
    logDetail(`End-of-Turn reset-hand: player ${player.name} already at hand size (${handSize})`);
    actions.push({ type: 'pass', player: playerId });
  }

  return actions;
}

/**
 * Step 3: Resource player signals end of turn. May also call the Free Council.
 * Only the active (resource) player has actions here.
 */
function signalEndStepActions(state: GameState, playerId: PlayerId): GameAction[] {
  if (state.activePlayer !== playerId) {
    logDetail(`End-of-Turn signal-end: not the resource player, no actions`);
    return [];
  }

  const actions: GameAction[] = [];

  // Offer call-free-council if eligible (Short game rules)
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  if (!player.freeCouncilCalled && state.lastTurnFor === null) {
    // Use raw (unadjusted) MP total for calling — tournament adjustments only apply at the council
    const mp = player.marshallingPoints;
    const rawScore = mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
    const exhaustions = player.deckExhaustionCount;
    const canCall = (rawScore >= FREE_COUNCIL_MP_THRESHOLD && exhaustions >= 1) || exhaustions >= 2;
    if (canCall) {
      logDetail(`End-of-Turn signal-end: ${player.name} eligible to call Free Council (raw MP ${rawScore}, exhaustions ${exhaustions})`);
      actions.push({ type: 'call-free-council', player: playerId });
    }
  }

  actions.push({ type: 'pass', player: playerId });
  logDetail(`End-of-Turn signal-end: resource player ${playerId as string} may pass to end turn`);
  return actions;
}
