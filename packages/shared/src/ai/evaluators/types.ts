/**
 * @module ai/evaluators/types
 *
 * Per-phase action evaluator interface for the heuristic AI strategy.
 *
 * The dispatcher in `heuristic.ts` walks every legal action and asks the
 * evaluator registered for the current phase to score it. Returning `null`
 * means "no opinion" — the dispatcher then falls back to a default scoring
 * pass that mirrors the random strategy's pass-suppression behavior.
 */

import type { GameAction } from '../../types/actions.js';
import type { AiContext } from '../strategy.js';

/**
 * Scores actions for one or more game phases.
 *
 * Higher weights make an action more likely to be picked. A weight of 0
 * means "never". `null` means the evaluator has no opinion and the action
 * should be scored by the default fallback.
 */
export interface ActionEvaluator {
  /** Phase names this evaluator handles. */
  readonly phases: readonly string[];
  /** Compute a weight for the action, or `null` to defer to the default. */
  score(action: GameAction, context: AiContext): number | null;
}
