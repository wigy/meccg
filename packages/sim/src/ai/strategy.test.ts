/**
 * Tests for the two ways a weight table can be turned into a move.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction } from '@meccg/shared';
import { pickBest, sampleWeighted } from './strategy.js';
import { pickBest as pickBestFromPackage } from '../index.js';
import type { WeightedAction } from './strategy.js';

/** A distinguishable stand-in action; the pickers never inspect the contents. */
const act = (type: string): GameAction => ({ type } as unknown as GameAction);

/** A random stream that hands out the given values in order, then repeats the last. */
function stream(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe('pickBest', () => {
  test('plays the highest weight regardless of the random stream', () => {
    const weighted: WeightedAction[] = [
      { action: act('a'), weight: 1 },
      { action: act('b'), weight: 9 },
      { action: act('c'), weight: 3 },
    ];
    for (const r of [0, 0.25, 0.5, 0.99]) {
      expect(pickBest(weighted, stream(r)).type).toBe('b');
    }
  });

  test('breaks ties across the top set, and only across it', () => {
    const weighted: WeightedAction[] = [
      { action: act('a'), weight: 5 },
      { action: act('b'), weight: 5 },
      { action: act('c'), weight: 1 },
    ];
    expect(pickBest(weighted, stream(0)).type).toBe('a');
    expect(pickBest(weighted, stream(0.99)).type).toBe('b');
  });

  test('treats a rounding-width difference as a tie', () => {
    // Two evaluators reaching 0.3 by different arithmetic must not have the
    // decision handed to whichever one the legal-action list happened to
    // mention first.
    const weighted: WeightedAction[] = [
      { action: act('a'), weight: 0.1 + 0.2 },
      { action: act('b'), weight: 0.3 },
    ];
    expect(pickBest(weighted, stream(0.99)).type).toBe('b');
  });

  test('still returns a move when every weight is zero', () => {
    const weighted: WeightedAction[] = [
      { action: act('a'), weight: 0 },
      { action: act('b'), weight: 0 },
    ];
    expect(pickBest(weighted, stream(0.99)).type).toBe('b');
  });

  test('disagrees with sampling exactly where the sample leaves the top set', () => {
    const weighted: WeightedAction[] = [
      { action: act('a'), weight: 1 },
      { action: act('b'), weight: 9 },
    ];
    // r = 0.05 lands in a's slice of the normalized interval; the argmax does not care.
    expect(sampleWeighted(weighted, stream(0.05)).type).toBe('a');
    expect(pickBest(weighted, stream(0.05)).type).toBe('b');
  });

  // The console-client (and any external consumer) imports pickBest from the
  // package barrel; guard that re-export so its argmax selection can't silently
  // regress to sampling by the export being dropped.
  test('pickBest is re-exported from the package index and is the same argmax', () => {
    const weighted: WeightedAction[] = [
      { action: act('a'), weight: 1 },
      { action: act('b'), weight: 9 },
    ];
    expect(typeof pickBestFromPackage).toBe('function');
    expect(pickBestFromPackage(weighted, stream(0.05)).type).toBe('b');
  });
});
