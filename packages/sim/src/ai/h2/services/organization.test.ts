/**
 * @module ai/h2/services/organization.test
 *
 * The conditions that make the organization potential a potential, per spec
 * §5: one `Organization` per position, `valueOf` a function of the
 * arrangement as a *set*, and the "resources to play for all" gate falling
 * out of the matching's injectivity rather than out of a counting rule.
 */

import { describe, test, expect } from 'vitest';
import { CardStatus, loadCardPool } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, PlayerView } from '@meccg/shared';
import { DEFAULT_TUNABLES, withTunable } from '../core/tunables.js';
import type { Commitment } from '../core/plan.js';
import { computeStanding } from './standing.js';
import { loadWinProbModel } from '../core/winprob.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import { testMarshallingPoints } from '../test-support.js';
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

// Bug report (game mtliimtw-yp56n5, turn 1, site phase): the AI sent Beorn to
// Thranduil's Halls to influence the Wood-elves and Legolas to Beorn's House
// to influence the Beornings — each losing the +2 direct-influence bonus his
// own card grants against the *other* faction. `bestFreeDi` was computed once
// per company from `effectiveStats.directInfluence` alone, which is identical
// for both DI-2 characters — the matching that decides `split-company` /
// `move-to-company` therefore could not tell the correctly-matched pairing
// from the swapped one and had no reason to prefer it.
describe('a company\'s free direct influence against a specific faction', () => {
  // Both sides already have a few points in every source, so a further
  // faction point still prices positive (at 0-0 the win-prob model reads flat
  // and every marginal is zero) without either faction being anywhere near
  // the CoE 10.3 diversity cap.
  const BALANCED = { character: 3, item: 3, faction: 3, ally: 3 };

  const BEORNINGS = 'test-beornings';
  const WOOD_ELVES = 'test-wood-elves';
  const BEORN = 'test-beorn';
  const LEGOLAS = 'test-legolas';
  const BEORNS_HOUSE = 'test-beorns-house';
  const THRANDUILS_HALLS = 'test-thranduils-halls';

  const POOL = {
    [BEORNINGS]: {
      name: 'Beornings', cardType: 'hero-resource-faction', marshallingPoints: 2,
      marshallingCategory: 'faction', influenceTarget: 9, playableAt: [{ site: 'Beorn’s House' }],
    },
    [WOOD_ELVES]: {
      name: 'Wood-elves', cardType: 'hero-resource-faction', marshallingPoints: 2,
      marshallingCategory: 'faction', influenceTarget: 9, playableAt: [{ site: 'Thranduil’s Halls' }],
    },
    [BEORN]: {
      name: 'Beorn', cardType: 'hero-character', marshallingPoints: 2, marshallingCategory: 'character',
      mind: 7, directInfluence: 2,
      effects: [{
        type: 'stat-modifier', stat: 'direct-influence', value: 2,
        when: { reason: 'faction-influence-check', 'faction.name': 'Beornings' },
      }],
    },
    [LEGOLAS]: {
      name: 'Legolas', cardType: 'hero-character', marshallingPoints: 2, marshallingCategory: 'character',
      mind: 6, directInfluence: 2,
      effects: [{
        type: 'stat-modifier', stat: 'direct-influence', value: 2,
        when: { reason: 'faction-influence-check', 'faction.name': 'Wood-elves' },
      }],
    },
    [BEORNS_HOUSE]: { name: 'Beorn’s House', cardType: 'hero-site', siteType: 'border-hold', playableResources: [] },
    [THRANDUILS_HALLS]: {
      name: 'Thranduil’s Halls', cardType: 'hero-site', siteType: 'border-hold', playableResources: [],
    },
  } as unknown as Readonly<Record<string, CardDefinition>>;

  /** A minimal untapped character in play, DI-2 either way — only the
   * bearer's own conditional effect (above) tells them apart. */
  function characterOf(instanceId: string, definitionId: string) {
    return {
      instanceId, definitionId, status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      effectiveStats: { prowess: 5, body: 8, directInfluence: 2, corruptionPoints: 0 },
    };
  }

  /** One character standing at Beorn's House, the other at Thranduil's Halls. */
  function viewWith(atBeornsHouse: 'beorn' | 'legolas'): PlayerView {
    const [houseCharacter, hallsCharacter] = atBeornsHouse === 'beorn'
      ? [{ id: 'beorn', def: BEORN }, { id: 'legolas', def: LEGOLAS }]
      : [{ id: 'legolas', def: LEGOLAS }, { id: 'beorn', def: BEORN }];
    return {
      self: {
        id: 'p1',
        alignment: 'wizard',
        marshallingPoints: testMarshallingPoints(BALANCED),
        hand: [
          { instanceId: 'card-beornings', definitionId: BEORNINGS },
          { instanceId: 'card-wood-elves', definitionId: WOOD_ELVES },
        ],
        characters: {
          [houseCharacter.id]: characterOf(houseCharacter.id, houseCharacter.def),
          [hallsCharacter.id]: characterOf(hallsCharacter.id, hallsCharacter.def),
        },
        companies: [
          {
            id: 'company-house', characters: [houseCharacter.id],
            currentSite: { instanceId: 'site-house', definitionId: BEORNS_HOUSE },
          },
          {
            id: 'company-halls', characters: [hallsCharacter.id],
            currentSite: { instanceId: 'site-halls', definitionId: THRANDUILS_HALLS },
          },
        ],
        cardsInPlay: [],
        siteDeck: [],
        generalInfluence: 20,
        generalInfluenceUsed: 0,
      },
      opponent: {
        marshallingPoints: testMarshallingPoints(BALANCED),
        characters: {}, cardsInPlay: [], discardPile: [], killPile: [], outOfPlayPile: [],
      },
      turnNumber: 1,
    } as unknown as PlayerView;
  }

  test('the matched pairing (each bearer at the faction he boosts) outscores the swapped one', () => {
    const model = loadWinProbModel();
    const matched = viewWith('beorn'); // Beorn at Beorn's House, Legolas at Thranduil's Halls
    const swapped = viewWith('legolas'); // Legolas at Beorn's House, Beorn at Thranduil's Halls

    const matchedOrg = computeOrganization(
      matched, POOL, computeStanding(matched, model, DEFAULT_TUNABLES), DEFAULT_TUNABLES, undefined);
    const swappedOrg = computeOrganization(
      swapped, POOL, computeStanding(swapped, model, DEFAULT_TUNABLES), DEFAULT_TUNABLES, undefined);

    const matchedValue = matchedOrg.valueOf(matchedOrg.current());
    const swappedValue = swappedOrg.valueOf(swappedOrg.current());

    // Pre-fix, `bestFreeDi` read only `effectiveStats.directInfluence` — 2 for
    // either character — so the two arrangements priced identically and the
    // matching had no way to prefer the one that actually lands the bonus.
    expect(matchedValue.opportunityTsd).toBeGreaterThan(swappedValue.opportunityTsd);

    const checkPOf = (value: typeof matchedValue, label: string): number =>
      value.assignments.find(a => a.goal.label.includes(label))!.p;
    expect(checkPOf(matchedValue, 'Beornings')).toBeGreaterThan(checkPOf(swappedValue, 'Beornings'));
    expect(checkPOf(matchedValue, 'Wood-elves')).toBeGreaterThan(checkPOf(swappedValue, 'Wood-elves'));
  });
});
