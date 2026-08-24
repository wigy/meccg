/**
 * @module legal-actions/sideboard-subflow
 *
 * Shared builder for the "fetch cards from the sideboard" sub-flow that
 * three legal-action emitters run: the organization-phase avatar-tap access
 * (CoE 2.II.6, organization-sideboard.ts), the untap-phase hazard sideboard
 * access (CoE 2.I, untap.ts), and the movement/hazard-phase Nazgûl
 * sideboarding (rule 5.24, movement-hazard.ts). All three flows lock a
 * destination (`deck` or `discard`) into phase state and then offer one
 * fetch action per eligible sideboard card — exactly 1 card to the play
 * deck, or up to a cap to the discard pile — with `pass` closing the
 * to-discard sub-flow. This module builds those fetch/pass actions from a
 * per-flow configuration; each caller keeps its own intent (start) actions
 * and phase-state fields.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardDefinition,
} from '../../index.js';
import { logDetail } from './log.js';
import { filterSideboardByDef, playerById } from '../reducer-utils.js';

/**
 * Per-flow configuration for {@link sideboardFetchSubflowActions}. Captures
 * the phase-state snapshot of the active sub-flow (destination + fetch
 * counter) plus the flow-specific parameters: which action type is emitted,
 * which sideboard cards are eligible, the discard cap, and how the deck
 * branch behaves when there is nothing left to fetch.
 */
export interface SideboardFetchSubflowConfig {
  /** Destination locked into phase state by the flow's start/intent action. */
  readonly destination: 'deck' | 'discard';
  /** Number of cards already fetched in this sub-flow (or this turn, for the organization flow's shared counter). */
  readonly fetched: number;
  /** Maximum cards fetchable to the discard pile in this sub-flow. */
  readonly maxToDiscard: number;
  /** Action type emitted for each eligible sideboard card. */
  readonly fetchActionType: 'fetch-from-sideboard' | 'fetch-hazard-from-sideboard';
  /** Predicate selecting which sideboard cards are eligible to fetch. */
  readonly isEligible: (def: CardDefinition) => boolean;
  /** Prefix for the `logDetail` lines emitted while building actions. */
  readonly logPrefix: string;
  /**
   * Organization-flow deadlock guard. When true, the deck branch emits a
   * `pass` action (with an explanatory log) whenever the fetch counter is
   * already spent or no sideboard card is eligible — the shared per-turn
   * counter means the sub-flow can be entered with nothing left to fetch,
   * and only pass closes it — and reaching the discard cap is also logged.
   * When false (untap/Nazgûl flows) the deck branch returns no actions in
   * those situations: the reducer auto-exits the deck sub-flow after the
   * single fetch, so no guarding pass is needed.
   */
  readonly guardWithPass: boolean;
}

/**
 * Generates the fetch/pass actions for an active sideboard-fetch sub-flow.
 *
 * Deck destination: exactly one card may be picked (no pass while a pick is
 * possible); the discard destination offers fetches up to `maxToDiscard` and
 * a `pass` once at least one card has been fetched.
 */
export function sideboardFetchSubflowActions(
  state: GameState,
  playerId: PlayerId,
  cfg: SideboardFetchSubflowConfig,
): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  if (cfg.destination === 'deck') {
    if (cfg.fetched >= 1) {
      if (cfg.guardWithPass) {
        // The fetch counter is shared with the to-discard sub-flow, so the
        // deck sub-flow can be entered with nothing left to fetch — pass must
        // be available to exit it, or the phase deadlocks.
        logDetail(`${cfg.logPrefix}: already fetched a card this turn — must pass to close the sub-flow`);
        actions.push({ action: { type: 'pass', player: playerId }, viable: true });
      } else {
        logDetail(`${cfg.logPrefix}: already fetched 1 card to deck — sub-flow auto-exits`);
      }
      return actions;
    }
    // Must pick exactly 1 card — no pass while a pick is possible
    const eligible = filterSideboardByDef(state, player.sideboard, cfg.isEligible);
    for (const card of eligible) {
      logDetail(`${cfg.logPrefix}: ${card.name} → play deck (viable)`);
      actions.push({
        action: { type: cfg.fetchActionType, player: playerId, sideboardCardInstanceId: card.instanceId },
        viable: true,
      });
    }
    if (actions.length === 0 && cfg.guardWithPass) {
      logDetail(`${cfg.logPrefix}: no eligible cards to fetch to deck — must pass to close the sub-flow`);
      actions.push({ action: { type: 'pass', player: playerId }, viable: true });
    }
    return actions;
  }

  // ── destination === 'discard' ──
  if (cfg.fetched < cfg.maxToDiscard) {
    const eligible = filterSideboardByDef(state, player.sideboard, cfg.isEligible);
    for (const card of eligible) {
      logDetail(`${cfg.logPrefix}: ${card.name} → discard pile (viable)`);
      actions.push({
        action: { type: cfg.fetchActionType, player: playerId, sideboardCardInstanceId: card.instanceId },
        viable: true,
      });
    }
  } else if (cfg.guardWithPass) {
    // The sub-flow only closes on pass (the reducer clears the destination
    // there) — pass must stay available or the phase deadlocks at the cap.
    logDetail(`${cfg.logPrefix}: already fetched ${cfg.maxToDiscard} cards to discard this turn — must pass to close the sub-flow`);
  }
  // Pass available after at least 1 card fetched (this includes the at-cap case)
  if (cfg.fetched >= 1) {
    actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  }
  return actions;
}
