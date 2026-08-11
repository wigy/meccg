/**
 * @module ai/h2/services/portfolio.test
 *
 * The portfolio's job is to stay committed, and the tests are mostly about
 * what it refuses to do.
 *
 * Plain `h2` already spends whole games alternating between a shape change and
 * its undo, because both score positive and the argmax of that pair oscillates.
 * Two plans alternating every turn is the same defect at strategic scale, and
 * worse: nothing completes, and the symptom is a slow loss rather than a hang,
 * so nothing in the outcome says the agent was thrashing. The switch margin is
 * what prevents it, and a margin is only testable on the *second* turn — which
 * is why `select` is a pure function of (incumbents, proposals) rather than
 * something you can only reach by playing a game.
 */

import { describe, test, expect } from 'vitest';
import type { CompanyId } from '@meccg/shared';
import type { Plan, Requirement } from '../core/plan.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { createPlanPortfolio, commitmentRationale, select } from './portfolio.js';

const TUNABLES = DEFAULT_TUNABLES;
const COMPANY_A = 'company-p1-0' as CompanyId;
const COMPANY_B = 'company-p1-1' as CompanyId;

/** A company-at-site requirement. */
function atSite(companyId: CompanyId, siteDefinitionId: string): Requirement {
  return { kind: 'company-at-site', companyId, siteDefinitionId, byTurn: 20 };
}

/** A plan worth `payoffTsd` that is certain to complete unless told otherwise. */
function plan(id: string, payoffTsd: number, overrides: Partial<Plan> = {}): Plan {
  return {
    id,
    module: 'resources',
    goal: { label: id, source: 'item', mp: 2 },
    payoffTsd,
    deadline: 20,
    requirements: [],
    steps: [],
    ...overrides,
  };
}

describe('select — compatibility', () => {
  test('commits everything that can coexist', () => {
    const commitment = select(1, [], [
      plan('a', 3, { requirements: [atSite(COMPANY_A, 'isengard')] }),
      plan('b', 2, { requirements: [atSite(COMPANY_B, 'tolfalas')] }),
    ], TUNABLES);
    expect(commitment.plans.map(p => p.id)).toEqual(['a', 'b']);
  });

  test('keeps the more valuable of two plans that cannot coexist', () => {
    const commitment = select(1, [], [
      plan('cheap', 1, { requirements: [atSite(COMPANY_A, 'tolfalas')] }),
      plan('rich', 5, { requirements: [atSite(COMPANY_A, 'isengard')] }),
    ], TUNABLES);
    expect(commitment.plans.map(p => p.id)).toEqual(['rich']);
  });

  test('ranks by expected value, not by payoff', () => {
    // A big payoff behind a hopeless journey is worth less than a small one
    // that will actually land, and the ordering has to say so.
    const commitment = select(1, [], [
      plan('longshot', 20, {
        requirements: [atSite(COMPANY_A, 'tolfalas')],
        steps: [{ label: 'get there', p: 0.1 }],
      }),
      plan('sure-thing', 5, { requirements: [atSite(COMPANY_A, 'isengard')] }),
    ], TUNABLES);
    expect(commitment.plans.map(p => p.id)).toEqual(['sure-thing']);
  });
});

describe('select — hysteresis', () => {
  test('keeps an incumbent a challenger only marginally beats', () => {
    // The thrash guard. Without it these two alternate every turn and neither
    // ever completes.
    const incumbent = plan('incumbent', 5, { requirements: [atSite(COMPANY_A, 'isengard')] });
    const challenger = plan('challenger', 5.5, { requirements: [atSite(COMPANY_A, 'tolfalas')] });

    const commitment = select(2, [incumbent], [incumbent, challenger], TUNABLES);
    expect(commitment.plans.map(p => p.id)).toEqual(['incumbent']);
  });

  test('switches when the challenger clears the margin', () => {
    const incumbent = plan('incumbent', 5, { requirements: [atSite(COMPANY_A, 'isengard')] });
    const challenger = plan('challenger', 9, { requirements: [atSite(COMPANY_A, 'tolfalas')] });

    const commitment = select(2, [incumbent], [incumbent, challenger], TUNABLES);
    expect(commitment.plans.map(p => p.id)).toEqual(['challenger']);
    expect(commitment.dropped).toEqual([{ plan: incumbent, reason: 'displaced' }]);
  });

  test('charges the margin against everything it displaces, not the best of them', () => {
    // Otherwise one plan worth a little more than the best incumbent evicts
    // three of them and the portfolio loses value doing it.
    const first = plan('first', 4, { requirements: [atSite(COMPANY_A, 'isengard')] });
    const second = plan('second', 4, { requirements: [atSite(COMPANY_B, 'isengard')] });
    const challenger = plan('challenger', 6, {
      requirements: [atSite(COMPANY_A, 'tolfalas'), atSite(COMPANY_B, 'tolfalas')],
    });

    const commitment = select(2, [first, second], [first, second, challenger], TUNABLES);
    expect(commitment.plans.map(p => p.id).sort()).toEqual(['first', 'second']);
  });

  test('re-reads an incumbent from this turn, because the numbers move', () => {
    // The same commitment is a different bet once the company is two regions
    // closer, and carrying last turn's figure would make the abandon rule read
    // a stale probability.
    const before = plan('a', 4, { steps: [{ label: 'get there', p: 0.5 }] });
    const after = plan('a', 4, { steps: [{ label: 'get there', p: 0.9 }] });

    const commitment = select(2, [before], [after], TUNABLES);
    expect(commitment.plans[0].steps[0].p).toBe(0.9);
  });
});

describe('select — leaving the portfolio', () => {
  test('drops a plan its proposer no longer offers', () => {
    const incumbent = plan('a', 5);
    const commitment = select(2, [incumbent], [], TUNABLES);
    expect(commitment.plans).toEqual([]);
    expect(commitment.dropped).toEqual([{ plan: incumbent, reason: 'withdrawn' }]);
  });

  test('drops a plan whose deadline has passed', () => {
    const stale = plan('a', 5, { deadline: 3 });
    const commitment = select(4, [stale], [stale], TUNABLES);
    expect(commitment.plans).toEqual([]);
    expect(commitment.dropped[0].reason).toBe('deadline-passed');
  });

  test('keeps a plan due exactly this turn', () => {
    const due = plan('a', 5, { deadline: 4 });
    expect(select(4, [due], [due], TUNABLES).plans.map(p => p.id)).toEqual(['a']);
  });

  test('abandons a plan whose completion probability has collapsed', () => {
    const doomed = plan('a', 5, { steps: [{ label: 'survive', p: 0.01 }] });
    const commitment = select(2, [doomed], [doomed], TUNABLES);
    expect(commitment.plans).toEqual([]);
    expect(commitment.dropped[0].reason).toBe('abandoned');
  });

  test('never admits a challenger that would be abandoned immediately', () => {
    const doomed = plan('a', 50, { steps: [{ label: 'survive', p: 0.001 }] });
    expect(select(1, [], [doomed], TUNABLES).plans).toEqual([]);
  });
});

describe('createPlanPortfolio', () => {
  test('commits once per turn and returns the same set within it', () => {
    const portfolio = createPlanPortfolio();
    const first = portfolio.commit(1, [plan('a', 5)], TUNABLES);
    // A different proposal set inside the same turn must not re-open the
    // commitment: re-selecting per decision is the thrash on a shorter clock.
    const second = portfolio.commit(1, [plan('b', 50)], TUNABLES);
    expect(second).toBe(first);
    expect(second.plans.map(p => p.id)).toEqual(['a']);
  });

  test('re-commits when the turn advances', () => {
    const portfolio = createPlanPortfolio();
    portfolio.commit(1, [plan('a', 5)], TUNABLES);
    const next = portfolio.commit(2, [plan('a', 5), plan('b', 50)], TUNABLES);
    expect(next.plans.map(p => p.id)).toEqual(['b', 'a']);
  });

  test('forgets everything on reset, so a commitment cannot cross games', () => {
    const portfolio = createPlanPortfolio();
    portfolio.commit(1, [plan('a', 5)], TUNABLES);
    portfolio.reset();
    expect(portfolio.current().plans).toEqual([]);
    // …and the next game's turn 1 is planned from nothing, not from the last
    // game's incumbents.
    expect(portfolio.commit(1, [], TUNABLES).plans).toEqual([]);
  });
});

describe('commitmentRationale', () => {
  test('totals the committed value and lists what was dropped', () => {
    const kept = plan('kept', 4);
    const gone = plan('gone', 3);
    const rationale = commitmentRationale(select(2, [gone], [kept], TUNABLES));
    expect(rationale.value).toBe(4);
    const dropped = rationale.children?.find(c => c.label === 'dropped this turn');
    expect(dropped?.children?.[0]).toMatchObject({ label: 'gone', value: 'withdrawn' });
  });

  test('says plainly when no module proposed anything', () => {
    const rationale = commitmentRationale(select(1, [], [], TUNABLES));
    expect(rationale.children?.[0].label).toBe('nothing proposed');
  });
});
