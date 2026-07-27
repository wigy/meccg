/**
 * @module retain-hazard-long-events
 *
 * The `retain-hazard-long-events` card effect: an in-play card that suspends the
 * normal end-of-long-event-phase discard of hazard long-events ([2.III.3]) and,
 * when it leaves play, takes every retained hazard long-event with it.
 *
 * Two halves live here:
 *
 * - {@link hazardLongEventsRetained} — the single-state query consulted by the
 *   long-event phase handler (`reducer-events.ts`) before it sweeps the hazard
 *   player's long-events. While a retainer is in play, the sweep is skipped and
 *   the long-events accumulate across turns.
 * - {@link sweepRetainedHazardLongEvents} — the prev/next diff that fires the
 *   "when this card is discarded, all hazard long events are discarded" half.
 *   Like {@link module:engine/discard-on-card-leaves} it is a reactive diff, so
 *   it fires no matter *how* the retainer left play (its own
 *   `discard-self-when` when Doors of Night goes away, deck exhaustion, a
 *   cancellation effect).
 *
 * Used by The Will of Sauron (tw-100): "All hazard long-events remain in play
 * until this card is discarded. … When this card is discarded, all hazard long
 * events are discarded."
 */
import type { CardInPlay, GameState } from '../index.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { defById, getCardEffects, discardCardsInPlayWhere } from './reducer-utils.js';

/**
 * Whether some card carrying `retain-hazard-long-events` is currently in play.
 * The effect is game-wide, so either player's `cardsInPlay` can supply it.
 * Cards held aside pending a trigger-attack resolution (`pendingTriggerAttack`)
 * and set-aside cards (MEAS §1) are not yet/no longer "in play" and do not
 * count.
 */
export function hazardLongEventsRetained(state: GameState): boolean {
  return state.players.some(player => player.cardsInPlay.some(card => isRetainer(state, card)));
}

/** Whether a single in-play card is an active `retain-hazard-long-events` source. */
function isRetainer(state: GameState, card: CardInPlay): boolean {
  if (card.pendingTriggerAttack === true) return false;
  if (card.setAsideHost !== undefined) return false;
  return getCardEffects(defById(state, card.definitionId))
    .some(e => e.type === 'retain-hazard-long-events');
}

/**
 * Discards every hazard long-event in play when the last
 * `retain-hazard-long-events` source just left play. `prev` is the pre-action
 * state, `next` the post-action state (after the single-state sweeps, so a
 * retainer discarded by its own `discard-self-when` in the same step is already
 * gone from `next`). Skipped during setup.
 */
export function sweepRetainedHazardLongEvents(prev: GameState, next: GameState): GameState {
  if (next.phaseState.phase === Phase.Setup) return next;
  if (!hazardLongEventsRetained(prev)) return next;
  if (hazardLongEventsRetained(next)) return next;

  logDetail('retain-hazard-long-events: last retainer left play → discarding all hazard long-events');
  return discardCardsInPlayWhere(
    next,
    card => {
      const def = defById(next, card.definitionId);
      return def?.cardType === 'hazard-event' && def.eventType === 'long';
    },
    (card, player) => {
      const def = defById(next, card.definitionId);
      logDetail(`retain-hazard-long-events: discarding "${def?.name ?? (card.definitionId as string)}" from ${player.name}`);
    },
  ).state;
}
