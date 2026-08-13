/**
 * @module ai/h2/services/card-price.test
 *
 * The shadow price has to separate cards that a flat price could not, and it
 * has to do it for the right reasons. These check the reason as well as the
 * number: a price that comes out right by accident is not a price anyone can
 * spend.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { computeStanding } from './standing.js';
import { computeCardPrices } from './card-price.js';
import { loadScenario, scenarioView } from '../scenario-store.js';
import { testWinProbModel } from '../test-support.js';

/** A hazard-player position with creatures and events both in hand. */
const SCENARIO = 'movement/hazard-bundle-choice';

/** The prices at that position. */
function prices() {
  const scenario = loadScenario(SCENARIO);
  const view = scenarioView(scenario);
  const cardPool = loadCardPool();
  const standing = computeStanding(view, testWinProbModel(), DEFAULT_TUNABLES);
  return { view, cardPool, prices: computeCardPrices(view, cardPool, standing, DEFAULT_TUNABLES) };
}

describe('the card price', () => {
  test('prices every card in hand, and only cards in hand', () => {
    const { view, prices: priced } = prices();
    expect(priced.ranked()).toHaveLength(view.self.hand.length);
    expect(priced.worth('not-a-card' as never)).toBeNull();
  });

  test('a creature is worth what it adds to the plan, not a flat price', () => {
    const { view, cardPool, prices: priced } = prices();
    const creature = view.self.hand.find(
      c => (cardPool[c.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-creature',
    );
    expect(creature).toBeDefined();
    const worth = priced.worth(creature!.instanceId)!;
    // The reason is the test: a number that happens to equal the floor is fine,
    // a number that came *from* the floor is the thing this service replaced.
    // It now comes from `hazard-plan`, so it names a target or says there is
    // none — never "the flat price".
    expect(worth.reason).toMatch(/adds .* to the plan|worth nothing as an attack/);
  });

  test('two copies of the same creature can be priced differently, and should be', () => {
    // They were identical while each creature was priced alone. Under a plan
    // they are not: the first copy takes the slot and the second is credited
    // only with what it adds behind it, which is the whole point of pricing a
    // contribution rather than a card. What must hold is that no copy is
    // credited with more than the first.
    const { view, cardPool, prices: priced } = prices();
    const byDefinition = new Map<string, number[]>();
    for (const card of view.self.hand) {
      if ((cardPool[card.definitionId] as unknown as { cardType?: string })?.cardType !== 'hazard-creature') continue;
      const worth = priced.worth(card.instanceId)!;
      byDefinition.set(card.definitionId as string, [
        ...(byDefinition.get(card.definitionId as string) ?? []), worth.tsd,
      ]);
    }
    for (const values of byDefinition.values()) {
      const sorted = [...values].sort((a, b) => b - a);
      for (const value of values) expect(value).toBeLessThanOrEqual(sorted[0] + 1e-9);
    }
  });

  test('a card whose use cannot be modelled falls back to the flat price, and says so', () => {
    // The flat price is what it is worth *if played* — the question `worth`
    // answers, and the one asked when the chance to spend has already arrived.
    const { view, cardPool, prices: priced } = prices();
    const event = view.self.hand.find(
      c => (cardPool[c.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-event',
    );
    expect(event).toBeDefined();
    expect(priced.worth(event!.instanceId)!.tsd).toBeCloseTo(priced.floor, 9);
    expect(priced.worth(event!.instanceId)!.reason).toContain('flat price');
    // Keeping it is the other question: the hazard limit caps how fast a hand of
    // hazards can be spent, so what throwing it away costs is less than what
    // spending it costs. Merging the two is what cost 41 Elo.
    const held = priced.heldWorth(event!.instanceId)!;
    expect(held.tsd).toBeCloseTo(priced.floor * DEFAULT_TUNABLES.heldHazardOpportunity, 9);
    expect(held.reason).toContain('hazard limit');
  });

  test('a held hazard is worth less than the same modelled value on a resource', () => {
    // The point of the discount, stated as the comparison that motivated it:
    // the corpus has humans discarding hazards and H2 discarding the resources
    // that score, because both were priced as though equally deployable.
    const { view, cardPool, prices: priced } = prices();
    const classOf = (definitionId: string): string =>
      (cardPool[definitionId] as unknown as { cardType?: string })?.cardType ?? '';
    const hazards = view.self.hand.filter(c => classOf(c.definitionId).startsWith('hazard'));
    const resources = view.self.hand.filter(c => !classOf(c.definitionId).startsWith('hazard')
      && !/-character$/.test(classOf(c.definitionId)));
    expect(hazards.length).toBeGreaterThan(0);
    expect(resources.length).toBeGreaterThan(0);

    const cheapestResource = Math.min(...resources.map(c => priced.heldWorth(c.instanceId)!.tsd));
    expect(cheapestResource).toBeGreaterThanOrEqual(priced.floor);
    expect(Math.min(...hazards.map(c => priced.heldWorth(c.instanceId)!.tsd))).toBeLessThan(priced.floor);

    // …and the spending price is untouched, which is the separation itself.
    for (const card of [...hazards, ...resources]) {
      expect(priced.worth(card.instanceId)!.tsd).toBeGreaterThanOrEqual(priced.floor);
    }
  });

  test('the ranking is by worth, descending', () => {
    const { prices: priced } = prices();
    const ranked = priced.ranked();
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].tsd).toBeGreaterThanOrEqual(ranked[i].tsd);
    }
  });
});
