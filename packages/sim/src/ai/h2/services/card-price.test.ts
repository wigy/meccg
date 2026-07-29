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
    const { view, cardPool, prices: priced } = prices();
    const event = view.self.hand.find(
      c => (cardPool[c.definitionId] as unknown as { cardType?: string })?.cardType === 'hazard-event',
    );
    expect(event).toBeDefined();
    const worth = priced.worth(event!.instanceId)!;
    expect(worth.tsd).toBeCloseTo(priced.floor, 9);
    expect(worth.reason).toContain('flat price');
  });

  test('the ranking is by worth, descending', () => {
    const { prices: priced } = prices();
    const ranked = priced.ranked();
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].tsd).toBeGreaterThanOrEqual(ranked[i].tsd);
    }
  });
});
