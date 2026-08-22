/**
 * @module stats.test
 *
 * Regression test for `summarizeDistribution`'s percentile computation. The
 * index used `floor(p/100 · n)`, which for p90 of a 10-element sample lands on
 * index 9 — the maximum — so the reported p90 (and the whole upper tail) was
 * whatever the single worst observation happened to be. Percentiles now use the
 * nearest-rank method: rank ceil(p/100 · n), 0-based index rank − 1.
 */

import { describe, test, expect } from 'vitest';
import { summarizeDistribution } from './stats.js';

describe('summarizeDistribution percentiles (nearest-rank)', () => {
  test('p90 of a 10-element sample is the 9th value, not the maximum', () => {
    const s = summarizeDistribution([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(s.count).toBe(10);
    expect(s.min).toBe(100);
    expect(s.max).toBe(1000);
    expect(s.p50).toBe(500); // rank ceil(5) = 5 → index 4
    expect(s.p90).toBe(900); // rank ceil(9) = 9 → index 8, NOT the max
    expect(s.p99).toBe(1000); // rank ceil(9.9) = 10 → index 9
  });

  test('sorts the sample before ranking', () => {
    const s = summarizeDistribution([1000, 100, 900, 200, 800, 300, 700, 400, 600, 500]);
    expect(s.p50).toBe(500);
    expect(s.p90).toBe(900);
  });

  test('a single-element sample reports that element for every percentile', () => {
    expect(summarizeDistribution([42])).toMatchObject({
      count: 1, min: 42, max: 42, mean: 42, p50: 42, p90: 42, p99: 42,
    });
  });

  test('an empty sample is all zeroes', () => {
    expect(summarizeDistribution([])).toEqual({
      count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p99: 0,
    });
  });
});
