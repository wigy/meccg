/**
 * @module reducer
 *
 * The core game state reducer implementing the pure `(state, action) → state`
 * pattern. Every game mutation flows through {@link reduce}, which validates
 * the action, checks phase legality, and dispatches to the appropriate
 * phase handler.
 *
 * Phase-specific logic is split into dedicated modules:
 * - {@link module:reducer-utils} — shared utilities (cloning, dice, deck exhaust)
 * - {@link module:reducer-setup} — character/item draft, site selection, initiative
 * - {@link module:reducer-untap} — untap and hazard sideboard access
 * - {@link module:reducer-organization} — company management, movement planning
 * - {@link module:reducer-events} — permanent, short, and long event play
 * - {@link module:reducer-movement-hazard} — hazard play, creature keying, draws
 * - {@link module:reducer-site} — site entry, attacks, resource play, influence
 * - {@link module:reducer-end-of-turn} — discard, hand reset, game-end signal
 * - {@link module:reducer-free-council} — final corruption checks, scoring
 * - {@link module:reducer-combat} — strike assignment, resolution, body checks
 *
 * The reducer never mutates its input — it always returns a new state object
 * (or the original state plus an error string if the action was illegal).
 */

import type { GameState } from '../index.js';
import type { GameAction } from '../index.js';
import { Phase } from '../index.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { recomputeDerived } from './recompute-derived.js';
import { handleChainAction } from './chain-reducer.js';

export type { ReducerResult } from './reducer-utils.js';
import type { ReducerResult } from './reducer-utils.js';
import { handleFetchFromPile, resolvePendingEffect } from './reducer-utils.js';
import { topResolutionFor } from './pending.js';
import { applyResolution } from './pending-reducers.js';
import { handleSetup } from './reducer-setup.js';
import { handleUntap } from './reducer-untap.js';
import { handleOrganization } from './reducer-organization.js';
import { handleLongEvent } from './reducer-events.js';
import { handleMovementHazard } from './reducer-movement-hazard.js';
import { handleSite } from './reducer-site.js';
import { handleEndOfTurn } from './reducer-end-of-turn.js';
import { handleFreeCouncil } from './reducer-free-council.js';
import { handleCombatAction } from './reducer-combat.js';

// Re-export discardCardsInPlay for chain-reducer (preserves existing import path)
export { discardCardsInPlay } from './reducer-utils.js';

/**
 * Applies a single game action to the current state.
 *
 * The reducer trusts that the action has already been validated upstream
 * by membership lookup against the legal-action set sent to the player.
 * It dispatches to the appropriate sub-state handler (chain, combat,
 * pending resolution, pending effect) before falling through to the
 * phase reducer.
 *
 * @param state - The current authoritative game state.
 * @param action - The player action to apply.
 * @returns A {@link ReducerResult} with the new state or an error.
 */
export function reduce(state: GameState, action: GameAction): ReducerResult {
  logHeading(`Reducer: action '${action.type}' from player ${action.player as string} in phase '${state.phaseState.phase}'`);

  const phase = state.phaseState.phase;

  // Chain of effects: dispatch chain-specific actions when a chain is active
  if (state.chain != null && (action.type === 'pass-chain-priority' || action.type === 'order-passives' || action.type === 'reveal-on-guard' || action.type === 'cancel-hazard-by-tap')) {
    logDetail(`Chain active — dispatching '${action.type}' to chain reducer`);
    const chainResult = handleChainAction(state, action);
    if (!chainResult.error) {
      const recomputed = recomputeDerived(chainResult.state);
      return {
        state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
        effects: chainResult.effects,
      };
    }
    return chainResult;
  }

  // Combat: dispatch combat-specific actions when combat is active
  const combatActionTypes = ['assign-strike', 'choose-strike-order', 'resolve-strike', 'support-strike', 'body-check-roll', 'cancel-attack', 'cancel-by-tap', 'cancel-strike', 'play-dodge', 'halve-strikes', 'salvage-item'];
  if (state.combat != null && (combatActionTypes.includes(action.type) || (action.type === 'pass' && (state.combat.phase === 'assign-strikes' || state.combat.phase === 'item-salvage')))) {
    logDetail(`Combat active — dispatching '${action.type}' to combat handler`);
    const combatResult = handleCombatAction(state, action);
    if (!combatResult.error) {
      const recomputed = recomputeDerived(combatResult.state);
      return {
        state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
        effects: combatResult.effects,
      };
    }
    return combatResult;
  }

  // Pending resolutions: dispatch through the unified resolver before
  // delegating to the per-phase reducer. The handler is responsible for
  // dequeuing the resolution it consumes.
  const topResolution = topResolutionFor(state, action.player);
  if (topResolution !== null) {
    logDetail(`Pending resolution active (${topResolution.kind.type}) — dispatching to applyResolution`);
    const resolutionResult = applyResolution(state, action, topResolution);
    if (resolutionResult !== null) {
      if (!resolutionResult.error) {
        const recomputed = recomputeDerived(resolutionResult.state);
        return {
          state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
          effects: resolutionResult.effects,
        };
      }
      return resolutionResult;
    }
    // Stub returned null — fall through to legacy phase reducer.
  }

  // Pending effects: resolve card effects awaiting player interaction
  if (state.pendingEffects.length > 0 && (action.type === 'fetch-from-pile' || action.type === 'pass')) {
    logDetail(`Pending effect active — dispatching '${action.type}' to effect handler`);
    let effectResult: ReducerResult;
    if (action.type === 'fetch-from-pile') {
      effectResult = handleFetchFromPile(state, action);
    } else {
      effectResult = resolvePendingEffect(state);
    }
    if (!effectResult.error) {
      const recomputed = recomputeDerived(effectResult.state);
      return { state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 } };
    }
    return effectResult;
  }

  // Dispatch to phase handler
  let result: ReducerResult;
  switch (phase) {
    case Phase.Setup:
      result = handleSetup(state, action);
      break;
    case Phase.Untap:
      result = handleUntap(state, action);
      break;
    case Phase.Organization:
      result = handleOrganization(state, action);
      break;
    case Phase.LongEvent:
      result = handleLongEvent(state, action);
      break;
    case Phase.MovementHazard:
      result = handleMovementHazard(state, action);
      break;
    case Phase.Site:
      result = handleSite(state, action);
      break;
    case Phase.EndOfTurn:
      result = handleEndOfTurn(state, action);
      break;
    case Phase.FreeCouncil:
      result = handleFreeCouncil(state, action);
      break;
    case Phase.GameOver: {
      if (action.type === 'finished') {
        const goState = state.phaseState;
        if (goState.finishedPlayers.includes(action.player as string)) {
          return { state, error: 'Already finished' };
        }
        return {
          state: {
            ...state,
            phaseState: {
              ...goState,
              finishedPlayers: [...goState.finishedPlayers, action.player as string],
            },
          },
        };
      }
      return { state, error: 'Game is over' };
    }
    default:
      return { state, error: `Unknown phase: ${String(phase satisfies never)}` };
  }

  // Recompute derived values (MPs, general influence) from ground truth
  // and increment the state sequence number for log tracking.
  // Clear reverseActions whenever the phase changes.
  if (!result.error) {
    const recomputed = recomputeDerived(result.state);
    const phaseChanged = recomputed.phaseState.phase !== state.phaseState.phase;
    result = {
      state: {
        ...recomputed,
        stateSeq: recomputed.stateSeq + 1,
        ...(phaseChanged ? { reverseActions: [] } : {}),
      },
      effects: result.effects,
    };
  }

  return result;
}
