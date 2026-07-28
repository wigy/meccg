/**
 * @module ai/regress
 *
 * Dropping the actions the engine has already told us undo previous progress.
 *
 * `engine/reverse-actions.ts` computes, for every action taken during the
 * organization phase, the action that would undo it — and stamps `regress:
 * true` on any later candidate that matches. Its own module comment says what
 * the flag is for: "signalling to the AI that it undoes previous progress".
 *
 * So this is not a heuristic. It is a fact the engine hands over, and an agent
 * that ignores it will happily split a company, merge it back, and split it
 * again forever — which is exactly what happened. Heuristics 1 has filtered on
 * it since before Heuristics 2 existed; H2 and the Monte-Carlo searcher did
 * not, and both inherited the loop.
 *
 * This does not replace the modelling work that came with it. A shape change
 * and its undo scoring positively at the same time was a real incoherence in
 * `defence` — an order-dependent harm function and a price that moved with the
 * shape it was comparing — and those are fixed on their own terms, because a
 * model that contradicts itself gives bad *rankings* whether or not anything
 * loops. The flag is the engine's belt to that braces.
 */

import type { GameAction } from '@meccg/shared';

/** Whether the engine marked this candidate as undoing this phase's progress. */
export function isRegressive(action: GameAction): boolean {
  return 'regress' in action && (action as { regress?: boolean }).regress === true;
}

/**
 * The candidates that move the game forward.
 *
 * Returns the original list when *every* candidate is regressive, so an agent
 * is never handed an empty decision. That should not arise — passing is never a
 * reverse of anything — but a filter that can return nothing is a crash waiting
 * for the position that proves it.
 */
export function forwardActions(actions: readonly GameAction[]): readonly GameAction[] {
  const forward = actions.filter(action => !isRegressive(action));
  return forward.length > 0 ? forward : actions;
}
