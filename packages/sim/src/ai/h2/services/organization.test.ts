/**
 * @module ai/h2/services/organization.test
 *
 * The conditions that make the organization potential a potential, per spec
 * §5: one `Organization` per position, `valueOf` a function of the
 * arrangement as a *set*, and the "resources to play for all" gate falling
 * out of the matching's injectivity rather than out of a counting rule.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardInstanceId } from '@meccg/shared';
import { DEFAULT_TUNABLES, withTunable } from '../core/tunables.js';
import type { Commitment } from '../core/plan.js';
import { computeStanding } from './standing.js';
import { loadWinProbModel } from '../core/winprob.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import type { Arrangement } from './organization.js';
import { computeOrganization } from './organization.js';

const cardPool = loadCardPool();
const model = loadWinProbModel();

function organizationFor(scenarioId: string, commitment?: Commitment) {
  const view = scenarioView(loadScenario(scenarioId));
  const standing = computeStanding(view, model, DEFAULT_TUNABLES);
  return {
    view,
    standing,
    organization: computeOrganization(view, cardPool, standing, DEFAULT_TUNABLES, commitment),
  };
}

describe('one Organization per position', () => {
  test('the memo is hit: recompute equals cached, by identity', () => {
    const view = scenarioView(loadScenario('organization/trailing-split-two-goals'));
    const standing = computeStanding(view, model, DEFAULT_TUNABLES);
    const first = computeOrganization(view, cardPool, standing, DEFAULT_TUNABLES, undefined);
    const second = computeOrganization(view, cardPool, standing, DEFAULT_TUNABLES, undefined);
    expect(second).toBe(first);
  });
});

describe('whole-board invariance', () => {
  test('valueOf of a permuted arrangement equals the original', () => {
    const { organization } = organizationFor('organization/trailing-split-two-goals');
    const current = organization.current();
    // Split the big company so the arrangement has several companies to
    // permute, then reverse everything reversible.
    const [big, ...rest] = [...current.companies].sort(
      (a, b) => b.characterIds.length - a.characterIds.length);
    const arrangement: Arrangement = {
      companies: [
        ...rest,
        { ...big, characterIds: big.characterIds.slice(0, 2) },
        { ...big, characterIds: big.characterIds.slice(2) },
      ],
    };
    const permuted: Arrangement = {
      companies: [...arrangement.companies].reverse().map(company => ({
        ...company,
        characterIds: [...company.characterIds].reverse(),
      })),
    };
    const original = organization.valueOf(arrangement);
    const shuffled = organization.valueOf(permuted);
    expect(shuffled.u).toBe(original.u);
    expect(shuffled.expectedTsd).toBe(original.expectedTsd);
    expect(shuffled.harmTsd).toBe(original.harmTsd);
    expect(shuffled.opportunityTsd).toBe(original.opportunityTsd);
    expect(shuffled.outcomes).toEqual(original.outcomes);
  });
});

describe('resources to play for all', () => {
  test('a spun-off company with no distinct goal adds zero opportunity', () => {
    // One playable item in hand: the matching is injective over distinct
    // cards, so the second company can serve nothing the first could not,
    // and only the harm term moves.
    const { organization } = organizationFor('organization/trailing-split-no-second-goal');
    const current = organization.current();
    const big = [...current.companies].sort(
      (a, b) => b.characterIds.length - a.characterIds.length)[0];
    const others = current.companies.filter(c => c !== big);
    const split: Arrangement = {
      companies: [
        ...others,
        { ...big, characterIds: [big.characterIds[0]] },
        { ...big, characterIds: big.characterIds.slice(1) },
      ],
    };
    const before = organization.valueOf(current);
    const after = organization.valueOf(split);
    expect(after.opportunityTsd).toBeCloseTo(before.opportunityTsd, 9);
    expect(after.harmTsd).not.toBeCloseTo(before.harmTsd, 3);
  });

  test('with a second goal in hand, the split company is credited for serving it', () => {
    const { organization } = organizationFor('organization/trailing-split-two-goals');
    expect(organization.goals.length).toBeGreaterThanOrEqual(2);
    const current = organization.current();
    const big = [...current.companies].sort(
      (a, b) => b.characterIds.length - a.characterIds.length)[0];
    const others = current.companies.filter(c => c !== big);
    const split: Arrangement = {
      companies: [
        ...others,
        { ...big, characterIds: [big.characterIds[0]] },
        { ...big, characterIds: big.characterIds.slice(1) },
      ],
    };
    const before = organization.valueOf(current);
    const after = organization.valueOf(split);
    expect(before.assignments.length).toBe(1);
    expect(after.assignments.length).toBe(2);
    expect(after.opportunityTsd).toBeGreaterThan(before.opportunityTsd);
  });
});

describe('the goal list', () => {
  test('a committed card is not also an opportunity', () => {
    const bare = organizationFor('organization/trailing-split-two-goals');
    const opportunityGoal = bare.organization.goals.find(g => !g.committed)!;
    expect(opportunityGoal).toBeDefined();

    const commitment: Commitment = {
      turn: bare.view.turnNumber,
      plans: [{
        id: `resources/${opportunityGoal.cardInstanceId as string}@${opportunityGoal.siteDefinitionId}`,
        module: 'resources',
        goal: {
          label: opportunityGoal.label,
          source: 'item',
          mp: 4,
          cardInstanceId: opportunityGoal.cardInstanceId as CardInstanceId,
          siteDefinitionId: opportunityGoal.siteDefinitionId,
        },
        payoffTsd: opportunityGoal.payoffTsd,
        deadline: bare.view.turnNumber + 6,
        requirements: [],
        steps: [],
      }],
      dropped: [],
    };
    const committed = computeOrganization(
      bare.view, cardPool, bare.standing, DEFAULT_TUNABLES, commitment);
    const forCard = committed.goals.filter(
      g => g.cardInstanceId === opportunityGoal.cardInstanceId);
    expect(forCard).toHaveLength(1);
    expect(forCard[0].committed).toBe(true);
    // Committed payoff is taken as-is — undiscounted.
    expect(forCard[0].discountedPayoffTsd).toBe(opportunityGoal.payoffTsd);
  });

  test('the cap binds deterministically and is reported', () => {
    const view = scenarioView(loadScenario('organization/trailing-split-two-goals'));
    const standing = computeStanding(view, model, DEFAULT_TUNABLES);
    const capped = withTunable(DEFAULT_TUNABLES, 'organizationGoalCap', 1);
    const organization = computeOrganization(view, cardPool, standing, capped, undefined);
    expect(organization.goals).toHaveLength(1);
    expect(organization.capBound).toBe(true);
    const value = organization.valueOf(organization.current());
    expect(JSON.stringify(value.rationale)).toContain('organizationGoalCap');
  });
});
