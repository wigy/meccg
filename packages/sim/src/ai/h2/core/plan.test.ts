/**
 * @module ai/h2/core/plan.test
 *
 * A plan's arithmetic is two numbers and a compatibility rule, and each of the
 * three has a way of being wrong that no self-play run would surface.
 *
 * `P(complete)` is a product, so a step wrongly treated as certain inflates it
 * silently — and the abandon rule reads that number, which means an
 * over-confident plan is one the portfolio will never give up on. The value is
 * payoff times that probability, so a plan that cannot be reached has to price
 * at nothing rather than at its payoff. And `conflicts` decides what can be
 * committed together: too strict and the agent carries one plan at a time, too
 * loose and it commits a company to two sites and completes neither.
 */

import { describe, test, expect } from 'vitest';
import type { CardInstanceId, CompanyId } from '@meccg/shared';
import type { Plan, PlanStep, Requirement } from './plan.js';
import {
  completionProbability,
  conflicts,
  describeRequirement,
  expectedValueTsd,
  planRationale,
} from './plan.js';

/** A plan with the given steps and requirements, and nothing else notable. */
function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'resources/item-at-isengard',
    module: 'resources',
    goal: { label: 'play Hauberk at Isengard', source: 'item', mp: 2 },
    payoffTsd: 4,
    deadline: 12,
    requirements: [],
    steps: [],
    ...overrides,
  };
}

/** A step that goes right with probability `p`. */
function step(label: string, p: number): PlanStep {
  return { label, p };
}

const COMPANY_A = 'company-p1-0' as CompanyId;
const COMPANY_B = 'company-p1-1' as CompanyId;
const HAUBERK = 'p1-42' as CardInstanceId;
const THEODEN = 'p1-7' as CardInstanceId;

/** A company-at-site requirement, with the pieces that matter to conflicts. */
function atSite(companyId: CompanyId, siteDefinitionId: string): Requirement {
  return { kind: 'company-at-site', companyId, siteDefinitionId, byTurn: 12 };
}

describe('completionProbability', () => {
  test('multiplies the steps rather than taking the worst of them', () => {
    // Three coin flips is one chance in eight, not one in two. Reporting the
    // minimum is the natural mistake and it makes long plans look cheap.
    const p = completionProbability(plan({
      steps: [step('reach Isengard', 0.5), step('survive the attack', 0.5), step('make the roll', 0.5)],
    }));
    expect(p).toBeCloseTo(0.125, 6);
  });

  test('is certain when nothing is left to go wrong', () => {
    expect(completionProbability(plan({ steps: [] }))).toBe(1);
  });

  test('is zero the moment any step is impossible', () => {
    const p = completionProbability(plan({
      steps: [step('reach Isengard', 0.9), step('have a tap', 0)],
    }));
    expect(p).toBe(0);
  });
});

describe('expectedValueTsd', () => {
  test('discounts the payoff by the chance of getting there', () => {
    expect(expectedValueTsd(plan({ payoffTsd: 4, steps: [step('reach it', 0.25)] }))).toBe(1);
  });

  test('prices an unreachable plan at nothing, not at its payoff', () => {
    expect(expectedValueTsd(plan({ payoffTsd: 40, steps: [step('reach it', 0)] }))).toBe(0);
  });

  test('carries the sign of a payoff that is worth nothing at this standing', () => {
    // CoE 10.3 step 4 caps a source at half the total, so a marginal point can
    // genuinely be worth zero — and a plan chasing it must price at zero too.
    expect(expectedValueTsd(plan({ payoffTsd: 0, steps: [step('reach it', 0.9)] }))).toBe(0);
  });
});

describe('conflicts', () => {
  test('refuses to send one company to two different sites', () => {
    const a = plan({ id: 'a', requirements: [atSite(COMPANY_A, 'isengard')] });
    const b = plan({ id: 'b', requirements: [atSite(COMPANY_A, 'tolfalas')] });
    expect(conflicts(a, b)).toBe(true);
  });

  test('allows two plans that need the same company at the same site', () => {
    // Playing two items on one trip is the point of the trip.
    const a = plan({ id: 'a', requirements: [atSite(COMPANY_A, 'isengard')] });
    const b = plan({ id: 'b', requirements: [atSite(COMPANY_A, 'isengard')] });
    expect(conflicts(a, b)).toBe(false);
  });

  test('allows two companies to go to different sites', () => {
    const a = plan({ id: 'a', requirements: [atSite(COMPANY_A, 'isengard')] });
    const b = plan({ id: 'b', requirements: [atSite(COMPANY_B, 'tolfalas')] });
    expect(conflicts(a, b)).toBe(false);
  });

  test('refuses to tap one character for two goals', () => {
    const untapped: Requirement = { kind: 'untapped-character', characterInstanceId: THEODEN };
    expect(conflicts(plan({ id: 'a', requirements: [untapped] }),
      plan({ id: 'b', requirements: [untapped] }))).toBe(true);
  });

  test('refuses to play one card for two goals', () => {
    const a = plan({ id: 'a', goal: { label: 'play Hauberk', source: 'item', mp: 2, cardInstanceId: HAUBERK } });
    const b = plan({ id: 'b', goal: { label: 'store Hauberk', source: 'item', mp: 1, cardInstanceId: HAUBERK } });
    expect(conflicts(a, b)).toBe(true);
  });

  test('refuses to hold one card in hand for two goals', () => {
    const inHand: Requirement = { kind: 'card-in-hand', cardInstanceId: HAUBERK };
    expect(conflicts(plan({ id: 'a', requirements: [inHand] }),
      plan({ id: 'b', requirements: [inHand] }))).toBe(true);
  });

  test('does not invent a conflict between unrelated plans', () => {
    const a = plan({ id: 'a', requirements: [atSite(COMPANY_A, 'isengard')] });
    const b = plan({ id: 'b', requirements: [{ kind: 'untapped-character', characterInstanceId: THEODEN }] });
    expect(conflicts(a, b)).toBe(false);
  });
});

describe('planRationale', () => {
  test('reports the value and names every step that produced it', () => {
    const rationale = planRationale(plan({
      payoffTsd: 4,
      steps: [step('reach Isengard', 0.5), step('make the roll', 0.5)],
    }));
    expect(rationale.label).toBe('play Hauberk at Isengard');
    expect(rationale.value).toBe(1);

    const probability = rationale.children?.find(c => c.label === 'P(complete)');
    expect(probability?.value).toBeCloseTo(0.25, 6);
    expect(probability?.children?.map(c => c.label))
      .toEqual(['reach Isengard', 'make the roll']);
  });

  test('says so when the independence assumption has nothing to assume', () => {
    const probability = planRationale(plan({ steps: [] }))
      .children?.find(c => c.label === 'P(complete)');
    expect(probability?.note).toBe('nothing left to go wrong');
  });
});

describe('describeRequirement', () => {
  test('names the site and the deadline a company has to meet', () => {
    expect(describeRequirement(atSite(COMPANY_A, 'isengard')))
      .toBe('company-p1-0 at isengard by turn 12');
  });
});
