/**
 * @module ai/h2/services/plan-value.test
 *
 * Three properties, each of which is a way this layer could be quietly wrong.
 *
 * **Only the owner may move a step.** Without that, `travel` and `resources`
 * can each report raising the same `P(complete)` by 0.3 and the sum
 * double-counts — the same defect the single-owner action registry exists to
 * prevent, one level down, and invisible in any game result.
 *
 * **The sum happens in TSD, not in win probability.** `W` is nonlinear, so
 * adding two ΔP(win) figures is arithmetically wrong, and wrong hardest in the
 * close games the agent most needs to get right. Shifting the outcome
 * distribution and re-scoring once is what keeps that honest — and it has to
 * preserve σ, or the risk posture loses its grip on the action.
 *
 * **Voting must discard magnitude.** That is the property being bought, and a
 * Borda implementation that quietly leaks the underlying numbers would pass a
 * "does it rank sensibly" test while measuring nothing §7 asked for.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Standing } from '../core/types.js';
import type { Plan, PlanStep } from '../core/plan.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { leaf } from '../core/rationale.js';
import {
  AGGREGATION_VOTING,
  contributionsFor,
  rankWithPlans,
} from './plan-value.js';
import type { Commitment } from './portfolio.js';

const MOVE = { type: 'plan-movement' } as unknown as GameAction;
const PASS = { type: 'pass' } as unknown as GameAction;

/** A plan with one step owned by `travel`. */
function plan(id: string, payoffTsd: number, p = 0.25): Plan {
  return {
    id,
    module: 'resources',
    goal: { label: id, source: 'item', mp: 2 },
    payoffTsd,
    deadline: 20,
    requirements: [],
    steps: [{ label: `route for ${id}`, p, owner: 'travel', tag: 'route' }],
  };
}

/** A module that sets its owned step to `to` whenever the action is `MOVE`. */
function mover(name: string, to: number): H2Module {
  return {
    name,
    ownedActionTypes: [],
    evaluate: () => null,
    planStepDelta: (action: GameAction, _plan: Plan, _step: PlanStep) =>
      (action === MOVE ? to : null),
  };
}

/**
 * A standing that converts TSD to utility linearly.
 *
 * Linear on purpose: the point of these tests is *which* numbers are summed
 * and in what order, and a realistic `W` would hide an addition-order bug
 * inside its own curvature.
 */
function standing(): Standing {
  return {
    score(outcomes: readonly Outcome[]) {
      const expectedTsd = outcomes.reduce((sum, o) => sum + o.p * o.dtsd, 0);
      const variance = outcomes.reduce((sum, o) => sum + o.p * (o.dtsd - expectedTsd) ** 2, 0);
      const sigmaTsd = Math.sqrt(variance);
      return { expectedTsd, sigmaTsd, utility: expectedTsd / 100, method: 'integrated' as const };
    },
  } as unknown as Standing;
}

/** A module context with the given tunable overrides. */
function context(overrides: Partial<typeof DEFAULT_TUNABLES> = {}): ModuleContext {
  return {
    view: {} as never,
    cardPool: {},
    legalActions: [],
    tunables: { ...DEFAULT_TUNABLES, ...overrides },
    standing: standing(),
  };
}

/** An evaluation over a two-outcome distribution, so σ is non-zero. */
function evaluation(action: GameAction, dtsd: number): Evaluation {
  const outcomes: Outcome[] = [
    { p: 0.5, label: 'good', dtsd: dtsd + 1 },
    { p: 0.5, label: 'bad', dtsd: dtsd - 1 },
  ];
  return {
    action,
    module: 'travel',
    outcomes,
    expectedTsd: dtsd,
    sigmaTsd: 1,
    utility: dtsd / 100,
    method: 'integrated',
    rationale: leaf('tactical', dtsd, { unit: 'tsd' }),
    assumptions: [],
  };
}

/** A commitment holding exactly these plans. */
function commitment(...plans: Plan[]): Commitment {
  return { turn: 3, plans, dropped: [] };
}

describe('contributionsFor — step ownership', () => {
  test('asks only the step owner, so two modules cannot book the same rise', () => {
    // Both modules would happily claim the step. Only `travel` owns it, and
    // the contribution has to reflect one move, not two.
    const modules = [mover('travel', 1), mover('resources', 1)];
    const [contribution] = contributionsFor(modules, commitment(plan('a', 8)), MOVE, context());

    expect(contribution.probabilityBefore).toBe(0.25);
    expect(contribution.probabilityAfter).toBe(1);
    expect(contribution.deltaTsd).toBeCloseTo(6, 6);
    expect(contribution.movedBy).toEqual(['travel']);
  });

  test('ignores a module that does not own the step even when it is the proposer', () => {
    const [contribution] = contributionsFor(
      [mover('resources', 1)], commitment(plan('a', 8)), MOVE, context(),
    ) as [never] | [];
    expect(contribution).toBeUndefined();
  });

  test('omits plans nothing moved rather than reporting them at zero', () => {
    const contributions = contributionsFor(
      [mover('travel', 1)], commitment(plan('a', 8)), PASS, context(),
    );
    expect(contributions).toEqual([]);
  });

  test('a step driven to zero is the veto: the plan becomes worthless', () => {
    const contributions = contributionsFor(
      [mover('travel', 0)], commitment(plan('a', 8)), MOVE, context(),
    );
    expect(contributions[0].probabilityAfter).toBe(0);
    expect(contributions[0].deltaTsd).toBeCloseTo(-2, 6);
  });

  test('caps what one plan may contribute to a single decision', () => {
    const contributions = contributionsFor(
      [mover('travel', 1)], commitment(plan('a', 100)), MOVE, context({ planInfluenceCapTsd: 6 }),
    );
    expect(contributions[0].deltaTsd).toBe(6);
  });
});

describe('rankWithPlans — additive', () => {
  test('lets a candidate that serves a commitment outrank a better tactical move', () => {
    // The whole purpose. Passing looks better on the turn; moving is what
    // eventually scores, and only the plan can say so.
    const evaluations = [evaluation(PASS, 1), evaluation(MOVE, 0)];
    const ranked = rankWithPlans(
      [mover('travel', 1)], evaluations, commitment(plan('a', 8)), context(),
    );
    expect(ranked[0].evaluation.action).toBe(MOVE);
    expect(ranked[0].deltaTsd).toBeCloseTo(6, 6);
  });

  test('shifts the whole distribution, so the spread survives', () => {
    // σ is what the risk posture reads. Adding the contribution to the mean
    // alone would quietly make every planned action look certain.
    const [best] = rankWithPlans(
      [mover('travel', 1)], [evaluation(MOVE, 0)], commitment(plan('a', 8)), context(),
    );
    expect(best.evaluation.sigmaTsd).toBeCloseTo(1, 6);
    expect(best.evaluation.expectedTsd).toBeCloseTo(6, 6);
  });

  test('sums several commitments before converting once', () => {
    const [best] = rankWithPlans(
      [mover('travel', 1)],
      [evaluation(MOVE, 0)],
      commitment(plan('a', 4), plan('b', 4)),
      context(),
    );
    // Two plans at 4 payoff, each rising 0.25 → 1, is 3 + 3.
    expect(best.evaluation.expectedTsd).toBeCloseTo(6, 6);
  });

  test('is exactly the tactical ranking when nothing is committed', () => {
    const evaluations = [evaluation(PASS, 1), evaluation(MOVE, 0)];
    const ranked = rankWithPlans([mover('travel', 1)], evaluations, commitment(), context());
    expect(ranked.map(r => r.evaluation)).toEqual(evaluations);
  });

  test('is exactly the tactical ranking at zero weight', () => {
    const evaluations = [evaluation(PASS, 1), evaluation(MOVE, 0)];
    const ranked = rankWithPlans(
      [mover('travel', 1)], evaluations, commitment(plan('a', 8)),
      context({ planContributionWeight: 0 }),
    );
    expect(ranked.map(r => r.evaluation)).toEqual(evaluations);
  });
});

describe('rankWithPlans — voting', () => {
  test('a plan gets one ballot however large its payoff', () => {
    // The property §7 asks for. Additively this plan would dominate; by Borda
    // it is one voter against the tactical ranking, and the tie is broken by
    // the tactical utility.
    const evaluations = [evaluation(PASS, 10), evaluation(MOVE, 0)];
    const ranked = rankWithPlans(
      [mover('travel', 1)], evaluations, commitment(plan('a', 1000)),
      context({ planAggregationMode: AGGREGATION_VOTING }),
    );
    expect(ranked[0].evaluation.action).toBe(PASS);
  });

  test('two plans agreeing outvote the tactical ranking', () => {
    const evaluations = [evaluation(PASS, 10), evaluation(MOVE, 0)];
    const ranked = rankWithPlans(
      [mover('travel', 1)], evaluations, commitment(plan('a', 4), plan('b', 4)),
      context({ planAggregationMode: AGGREGATION_VOTING }),
    );
    expect(ranked[0].evaluation.action).toBe(MOVE);
  });

  test('leaves the utility as the module reported it', () => {
    // Voting produces an order, not a win probability. Writing a Borda count
    // into `utility` would put a non-probability in the field every other tool
    // reads as ΔP(win).
    const evaluations = [evaluation(MOVE, 0)];
    const [only] = rankWithPlans(
      [mover('travel', 1)], evaluations, commitment(plan('a', 8)),
      context({ planAggregationMode: AGGREGATION_VOTING }),
    );
    expect(only.evaluation.utility).toBe(evaluations[0].utility);
  });

  test('a voter with no opinion changes nothing', () => {
    // Every candidate scores the same on this ballot, so averaging over the
    // tie is what stops the array order deciding the ranking.
    const evaluations = [evaluation(PASS, 1), evaluation(MOVE, 0)];
    const ranked = rankWithPlans(
      [mover('travel', 0.25)], evaluations, commitment(plan('a', 8)),
      context({ planAggregationMode: AGGREGATION_VOTING }),
    );
    expect(ranked[0].evaluation.action).toBe(PASS);
  });
});
