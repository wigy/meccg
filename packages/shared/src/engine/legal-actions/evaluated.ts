/**
 * @module legal-actions/evaluated
 *
 * Shared helpers for working with {@link EvaluatedAction} values produced by
 * the legal-actions subsystem.
 *
 * Setup steps and phase handlers that perform no viability evaluation produce
 * plain {@link GameAction}s. Those are wrapped here as unconditionally viable
 * {@link EvaluatedAction}s, so the wrapping logic lives in one place rather
 * than being re-declared in every handler.
 */

import type { GameAction, EvaluatedAction } from '../../index.js';

/** Wraps plain GameActions as unconditionally viable EvaluatedActions. */
export function asViable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}
