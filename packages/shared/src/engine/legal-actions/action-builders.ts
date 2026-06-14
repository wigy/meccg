/**
 * @module legal-actions/action-builders
 *
 * Small constructors for recurring {@link EvaluatedAction} shapes produced by
 * the legal-actions subsystem. Centralizing them keeps the action structure
 * in one place rather than re-spelling the same object literal at every
 * call site.
 */

import type { PlayerId, CardInstanceId, EvaluatedAction } from '../../index.js';

/**
 * Builds the non-viable `not-playable` placeholder for a hand card that has
 * no legal play in the current phase. The `reason` is shown to the player as
 * a tooltip explaining why the card cannot be used right now.
 */
export function notPlayable(
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  reason: string,
): EvaluatedAction {
  return {
    action: { type: 'not-playable', player, cardInstanceId },
    viable: false,
    reason,
  };
}
