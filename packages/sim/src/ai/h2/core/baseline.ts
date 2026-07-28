/**
 * @module ai/h2/core/baseline
 *
 * Passing, when no module has a reason to say anything about it.
 *
 * `coverage` put this at the top of the work list by a factor of three: `pass`
 * left 476 contested decisions unscored in three games, more than
 * `split-company`, `activate-granted-action` and `cancel-movement` combined.
 * Three modules own `pass` inside their own windows — `combat` at a strike,
 * `travel` at a company selection, `hazards` at the hazard limit — and nobody
 * owns it anywhere else, so a site phase offering four scored resource plays
 * and one unscored `pass` went to Heuristics 1 entire.
 *
 * The fix is not a twelfth module. It belongs in `core` because it is not an
 * opinion: **a utility is a change in win probability relative to doing
 * nothing**, and passing *is* doing nothing, so its utility is zero by
 * construction. Writing a module to say so would dress a definition up as a
 * judgement, and would need a context gate that duplicated the three real
 * owners' gates in the negative.
 *
 * So the registry falls back to this only when no module claims the `pass`, and
 * the three that do keep saying what they say — combat's pass at a strike is a
 * real decision with a real cost, and nothing here overrides it.
 *
 * What it concedes: passing sometimes *advances* the game to a state worth
 * reaching, and ending a phase early is occasionally the point rather than the
 * absence of one. That is not modelled, and the assumption says so.
 */

import type { GameAction } from '@meccg/shared';
import type { Evaluation, ModuleContext } from './types.js';
import { leaf, node } from './rationale.js';

/** Action types the baseline can speak for. */
export const BASELINE_ACTION_TYPES: readonly string[] = ['pass'];

/** Name reported as the contributor, so a reader can see it was not a module. */
export const BASELINE_NAME = 'baseline';

/** The assumption the zero rests on. */
const ASSUMPTIONS: readonly string[] = [
  'passing is scored at zero because a utility is a change relative to doing nothing, and this is '
  + 'doing nothing — not because the position was examined',
  'ending a phase is sometimes worth something in itself, to reach a step the player wants; that '
  + 'is not modelled here',
];

/**
 * The do-nothing baseline for an action no module claims.
 *
 * Returns null for anything else, so the registry can treat it exactly like a
 * module that declined. It reads nothing from the context — the zero does not
 * depend on the position, which is the whole claim being made.
 */
export function evaluateBaseline(action: GameAction, _context: ModuleContext): Evaluation | null {
  if (!BASELINE_ACTION_TYPES.includes(action.type)) return null;
  return {
    action,
    module: BASELINE_NAME,
    outcomes: [{ p: 1, label: 'take no action', dtsd: 0 }],
    expectedTsd: 0,
    sigmaTsd: 0,
    utility: 0,
    method: 'integrated',
    rationale: node('pass', 0, [
      leaf('change from doing nothing', 0, {
        unit: 'winprob',
        note: 'zero by construction — no module claimed this window',
      }),
    ], { unit: 'winprob' }),
    assumptions: ASSUMPTIONS,
  };
}
