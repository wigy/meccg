/**
 * @module ai/h2/core/evaluation
 *
 * The one way a module turns an outcome distribution into an {@link Evaluation}.
 *
 * Every module ends the same way: score the outcomes through the standing's
 * risk oracle, copy the scored moments into the evaluation, and splice the
 * scorer's own rationale in as the last child of the headline node so the
 * conversion is explained beside the numbers it produced. Writing that literal
 * out in every module invited drift — a module that forgot the spliced
 * rationale would still type-check, and its explanation would silently stop at
 * the TSD arithmetic. This builder is that ending, written once.
 *
 * Not for evaluations that price a *difference of two scored arrangements* or
 * otherwise hand-build their moments (`method: 'integrated'` with a zero σ, an
 * expectation the scorer never saw): those are not this shape, and forcing
 * them through it would hide exactly the deviation their comments explain.
 */

import type { Evaluation, Outcome, Rationale, Standing } from './types.js';
import type { GameAction } from '@meccg/shared';
import { node } from './rationale.js';

/** Everything the standard evaluation ending needs. */
export interface ScoredEvaluationParams {
  /** The action being evaluated. */
  readonly action: GameAction;
  /** Name of the module producing the evaluation. */
  readonly module: string;
  /** The outcome distribution, exactly as it is scored and reported. */
  readonly outcomes: readonly Outcome[];
  /** The standing whose `score` converts the distribution to a utility. */
  readonly standing: Standing;
  /** Label of the root rationale node. */
  readonly headline: string;
  /** The module's own derivation, spliced in ahead of the scorer's. */
  readonly detail: readonly Rationale[];
  /** Simplifications the number rests on; see {@link Evaluation.assumptions}. */
  readonly assumptions: readonly string[];
}

/**
 * Score `outcomes` against `standing` and wrap the result in the standard
 * evaluation shape: the scored moments verbatim, and a `winprob` headline node
 * holding the module's `detail` followed by the scorer's rationale.
 */
export function scoredEvaluation(params: ScoredEvaluationParams): Evaluation {
  const { action, module, outcomes, standing, headline, detail, assumptions } = params;
  const scored = standing.score(outcomes);
  return {
    action,
    module,
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(headline, scored.utility, [...detail, scored.rationale], { unit: 'winprob' }),
    assumptions,
  };
}
