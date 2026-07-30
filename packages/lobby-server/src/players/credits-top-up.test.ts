/**
 * @module players/credits-top-up.test
 *
 * Tests for the admin screen's top-up calculation: consumption since the
 * last credit addition, rounded up to the nearest hundred, plus a
 * 200-credit bonus.
 */

import { describe, test, expect } from 'vitest';
import { consumptionSinceLastAddition, pendingTopUp } from './store.js';
import type { CreditHistoryEntry } from './store.js';

/** Build a history entry; balance is irrelevant to the calculation. */
function entry(amount: number, explanation = 'test'): CreditHistoryEntry {
  return { datetime: '2026-07-30T12:00:00.000Z', amount, balance: 0, explanation };
}

describe('consumptionSinceLastAddition', () => {
  test('is zero for an empty history', () => {
    expect(consumptionSinceLastAddition([])).toBe(0);
  });

  test('sums every deduction when nothing was ever added', () => {
    expect(consumptionSinceLastAddition([entry(-5), entry(-100), entry(-12)])).toBe(117);
  });

  test('ignores deductions made before the last addition', () => {
    const history = [entry(-40), entry(500, 'Top-up'), entry(-5), entry(-30)];
    expect(consumptionSinceLastAddition(history)).toBe(35);
  });

  test('is zero right after an addition', () => {
    expect(consumptionSinceLastAddition([entry(-40), entry(500, 'Top-up')])).toBe(0);
  });

  test('counts only after the most recent of several additions', () => {
    const history = [entry(100), entry(-70), entry(200), entry(-15)];
    expect(consumptionSinceLastAddition(history)).toBe(15);
  });

  test('ignores zero-amount entries', () => {
    expect(consumptionSinceLastAddition([entry(0), entry(-25), entry(0)])).toBe(25);
  });
});

describe('pendingTopUp', () => {
  test('is zero when nothing was consumed since the last addition', () => {
    expect(pendingTopUp([entry(-40), entry(500, 'Top-up')])).toBe(0);
  });

  test('rounds a partial hundred up and adds the 200 bonus', () => {
    expect(pendingTopUp([entry(-5)])).toBe(300);
    expect(pendingTopUp([entry(-117)])).toBe(400);
  });

  test('adds the 200 bonus to an exact hundred', () => {
    expect(pendingTopUp([entry(-100)])).toBe(300);
    expect(pendingTopUp([entry(-60), entry(-140)])).toBe(400);
  });
});
