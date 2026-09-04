/**
 * @module ai/h2/services/hazard-plan.test
 *
 * The plan answers two questions at once — what a hazard in hand is *for*, and
 * what it is worth keeping — so the tests are about the relationship between
 * them: a card the plan uses is worth what it adds, a card it cannot use is
 * worth nothing, and the credit for a pair is not paid twice.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { computeStanding } from './standing.js';
import { computeHazardPlan } from './hazard-plan.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import { testWinProbModel } from '../test-support.js';

/** A hazard-player position with creatures in hand and a company to aim at. */
const SCENARIO = 'movement/hazard-bundle-choice';

/** The plan at that position. */
function position(id: string = SCENARIO) {
  const scenario = loadScenario(id);
  const view = scenarioView(scenario);
  const cardPool = loadCardPool();
  const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
  return {
    view,
    cardPool,
    standing,
    plan: computeHazardPlan(view, cardPool, standing, DEFAULT_TUNABLES),
  };
}

describe('what each hazard is for', () => {
  test('every creature in hand gets an answer, and an unreadable event does not', () => {
    const { view, cardPool, plan } = position();
    const creatures = view.self.hand.filter(card =>
      (cardPool[card.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-creature');
    expect(creatures.length).toBeGreaterThan(0);
    for (const card of creatures) expect(plan.worth(card.instanceId)).not.toBeNull();

    // An event whose value is not a declared attack modifier — Doors of Night is
    // worth what *other* cards make of it — has no place in an attack plan.
    const event = view.self.hand.find(card =>
      (cardPool[card.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-event');
    if (event) expect(plan.worth(event.instanceId)).toBeNull();
  });

  test('an assigned card names the company it is for', () => {
    // At the default position every creature is a gift — five untapped
    // characters parry the orcs without tapping and bank the kill MP — so the
    // plan aims nothing; two defenders against Wargs and Spiders is where
    // cards get assigned.
    const { plan } = position('hazards/order-two-defenders');
    const used = plan.assignments.filter(a => a.targetCompanyId !== null);
    expect(used.length).toBeGreaterThan(0);
    for (const assignment of used) {
      expect(assignment.marginal).toBeGreaterThan(0);
      expect(assignment.order).toBeGreaterThanOrEqual(1);
    }
  });

  test('a card the plan cannot use is worth nothing, and says which it is', () => {
    // Not a failure to price it: a creature that adds nothing behind the ones
    // already aimed at a company — because it hands over more kill MP than it
    // denies — really is worth nothing to hold *as an attack*.
    const { plan } = position();
    for (const assignment of plan.assignments) {
      if (assignment.targetCompanyId !== null) continue;
      expect(assignment.marginal).toBe(0);
      expect(assignment.targetLabel.length).toBeGreaterThan(0);
    }
  });

  test('the marginals sum to the total, so no pair is credited twice', () => {
    // The property that makes these usable as prices. Value is supermodular, so
    // the obvious mistake is to credit each card of a pair with what the pair
    // achieves together; assigning greedily and taking each card's *marginal*
    // contribution is what avoids it.
    const { plan } = position();
    const summed = plan.assignments.reduce((sum, a) => sum + a.marginal, 0);
    expect(summed).toBeCloseTo(plan.totalHarm, 6);
  });
});

describe('the order the attacks are played in', () => {
  /** The plan for the hazard player at a captured position. */
  function planAt(id: string) {
    const scenario = loadScenario(id);
    const view = scenarioView(scenario, 'p1' as never);
    const cardPool = loadCardPool();
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    const plan = computeHazardPlan(view, cardPool, standing, DEFAULT_TUNABLES);
    const orderOf = (name: string) => plan.assignments.find(a => a.name === name);
    return { plan, orderOf };
  }

  test('leads with the attack that softens the company for the one behind it', () => {
    // Two defenders. Wargs is worth less alone than the four-strike Lesser
    // Spiders, so a greedy plan led with the Spiders — but taking a defender out
    // first and following with the Spiders into the gap is worth more than the
    // reverse, and the `hazards` module's own bundle search says so too. The
    // plan used to inherit the order it happened to pick cards in. (Against
    // two characters the Spiders are assigned two strikes and carry the other
    // two as −2 on the second, CoE 3.iii; the order still holds.)
    const { orderOf } = planAt('hazards/order-two-defenders');
    const wargs = orderOf('Wargs');
    const spiders = orderOf('Lesser Spiders');
    expect(wargs?.targetCompanyId).not.toBeNull();
    expect(spiders?.targetCompanyId).toBe(wargs?.targetCompanyId);
    expect(wargs!.order).toBeLessThan(spiders!.order);
  });

  test('does not waste a many-strike attack on a lone wounded defender', () => {
    // One already-wounded character. He is assigned a single strike of the
    // four-strike Lesser Spiders, at −3 for the excess, and beating that one
    // strike banks the Spiders' kill MP — so the attack hands over more than
    // it threatens once the Cave Worm's near-certain wound has done its work.
    // The plan leads with the Worm and leaves the Spiders unplayed.
    const { orderOf } = planAt('hazards/order-lone-wounded-defender');
    const spiders = orderOf('Lesser Spiders');
    const worm = orderOf('Cave Worm');
    expect(worm?.targetCompanyId).not.toBeNull();
    expect(worm!.order).toBe(1);
    expect(spiders?.targetCompanyId).toBeNull();
    expect(spiders?.marginal).toBe(0);
  });

  test('credits each attack for what it adds in the order it will be played', () => {
    // The lead attack is credited what it denies on its own and the follower
    // what it adds behind it, so the two still sum to the plan's total — the
    // property that makes these numbers usable as prices.
    const { plan } = planAt('hazards/order-two-defenders');
    const summed = plan.assignments.reduce((sum, a) => sum + a.marginal, 0);
    expect(summed).toBeCloseTo(plan.totalHarm, 6);
    const [lead, follower] = plan.assignments
      .filter(a => a.targetCompanyId !== null)
      .sort((a, b) => a.order - b.order);
    expect(lead.order).toBe(1);
    expect(follower.order).toBe(2);
  });
});

describe('a support event in hand', () => {
  /**
   * The plan with a readable boost in hand: "all Spider and Animal attacks
   * receive +2 prowess", beside creatures it reaches.
   *
   * Swapping definitions under the hand's own instances is the trick the module
   * tests use — the position keeps its shape and only the cards change.
   */
  function withSupport(supportName = 'Full of Froth and Rage') {
    const scenario = loadScenario(SCENARIO);
    const view = scenarioView(scenario);
    const cardPool = loadCardPool();
    const definitionOf = (name: string) => Object.keys(cardPool).find(id =>
      (cardPool[id] as unknown as { name?: string }).name === name)!;
    const hand = view.self.hand as unknown as { definitionId: string }[];
    const creatures = hand.filter(card =>
      (cardPool[card.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-creature');
    expect(creatures.length).toBeGreaterThan(0);
    // Make the creatures Spiders, so the boost reaches them, and put the boost
    // where a non-creature card was.
    for (const creature of creatures) creature.definitionId = definitionOf('Lesser Spiders');
    const slot = hand.find(card =>
      (cardPool[card.definitionId] as unknown as { cardType?: string })?.cardType !== 'hazard-creature')!;
    slot.definitionId = definitionOf(supportName);
    const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
    return {
      support: slot as unknown as { instanceId: string },
      definitionOf,
      plan: computeHazardPlan(view, cardPool, standing, DEFAULT_TUNABLES),
    };
  }

  test('is priced, so nothing discards the card the module would play first', () => {
    const { support, plan } = withSupport();
    // Before the plan could read a race list, this card was not in the plan at
    // all — and `card-price`, which asks the plan what a card is worth to keep,
    // was free to throw away the boost the `hazards` module plays first.
    expect(plan.worth(support.instanceId as never)).not.toBeNull();
    expect(plan.worth(support.instanceId as never)!.support).toBe(true);
  });

  test('is never planned behind an attack it would boost', () => {
    const { plan } = withSupport();
    for (const assignment of plan.assignments) {
      if (!assignment.support || assignment.targetCompanyId === null) continue;
      // A modifier reaches the table before the attacks it improves, or it
      // improves nothing. This is the whole of the reported bug.
      expect(assignment.order).toBe(1);
      const behind = plan.assignments.filter(other =>
        !other.support && other.targetCompanyId === assignment.targetCompanyId);
      for (const attack of behind) expect(attack.order).toBeGreaterThan(1);
    }
  });

  test('the marginals still sum to the total with a support in the plan', () => {
    const { plan } = withSupport();
    const summed = plan.assignments.reduce((sum, a) => sum + a.marginal, 0);
    expect(summed).toBeCloseTo(plan.totalHarm, 6);
  });

  test('does not inflate the quote of a creature the support never reaches', () => {
    // `marginalFor` subtracts the company's *contribution* — attacks less a
    // card per support played there — from an attacks-only candidate arm.
    // Mixed like that, the difference credited every candidate with the
    // supports' card prices: with one support adopted, each quote from that
    // company came out a full provisionalCardPrice too high, skewing the
    // exchange/fetch/draft comparisons `card-price` feeds (routinely decided
    // by sub-price differences). An Orc pins it cleanly: the Spider/Animal
    // boost never touches an Orc attack, and appending it behind *boosted*
    // spiders can only find a softer roster — so its quote with the support
    // adopted must not exceed its quote from the boost-free twin by the
    // price the old subtraction leaked.
    const boosted = withSupport();
    // Doors of Night alone declares no attack modifier the plan can read
    // (see "an unreadable event does not [get an answer]" above), so this
    // twin position adopts no support.
    const bare = withSupport('Doors of Night');
    const orc = boosted.definitionOf('Hobgoblins');

    const inflated = boosted.plan.marginalFor(orc);
    const honest = bare.plan.marginalFor(orc);
    expect(honest).toBeGreaterThan(0);
    expect(inflated).toBeLessThanOrEqual(honest + DEFAULT_TUNABLES.provisionalCardPrice / 2);
  });
});

describe('what the hazard limit itself is worth', () => {
  test('halving every limit cannot make the plan do more', () => {
    // The hazard player who touches their sideboard during untap pays for it
    // with exactly this: `snapshotHazardLimit` halves the limit, rounding up,
    // for every company in the coming movement/hazard phase. Fewer slots is a
    // strictly smaller feasible set, so the plan can only lose.
    const { plan } = position();
    expect(plan.harmIfLimitsHalved()).toBeLessThanOrEqual(plan.totalHarm);
  });

  test('and it costs something whenever the limit was the binding constraint', () => {
    // If the plan filled every slot it had, taking half of them away has to
    // drop a card it wanted to play. A hand with fewer creatures than slots
    // correctly pays nothing, which is why the assertion is conditional on the
    // plan being slot-bound rather than unconditional.
    const { plan } = position();
    const assigned = plan.assignments.filter(a => a.targetCompanyId !== null);
    if (assigned.length < 2) return;
    expect(plan.harmIfLimitsHalved()).toBeLessThan(plan.totalHarm);
  });

  test('the answer is stable, because it is computed once and kept', () => {
    const { plan } = position();
    expect(plan.harmIfLimitsHalved()).toBe(plan.harmIfLimitsHalved());
  });
});
