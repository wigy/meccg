/**
 * @module ai/h2/services/plan-value
 *
 * What a candidate action is worth to the commitments in force, per
 * `specs/2026-08-11-h2-plan-layer.md` §4.
 *
 * A plan's payoff is booked once, by the plan. An action can only move the
 * *probability* of collecting it, so a contribution is
 *
 * ```text
 *   payoff × [ P(complete | action) − P(complete | pass) ]
 * ```
 *
 * and the baseline is `pass` because that is the counterfactual every H2
 * utility is already measured against (`core/baseline`). Only a step's owner is
 * asked what the action does to it, which is what stops `travel` and
 * `resources` each reporting that they raised the same probability.
 *
 * ## Why the sum happens in TSD
 *
 * Modules return ΔP(win), and `W` is **nonlinear** in TSD. Adding two
 * win-probability deltas is therefore arithmetically wrong, and the error is
 * not small where the curve is steep — which is exactly the close game the
 * agent most needs to get right. So contributions are summed in TSD, shifted
 * onto the evaluation's own outcome distribution, and converted through `W`
 * **once**. Shifting the distribution rather than the mean is what preserves
 * σ: a plan contribution is deterministic given the action, so it moves every
 * outcome by the same amount and leaves the spread — and therefore the risk
 * posture's grip on it — intact.
 *
 * ## Two aggregation rules, and why both ship
 *
 * §7 of the spec settles the additive-versus-voting question by measurement
 * rather than argument: both rules ship behind `planAggregationMode` and the
 * gate decides. Additive is the default and the one the spec argues for.
 *
 * Rank-based voting needs voters that rank the *whole* candidate list, and no
 * module can do that — a module scores only the actions it owns. The voters
 * are therefore the **tactical ranking** and **each committed plan**: every
 * plan ranks the candidates by what they do to it, the tactical evaluation
 * ranks them by its own utility, and the Borda counts are summed. That
 * discards magnitude, which is the point of asking for it and the reason it is
 * the challenger rather than the default.
 *
 * ## The influence cap
 *
 * One plan cannot contribute more than `planInfluenceCapTsd` to any single
 * decision. Most H2 modules are uncalibrated — five are, 46 claims in all — so
 * a proposer with a broken payoff can otherwise dominate every ranking it
 * touches. The cap bounds the damage; `calibrate` is the actual fix.
 */

import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../core/types.js';
import type { Plan } from '../core/plan.js';
import { completionProbability, completionProbabilityWith } from '../core/plan.js';
import { leaf, node } from '../core/rationale.js';
import type { Commitment } from './portfolio.js';

/** What one plan says about one action. */
export interface PlanContribution {
  readonly plan: Plan;
  /** `P(complete)` if this action is taken. */
  readonly probabilityAfter: number;
  /** `P(complete)` if the agent passes instead. */
  readonly probabilityBefore: number;
  /** Payoff × the change in probability, after the influence cap. */
  readonly deltaTsd: number;
  /** Modules that moved a step, for the rationale tree. */
  readonly movedBy: readonly string[];
}

/**
 * What every committed plan says about one action.
 *
 * Plans no module moved are omitted rather than reported at zero: a decision
 * with eight commitments and one relevant candidate would otherwise print
 * seven lines of nothing, and `explain` is the only way this layer is
 * debuggable.
 */
export function contributionsFor(
  modules: readonly H2Module[],
  commitment: Commitment,
  action: GameAction,
  context: ModuleContext,
): readonly PlanContribution[] {
  const byName = new Map(modules.map(m => [m.name, m]));
  const contributions: PlanContribution[] = [];

  for (const plan of commitment.plans) {
    const revised = new Map<number, number>();
    const movedBy = new Set<string>();
    plan.steps.forEach((step, index) => {
      const owner = byName.get(step.owner);
      if (!owner?.planStepDelta) return;
      const p = owner.planStepDelta(action, plan, step, index, context);
      if (p === null || p === undefined || p === step.p) return;
      revised.set(index, Math.max(0, Math.min(1, p)));
      movedBy.add(owner.name);
    });
    if (revised.size === 0) continue;

    const before = completionProbability(plan);
    const after = completionProbabilityWith(plan, revised);
    const uncapped = plan.payoffTsd * (after - before);
    const cap = context.tunables.planInfluenceCapTsd;
    contributions.push({
      plan,
      probabilityBefore: before,
      probabilityAfter: after,
      deltaTsd: Math.max(-cap, Math.min(cap, uncapped)),
      movedBy: [...movedBy].sort(),
    });
  }
  return contributions;
}

/** Total TSD a candidate is worth to the commitments, weighted and capped. */
export function totalDeltaTsd(
  contributions: readonly PlanContribution[],
  context: ModuleContext,
): number {
  const total = contributions.reduce((sum, c) => sum + c.deltaTsd, 0);
  return total * context.tunables.planContributionWeight;
}

/** Shift every outcome by the same TSD, preserving the spread. */
function shifted(outcomes: readonly Outcome[], deltaTsd: number): Outcome[] {
  return outcomes.map(o => ({ ...o, dtsd: o.dtsd + deltaTsd }));
}

/** The contributions as an explanation tree. */
export function contributionRationale(
  contributions: readonly PlanContribution[],
  totalTsd: number,
): Rationale {
  return node('plan contributions', totalTsd, contributions.map(c => node(
    c.plan.goal.label,
    c.deltaTsd,
    [
      leaf('payoff', c.plan.payoffTsd, { unit: 'tsd' }),
      leaf('P(complete) if passed', c.probabilityBefore, { unit: 'p' }),
      leaf('P(complete) if taken', c.probabilityAfter, { unit: 'p' }),
      leaf('moved by', c.movedBy.join(', ')),
    ],
    { unit: 'tsd' },
  )), { unit: 'tsd', tunable: 'planContributionWeight' });
}

/** An evaluation with the plan contributions folded in. */
export interface PlannedEvaluation {
  readonly evaluation: Evaluation;
  readonly contributions: readonly PlanContribution[];
  readonly deltaTsd: number;
}

/**
 * Fold the plan contributions into a ranking, additively.
 *
 * The contribution is shifted onto each evaluation's outcome distribution and
 * the whole thing is re-scored through `standing`, so `W` is applied once to a
 * distribution that already contains both terms. Re-ranking afterwards is not
 * optional: the entire purpose is that a candidate serving a commitment can
 * outrank one that looked better tactically.
 */
export function applyAdditive(
  evaluations: readonly Evaluation[],
  contributionsOf: (evaluation: Evaluation) => readonly PlanContribution[],
  context: ModuleContext,
): PlannedEvaluation[] {
  const planned = evaluations.map(evaluation => {
    const contributions = contributionsOf(evaluation);
    const deltaTsd = totalDeltaTsd(contributions, context);
    if (deltaTsd === 0) return { evaluation, contributions, deltaTsd };

    const outcomes = shifted(evaluation.outcomes, deltaTsd);
    const scored = context.standing.score(outcomes);
    return {
      evaluation: {
        ...evaluation,
        outcomes,
        expectedTsd: scored.expectedTsd,
        sigmaTsd: scored.sigmaTsd,
        utility: scored.utility,
        rationale: node(evaluation.rationale.label, evaluation.rationale.value, [
          ...(evaluation.rationale.children ?? []),
          contributionRationale(contributions, deltaTsd),
        ], { unit: evaluation.rationale.unit, note: evaluation.rationale.note }),
      },
      contributions,
      deltaTsd,
    };
  });
  planned.sort((a, b) => b.evaluation.utility - a.evaluation.utility);
  return planned;
}

/**
 * Fold the plan contributions into a ranking by Borda count.
 *
 * The challenger rule of §7. Voters are the tactical ranking and each
 * committed plan; each ranks the candidates it has an opinion about, and the
 * points are summed. Ties share the average of the positions they span, so a
 * voter with no opinion — every candidate equal, which is the common case for
 * a plan only one candidate touches — contributes the same to everyone and
 * therefore contributes nothing, rather than silently ordering them by
 * whatever the array order happened to be.
 *
 * Magnitude is discarded by construction. That is the property being tested,
 * not an oversight: it is what makes the rule robust to an uncalibrated module
 * and what makes it unable to say that one action is worth ten times another.
 */
export function applyVoting(
  evaluations: readonly Evaluation[],
  contributionsOf: (evaluation: Evaluation) => readonly PlanContribution[],
  commitment: Commitment,
  context: ModuleContext,
): PlannedEvaluation[] {
  const entries = evaluations.map(evaluation => ({
    evaluation,
    contributions: contributionsOf(evaluation),
    deltaTsd: 0,
  }));

  const ballots: number[][] = [entries.map(e => e.evaluation.utility)];
  for (const plan of commitment.plans) {
    ballots.push(entries.map(e =>
      e.contributions.find(c => c.plan.id === plan.id)?.deltaTsd ?? 0));
  }

  const points = entries.map(() => 0);
  for (const ballot of ballots) {
    for (const rank of bordaPoints(ballot)) points[rank.index] += rank.points;
  }

  const planned = entries.map((entry, index) => ({
    ...entry,
    deltaTsd: totalDeltaTsd(entry.contributions, context),
    evaluation: {
      ...entry.evaluation,
      rationale: node(entry.evaluation.rationale.label, entry.evaluation.rationale.value, [
        ...(entry.evaluation.rationale.children ?? []),
        leaf('Borda points', points[index], { tunable: 'planAggregationMode' }),
        contributionRationale(entry.contributions, totalDeltaTsd(entry.contributions, context)),
      ], { unit: entry.evaluation.rationale.unit, note: entry.evaluation.rationale.note }),
    },
  }));

  // The utility is left as the module reported it — voting does not produce a
  // win-probability, and inventing one would put a number in the field every
  // other tool reads as ΔP(win). The order is the output.
  return planned
    .map((entry, index) => ({ entry, points: points[index] }))
    .sort((a, b) => b.points - a.points || b.entry.evaluation.utility - a.entry.evaluation.utility)
    .map(x => x.entry);
}

/** Borda points for one ballot, averaging over ties. */
function bordaPoints(scores: readonly number[]): { index: number; points: number }[] {
  const order = scores.map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score);
  const result: { index: number; points: number }[] = [];
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j < order.length && order[j].score === order[i].score) j++;
    // Positions i..j-1 are tied; each takes the mean of the points they span.
    const points = ((order.length - 1 - i) + (order.length - j)) / 2;
    for (let k = i; k < j; k++) result.push({ index: order[k].index, points });
    i = j;
  }
  return result;
}

/** Aggregation modes, as `planAggregationMode` spells them. */
export const AGGREGATION_ADDITIVE = 0;
/** Rank-based voting — the §7 challenger. */
export const AGGREGATION_VOTING = 1;

/**
 * Rank the candidates with the commitments taken into account.
 *
 * Returns the evaluations untouched when there is nothing committed, which is
 * both the fast path and the honest one: with no plans there is no plan layer,
 * and every number should be exactly what it was before this module existed.
 */
export function rankWithPlans(
  modules: readonly H2Module[],
  evaluations: readonly Evaluation[],
  commitment: Commitment,
  context: ModuleContext,
): PlannedEvaluation[] {
  if (commitment.plans.length === 0 || context.tunables.planContributionWeight === 0) {
    return evaluations.map(evaluation => ({ evaluation, contributions: [], deltaTsd: 0 }));
  }
  const cache = new Map<Evaluation, readonly PlanContribution[]>();
  const contributionsOf = (evaluation: Evaluation): readonly PlanContribution[] => {
    let found = cache.get(evaluation);
    if (!found) {
      found = contributionsFor(modules, commitment, evaluation.action, context);
      cache.set(evaluation, found);
    }
    return found;
  };
  return context.tunables.planAggregationMode === AGGREGATION_VOTING
    ? applyVoting(evaluations, contributionsOf, commitment, context)
    : applyAdditive(evaluations, contributionsOf, context);
}
