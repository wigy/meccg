/**
 * @module ai/h2/core/tsd.test
 *
 * The common currency is only worth having if it reproduces the tournament
 * rules' non-linearities, so these tests pin the three answers a marginal
 * marshalling point can have — 2 (doubled), 1 (plain), 0 (capped) — plus the
 * cross-player coupling that H1 has no way to represent at all.
 */

import { describe, test, expect } from 'vitest';
import type { MarshallingPointTotals } from '@meccg/shared';
import { applyMpDelta, assertValidDistribution, distributionStats, marginalMpValue, netTsdDelta, tsd, tsdAfter } from './tsd.js';
import { DEFAULT_TUNABLES } from './tunables.js';

/** Build MP totals, defaulting every unnamed source to zero. */
function mp(values: Partial<MarshallingPointTotals>): MarshallingPointTotals {
  return { character: 0, item: 0, faction: 0, ally: 0, kill: 0, misc: 0, ...values };
}

describe('marginal value of one marshalling point', () => {
  test('is 1 in an ordinary source', () => {
    const self = mp({ character: 3, item: 3, faction: 3, ally: 3 });
    const opponent = mp({ character: 3, item: 3, faction: 3, ally: 3 });
    expect(tsd(self, opponent)).toBe(0);
    expect(marginalMpValue(self, opponent, 'character')).toBe(1);
  });

  test('is 2 when the opponent has none in that source (CoE 10.3 doubling)', () => {
    const self = mp({ character: 4, item: 4, faction: 4, ally: 4 });
    const opponent = mp({ character: 0, item: 4, faction: 4, ally: 4 });
    expect(marginalMpValue(self, opponent, 'character')).toBe(2);
  });

  test('is 0 when the source already sits at the half-total cap', () => {
    // Half of a 12-point total is 6, and character is already there: a
    // seventh character point is capped straight back off. H1 would still
    // spend a turn chasing it.
    const self = mp({ character: 6, item: 2, faction: 2, ally: 2 });
    const opponent = mp({ character: 3, item: 3, faction: 3, ally: 3 });
    expect(marginalMpValue(self, opponent, 'character')).toBe(0);
  });

  test('includes the doubling the opponent loses — a point can be worth far more than itself', () => {
    // The opponent's five faction points double while we have none. Scoring a
    // single faction point takes that doubling away: +1 for us, −5 for them.
    const self = mp({ character: 5, item: 5, faction: 0, ally: 5 });
    const opponent = mp({ character: 5, item: 5, faction: 5, ally: 5 });
    expect(tsd(self, opponent)).toBe(-10);
    expect(tsdAfter(self, opponent, { faction: 1 })).toBe(-4);
    expect(marginalMpValue(self, opponent, 'faction')).toBe(6);
  });
});

describe('hypothetical totals', () => {
  test('applying a delta leaves the input untouched', () => {
    const base = mp({ character: 2 });
    const changed = applyMpDelta(base, { character: 3, kill: 1 });
    expect(base.character).toBe(2);
    expect(changed).toEqual(mp({ character: 5, kill: 1 }));
  });

  test('both sides move before either score is computed', () => {
    const self = mp({ character: 4, item: 4 });
    const opponent = mp({ character: 4, item: 4 });
    // Trading a kill point each way is a wash, which is only true if the two
    // scores are computed from the same hypothetical position.
    expect(tsdAfter(self, opponent, { kill: 1 }, { kill: 1 })).toBe(tsd(self, opponent));
  });
});

describe('anti-greed decomposition', () => {
  test('discounts potential and subtracts tempo', () => {
    const delta = netTsdDelta({ realized: 2, potential: 4, tempo: 1 }, DEFAULT_TUNABLES);
    expect(delta).toBe(2 + DEFAULT_TUNABLES.potentialDiscount * 4 - 1);
  });

  test('a pure-potential play is worth less than the same points banked', () => {
    const banked = netTsdDelta({ realized: 4 }, DEFAULT_TUNABLES);
    const unlocked = netTsdDelta({ realized: 0, potential: 4 }, DEFAULT_TUNABLES);
    expect(unlocked).toBeLessThan(banked);
  });
});

describe('outcome distributions', () => {
  test('mean and sigma describe the spread', () => {
    const stats = distributionStats([
      { p: 0.5, label: 'good', dtsd: 2 },
      { p: 0.5, label: 'bad', dtsd: -2 },
    ]);
    expect(stats.mean).toBe(0);
    expect(stats.sigma).toBe(2);
  });

  test('a distribution that does not sum to 1 is rejected', () => {
    expect(() => assertValidDistribution([{ p: 0.6, label: 'a', dtsd: 0 }], 'test'))
      .toThrow('sum to 0.6');
  });

  test('an unreachable outcome is rejected', () => {
    expect(() => assertValidDistribution(
      [{ p: 1, label: 'a', dtsd: 0 }, { p: 0, label: 'never', dtsd: 5 }],
      'test',
    )).toThrow('unreachable');
  });
});
