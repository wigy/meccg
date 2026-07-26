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

import type { GameState, GameAction } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { logHeading, logDetail } from './legal-actions/log.js';
import { recomputeDerived } from './recompute-derived.js';
import { applyManifestationCascade } from './manifestations.js';
import { handleChainAction } from './chain-reducer.js';
import { accrueRevealedInstances } from './visibility.js';
import { sweepSetAside } from './set-aside.js';
import { sweepPressGang } from './press-gang.js';
import { sweepFallenWizardSpecific } from './fallen-wizard-specific.js';
import { sweepGreatHuntDiscards } from './great-hunt.js';
import { sweepDiscardSelfWhen } from './discard-self-when.js';
import { sweepKeywordReplaced } from './keyword-replaced.js';

/**
 * Post-action housekeeping: sweep manifestation cascades (METD §4.2) and
 * orphaned "off to the side" cards (MEAS §1) whose host has left play, discard a
 * Fallen-wizard's wizard-specific stage cards once their avatar leaves (MEWH
 * §12), then re-derive aggregates so MP/influence totals reflect any cards
 * moved, then record any newly-revealed card identities from public locations.
 */
function postReduce(state: GameState, prevState?: GameState): GameState {
  // A More Evil Hour (ba-48): tap the card when the opponent just played a
  // card giving them 3+ marshalling points. Runs first, on the raw post-action
  // state, so the later sweeps/recompute see the tapped status.
  const tapped = prevState ? applyEvilHourTaps(prevState, state) : state;
  // Alliance of Free Peoples (as-45): discard the card when a matching faction
  // just left its controller's play area. Prev/next diff, so it runs on the raw
  // post-action state before the single-state sweeps and recompute below.
  const afterLeaves = prevState ? applyDiscardOnCardLeaves(prevState, tapped) : tapped;
  const swept = sweepKeywordReplaced(sweepProhibitedCompanyEvents(sweepDiscardSelfWhen(sweepGreatHuntDiscards(sweepFallenWizardSpecific(sweepPressGang(sweepSetAside(discardOrphanedFactionAttachedEvents(discardOrphanedStoredAttachedEvents(discardOrphanedItemAttachedEvents(discardOrphanedConvertedAllyEvents(discardOrphanedAgentAttachedEvents(discardOrphanedSiteAttachedEvents(discardOrphanedControlledFactions(applyManifestationCascade(afterLeaves)))))))))))))));
  // The Will of Sauron (tw-100): when the card retaining hazard long-events left
  // play this step, every hazard long-event goes with it. Runs *after* the
  // single-state sweeps so a retainer discarded by its own `discard-self-when`
  // (Doors of Night gone) is already absent from the state being compared.
  const afterRetention = prevState ? sweepRetainedHazardLongEvents(prevState, swept) : swept;
  return accrueRevealedInstances(recomputeDerived(afterRetention));
}

export type { ReducerResult } from './reducer-utils.js';
import type { ReducerResult } from './reducer-utils.js';
import { handleFetchFromPile, resolvePendingEffect, discardOrphanedControlledFactions, discardOrphanedSiteAttachedEvents, discardOrphanedAgentAttachedEvents, discardOrphanedConvertedAllyEvents, discardOrphanedItemAttachedEvents, discardOrphanedFactionAttachedEvents, discardOrphanedStoredAttachedEvents, sweepProhibitedCompanyEvents } from './reducer-utils.js';
import { topResolutionFor } from './pending.js';
import { applyEvilHourTaps } from './evil-hour.js';
import { applyDiscardOnCardLeaves } from './discard-on-card-leaves.js';
import { sweepRetainedHazardLongEvents } from './retain-hazard-long-events.js';
import { applyResolution } from './pending-handlers.js';
import { applyPairResourceWithCof } from './pending-reducers.js';
import { handleSetup } from './reducer-setup.js';
import { handleUntap } from './reducer-untap.js';
import { handleOrganization } from './reducer-organization.js';
import { handleLongEvent } from './reducer-events.js';
import { handleMovementHazard, autoAdvanceMHOrderEffects } from './reducer-movement-hazard.js';
import { handleSite } from './reducer-site.js';
import { handleEndOfTurn, reshuffleCardFromHand } from './reducer-end-of-turn.js';
import { handleFreeCouncil } from './reducer-free-council.js';
import { handleCombatAction, COMBAT_ACTION_TYPES } from './reducer-combat.js';

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

  // Capture any public-pile identities present in the input state before
  // the handler runs. This matters when a card's public occupancy is
  // about to change mid-reducer (e.g. Marvels Told moves a publicly-known
  // Foolish Words from the opponent's cardsInPlay to their private
  // discard in a single action). The postReduce accrual would otherwise
  // only see the final state and miss the pre-action public tenure.
  state = accrueRevealedInstances(state);

  const phase = state.phaseState.phase;

  // Chain of effects: dispatch chain-specific actions when a chain is active
  if (state.chain != null && (action.type === 'pass-chain-priority' || action.type === 'order-passives' || action.type === 'reveal-on-guard' || action.type === 'cancel-return-to-origin' || action.type === 'cancel-hazard-event' || action.type === 'counter-cancel-roll' || action.type === 'counter-cancel-attack')) {
    logDetail(`Chain active — dispatching '${action.type}' to chain reducer`);
    const chainResult = handleChainAction(state, action);
    if (!chainResult.error) {
      const recomputed = postReduce(chainResult.state, state);
      return {
        state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
        effects: chainResult.effects,
      };
    }
    return chainResult;
  }

  // Combat: dispatch combat-specific actions when combat is active.
  // The routable set (COMBAT_ACTION_TYPES) is derived from the combat handler
  // map in reducer-combat.ts, so it can never drift from the handlers. It
  // includes play-short-event so resource short-events played between or during
  // strike sequences (rule 3.iv / 3.iv.5) are routed to the combat handler
  // rather than the site-phase reducer, which cannot accept them while the
  // automatic-attacks step is active.
  // When a chain is active, play-short-event may be a hazard chain response
  // (e.g. Searching Eye canceling Concealment). Route these through the phase
  // handler, which distinguishes resource vs hazard events correctly.
  const isChainShortEvent = state.chain != null && action.type === 'play-short-event';
  // A pending resolution queued for the acting player takes precedence over
  // combat routing: while a resolution is on the stack (e.g. Scourge of Fire's
  // discard-one-company-item during a CvCC), the legal actions are its
  // resolution actions only. Some resolution actions share a type with a combat
  // handler (e.g. `discard-item-from-company`, used both by An Article Missing's
  // combat sub-phase and the discard-one-company-item resolution), so without
  // this guard such an action would be misrouted to the combat handler.
  const combatPendingTop = topResolutionFor(state, action.player);
  // A pending card effect (e.g. a resource event's fetch-to-deck queued as the
  // chain collapsed alongside a creature entry that started combat) must resolve
  // before combat routing — its `fetch-from-pile`/`pass` is dispatched by the
  // pending-effects gate below. Without this guard the pending fetch was skipped
  // by the combat `pass` branch and lost (Smoke Rings dm-159 "disappeared
  // without effect", game mrs06zup-du4wde seq 128).
  if (state.combat != null && state.pendingEffects.length === 0 && combatPendingTop === null && !isChainShortEvent && (COMBAT_ACTION_TYPES.has(action.type) || (action.type === 'pass' && (state.combat.phase === 'assign-strikes' || state.combat.phase === 'item-salvage' || state.combat.phase === 'resolve-strike' || state.combat.phase === 'trophy-offer')))) {
    logDetail(`Combat active — dispatching '${action.type}' to combat handler`);
    const combatResult = handleCombatAction(state, action);
    if (!combatResult.error) {
      let finalState = combatResult.state;
      let finalEffects = combatResult.effects;
      // After ahunt combat resolves, auto-advance through order-effects to the
      // next ahunt attack or draw-cards without requiring a player pass.
      if (!finalState.combat && finalState.phaseState.phase === Phase.MovementHazard) {
        const ps = finalState.phaseState;
        if (ps.step === 'order-effects') {
          const advResult = autoAdvanceMHOrderEffects(finalState, ps);
          if (!advResult.error) {
            finalState = advResult.state;
            finalEffects = [...(finalEffects ?? []), ...(advResult.effects ?? [])];
          }
        }
      }
      const recomputed = postReduce(finalState, state);
      return {
        state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
        effects: finalEffects,
      };
    }
    return combatResult;
  }

  // While a chain is declaring, responses (e.g. play-permanent-event,
  // play-short-event) flow to the phase handlers, which push them onto the
  // chain; pending effects/resolutions only regain priority once the chain
  // resolves — mirroring the dispatch order of computeLegalActions.
  const chainDeclaring = state.chain != null && state.chain.mode !== 'resolving';

  // Pending effects: resolve card effects awaiting player interaction.
  // Checked BEFORE pending resolutions to mirror computeLegalActions, which
  // offers the effect's fetch-from-pile/pass to the effect's actor even
  // while a pending resolution (e.g. a corruption check) is also queued —
  // the reducer must accept exactly what was offered.
  const pendingEffectActor = !chainDeclaring && state.pendingEffects.length > 0
    ? (state.pendingEffects[0].actor ?? state.activePlayer)
    : null;
  if (pendingEffectActor === action.player && (action.type === 'fetch-from-pile' || action.type === 'pass')) {
    logDetail(`Pending effect active — dispatching '${action.type}' to effect handler`);
    let effectResult: ReducerResult;
    if (action.type === 'fetch-from-pile') {
      effectResult = handleFetchFromPile(state, action);
    } else {
      effectResult = resolvePendingEffect(state);
    }
    if (!effectResult.error) {
      const recomputed = postReduce(effectResult.state, state);
      return { state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 }, effects: effectResult.effects };
    }
    return effectResult;
  }

  // Pending resolutions: dispatch through the unified resolver before
  // delegating to the per-phase reducer. The handler is responsible for
  // dequeuing the resolution it consumes. Skipped while a chain is
  // declaring (see chainDeclaring above).
  const topResolution = chainDeclaring ? null : topResolutionFor(state, action.player);
  if (topResolution !== null) {
    logDetail(`Pending resolution active (${topResolution.kind.type}) — dispatching to applyResolution`);
    const resolutionResult = applyResolution(state, action, topResolution);
    if (resolutionResult !== null) {
      if (!resolutionResult.error) {
        const recomputed = postReduce(resolutionResult.state, state);
        return {
          state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 },
          effects: resolutionResult.effects,
        };
      }
      return resolutionResult;
    }
    // Stub returned null — fall through to legacy phase reducer.
  }

  // Crown of Flowers (dm-121): pairing a resource with an in-play Crown of
  // Flowers is a non-blocking organization-phase action (not a pending
  // resolution), so it is dispatched here directly. Its legality is gated by
  // `cofPairResourceActions` in `legal-actions/organization.ts`.
  if (action.type === 'pair-resource-with-cof') {
    const pairResult = applyPairResourceWithCof(state, action);
    if (pairResult.error) return pairResult;
    const recomputed = postReduce(pairResult.state, state);
    return { state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 }, effects: pairResult.effects };
  }

  // Cross-phase `reshuffle-card-from-hand` (e.g. Sudden Call, le-235):
  // dispatched before phase handlers so it works in every strategy step.
  if (action.type === 'reshuffle-card-from-hand') {
    const newState = reshuffleCardFromHand(state, action.player, action.cardInstanceId);
    if (newState === null) {
      return { state, error: `Card ${action.cardInstanceId as string} not found in ${action.player as string}'s hand` };
    }
    const recomputed = postReduce(newState, state);
    return { state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 } };
  }

  // Pending effects whose actor is the opponent of the acting player were
  // handled above; any remaining fetch-from-pile/pass for a queued effect
  // still routes to the effect handler (legacy path for effects without an
  // explicit actor when the active player differs).
  if (state.pendingEffects.length > 0 && (action.type === 'fetch-from-pile' || action.type === 'pass')) {
    logDetail(`Pending effect active — dispatching '${action.type}' to effect handler`);
    let effectResult: ReducerResult;
    if (action.type === 'fetch-from-pile') {
      effectResult = handleFetchFromPile(state, action);
    } else {
      effectResult = resolvePendingEffect(state);
    }
    if (!effectResult.error) {
      const recomputed = postReduce(effectResult.state, state);
      return { state: { ...recomputed, stateSeq: recomputed.stateSeq + 1 }, effects: effectResult.effects };
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
    const recomputed = postReduce(result.state, state);
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
