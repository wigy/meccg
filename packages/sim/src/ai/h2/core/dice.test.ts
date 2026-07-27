/**
 * @module ai/h2/core/dice.test
 *
 * Exact 2d6 values. These are checked against hand-counted fractions rather
 * than a rounded table because module outcome probabilities must sum to 1 and
 * are compared against the real reducer by the calibration harness, where a
 * rounding error reads as a systematic bias.
 */

import { describe, test, expect } from 'vitest';
import { pAtLeast, pAtMost, pBodyCheckFailed, pExactly, pGreaterThan, pStrikeDefeated } from './dice.js';

describe('2d6 distribution', () => {
  test('exact totals match the 36-outcome counts', () => {
    expect(pExactly(2)).toBeCloseTo(1 / 36, 12);
    expect(pExactly(7)).toBeCloseTo(6 / 36, 12);
    expect(pExactly(12)).toBeCloseTo(1 / 36, 12);
    expect(pExactly(1)).toBe(0);
    expect(pExactly(13)).toBe(0);
  });

  test('the whole distribution sums to 1', () => {
    let sum = 0;
    for (let total = 2; total <= 12; total++) sum += pExactly(total);
    expect(sum).toBeCloseTo(1, 12);
  });

  test('tail probabilities match the counted tails', () => {
    expect(pAtLeast(2)).toBe(1);
    expect(pAtLeast(7)).toBeCloseTo(21 / 36, 12);
    expect(pAtLeast(12)).toBeCloseTo(1 / 36, 12);
    expect(pAtLeast(13)).toBe(0);
  });

  test('at-least and at-most partition the space', () => {
    for (let need = 2; need <= 12; need++) {
      expect(pAtLeast(need) + pAtMost(need - 1)).toBeCloseTo(1, 12);
    }
  });

  test('H1 rounded 8 to 42%; the exact value is 41.67%', () => {
    // The improvement is small per roll and systematic across thousands of
    // them — which is precisely what a calibration test would flag.
    expect(pStrikeDefeated(8)).toBeCloseTo(15 / 36, 12);
  });
});

describe('body checks', () => {
  test('fail when the roll exceeds body (CoE 3.iv.7)', () => {
    // Body 4 dies on a 5 or better: 30 of 36 rolls.
    expect(pBodyCheckFailed(4)).toBeCloseTo(30 / 36, 12);
    expect(pBodyCheckFailed(4)).toBe(pGreaterThan(4));
  });

  test('an already-wounded +1 modifier makes death more likely', () => {
    expect(pBodyCheckFailed(8, 1)).toBeGreaterThan(pBodyCheckFailed(8, 0));
  });

  test('body 12 or more is safe on 2d6 alone', () => {
    expect(pBodyCheckFailed(12)).toBe(0);
  });
});
