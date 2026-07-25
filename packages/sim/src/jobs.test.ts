/**
 * @module jobs.test
 *
 * Unit tests for the CLI fan-out slicing: contiguity, coverage, and
 * degenerate cases. (The end-to-end bit-identity of parallel vs serial
 * export/gate runs is verified manually — spawning tsx child processes is
 * too heavy for the routine suite.)
 */

import { describe, test, expect } from 'vitest';
import { sliceGames } from './cli/jobs.js';

describe('sliceGames', () => {
  test('splits games into contiguous slices covering the batch exactly', () => {
    const slices = sliceGames(10, 3);
    expect(slices.map(s => s.games)).toEqual([4, 3, 3]);
    expect(slices.map(s => s.firstGame)).toEqual([0, 4, 7]);
    expect(slices.reduce((sum, s) => sum + s.games, 0)).toBe(10);
  });

  test('never creates more slices than games', () => {
    const slices = sliceGames(2, 8);
    expect(slices.length).toBe(2);
    expect(slices.map(s => s.games)).toEqual([1, 1]);
  });

  test('single job is the identity slicing', () => {
    expect(sliceGames(7, 1)).toEqual([{ index: 0, firstGame: 0, games: 7 }]);
  });

  test('even splits have equal slice sizes', () => {
    expect(sliceGames(12, 4).map(s => s.games)).toEqual([3, 3, 3, 3]);
  });
});
