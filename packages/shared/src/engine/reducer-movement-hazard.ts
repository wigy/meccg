/**
 * @module reducer-movement-hazard
 *
 * Movement/Hazard phase handlers for the game reducer. Covers company selection,
 * site revelation, hazard play, creature keying, on-guard placement, draw cards,
 * and hand reset sub-steps.
 */

import type { GameState, MovementHazardPhaseState, GameAction } from '../index.js';
import { getPlayerIndex, requirePhaseState } from '../state-utils.js';
import { Phase } from '../types/state-phases.js';
import { resolveHandSize } from './effects/index.js';
import { logDetail } from './legal-actions/log.js';
import type { ReducerResult } from './reducer-utils.js';
import { findById, removeById, updatePlayer, wrongActionType, playerById, defById } from './reducer-utils.js';
import { isResourceEventCard } from '../types/cards.js';
import { handlePlayShortEvent, handlePlayResourceShortEvent, dispatchShortEventByCardType } from './reducer-events.js';
import { handlePlayHazards, advanceAfterCompanyMH, handleGangwaysOffer, handleExtraMHMoveOffer, handleAllyTapExtraMHOffer } from './mh-hazard-play.js';
import { enterSetHazardLimitAndAutoAdvance, handleSelectCompany, handleRevealNewSite, handleUnderDeepsRoll, handleOrderEffects, handleDrawCards } from './mh-steps.js';
import { handleGrantActionApply } from './grant-action-apply.js';


/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */
type MHHandler = (state: GameState, action: GameAction, mhState: MovementHazardPhaseState) => ReducerResult;

/**
 * Per-step dispatch for the Movement/Hazard phase. Pending wound corruption
 * checks (Barrow-wight et al.) are intercepted by the unified
 * pending-resolution dispatcher before this table is consulted.
 */
const MH_STEP_HANDLERS: Readonly<Record<MovementHazardPhaseState['step'], MHHandler>> = {
  'select-company': handleSelectCompany,
  'reveal-new-site': handleRevealNewSite,
  'under-deeps-roll': handleUnderDeepsRoll,
  'set-hazard-limit': handleSetHazardLimit,
  'order-effects': handleOrderEffectsStep,
  'draw-cards': handleDrawCards,
  'play-hazards': handlePlayHazards,
  'reset-hand': handleResetHand,
  'gangways-offer': handleGangwaysOffer,
  'extra-mh-move-offer': handleExtraMHMoveOffer,
  'ally-tap-mh-offer': handleAllyTapExtraMHOffer,
};

export function handleMovementHazard(state: GameState, action: GameAction): ReducerResult {
  const mhState = requirePhaseState(state, Phase.MovementHazard);
  const handler = MH_STEP_HANDLERS[mhState.step];
  if (!handler) return { state, error: `Unexpected step '${mhState.step as string}' in movement/hazard phase` };
  const result = handler(state, action, mhState);
  // Chains and pending resolutions open short-event response windows in
  // every step; if a rigid step handler rejected one, fall back to the
  // shared by-card-type dispatch so an advertised action is never refused.
  if (result.error && action.type === 'play-short-event') {
    logDetail(`M/H step '${mhState.step as string}' rejected play-short-event (${result.error}) — dispatching via shared short-event flow`);
    return dispatchShortEventByCardType(state, action);
  }
  return result;
}

/**
 * Auto-advance through the order-effects step.
 *
 * Called when the state lands on order-effects with no active combat —
 * specifically after each ahunt combat resolves — to immediately process
 * the next ahunt or transition to draw-cards without requiring a player pass.
 * Exported so reducer.ts can apply it as a post-combat-resolution hook.
 */
export function autoAdvanceMHOrderEffects(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  logDetail(`Movement/Hazard: auto-advancing through order-effects (post-ahunt or initial entry)`);
  return handleOrderEffects(state, mhState);
}

/** @deprecated No longer reachable; set-hazard-limit is now auto-advanced. Kept for step dispatch map. */
function handleSetHazardLimit(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass', 'set-hazard-limit step');
  return enterSetHazardLimitAndAutoAdvance(state, mhState);
}

/** Advance from the order-effects step once the hazard player passes. */
function handleOrderEffectsStep(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass', 'order-effects step');
  return handleOrderEffects(state, mhState);
}

/**
 * Handle the reset-hand step: players with hand > HAND_SIZE must discard.
 * Each discard-card action removes one card. Once both players are at or
 * below hand size, advance to the next company or Site phase.
 */
function handleResetHand(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  // Granted-action activation (e.g. River: ranger taps to cancel the
  // constraint on an arriving company). CRF 22 gives the ranger's player
  // until the beginning of the site phase to tap, so the cancel window
  // must stay open through reset-hand — the last M/H step before Site.
  // The constraint pass-through offers this action in every step, so every
  // step handler must route it (engine gap class: an offered action must
  // never be rejected by the reducer).
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }

  // A short event may legally arrive during reset-hand — e.g. a
  // corruption-check-boost offered by a pending resolution whose resolver
  // delegates the play to the phase reducer. Dispatch it like the
  // organization phase does.
  if (action.type === 'play-short-event') {
    const player = playerById(state, action.player);
    const card = action.cardInstanceId ? player?.hand.find(c => c.instanceId === action.cardInstanceId) : undefined;
    const def = card ? defById(state, card.definitionId) : undefined;
    return isResourceEventCard(def)
      ? handlePlayResourceShortEvent(state, action)
      : handlePlayShortEvent(state, action);
  }

  // Pass is legal only when every player is already at hand size (the step
  // was entered with nothing to discard) — it simply advances.
  if (action.type === 'pass') {
    if (state.players.every((p, i) => p.hand.length <= resolveHandSize(state, i))) {
      logDetail('Reset-hand: all players at hand size — advancing');
      return advanceAfterCompanyMH(state, mhState);
    }
    return { state, error: 'Cannot pass the reset-hand step while a hand exceeds the hand size' };
  }

  if (action.type !== 'discard-card') return wrongActionType(state, action, 'discard-card', 'reset-hand step');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const discardedCard = findById(player.hand, action.cardInstanceId);
  if (!discardedCard) return { state, error: 'Card not found in hand' };
  const newHand = removeById(player.hand, discardedCard.instanceId);

  const updatedState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, discardedCard],
  }));

  logDetail(`Reset-hand: player ${player.name} discards 1 card (hand now ${newHand.length})`);

  // Check if both players are now at hand size
  if (updatedState.players.every((p, i) => p.hand.length <= resolveHandSize(updatedState, i))) {
    logDetail(`Reset-hand: all players at hand size → advancing`);
    return advanceAfterCompanyMH(updatedState, mhState);
  }

  return { state: updatedState };
}

/**
 * Advance to the next company's M/H sub-phase or to the Site phase
 * after the current company's step 8 is fully resolved.
 */

