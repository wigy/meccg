/**
 * @module ai/h2/services/stored-value.test
 *
 * The extra a card is worth stored, read off the real card pool.
 */

import { describe, expect, test } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { testStandingView, testWinProbModel } from '../test-support.js';
import { computeStanding } from './standing.js';
import { storedValue } from './stored-value.js';

const pool = loadCardPool();
const standing = computeStanding(
  testStandingView({ character: 3, item: 3, misc: 1 }, { character: 3, item: 3, misc: 1 }, 10),
  testWinProbModel(),
  DEFAULT_TUNABLES,
);

describe('what storing adds', () => {
  test('is the stored points over the printed ones', () => {
    // Earth of Galadriel's Orchard: 0 printed, 2 stored at Bag End.
    const orchard = storedValue(pool['tw-221'], standing);
    expect(orchard.storedMp).toBe(2);
    expect(orchard.potentialTsd).toBeGreaterThan(0);
    // Palantír of Amon Sûl: 3 printed, 5 stored — only the 2 extra count.
    const palantir = storedValue(pool['tw-296'], standing);
    expect(palantir.storedMp).toBe(5);
    const source = (pool['tw-296'] as unknown as { marshallingCategory: 'item' }).marshallingCategory;
    expect(palantir.potentialTsd).toBeCloseTo(
      standing.tsdAfter({ [source]: 5 }) - standing.tsdAfter({ [source]: 3 }), 9,
    );
  });

  test('is nothing for a card that stores at its printed value, or cannot be stored', () => {
    // The Least of Gold Rings stores with no override; Orcrist has no storage.
    expect(storedValue(pool['le-315'], standing).potentialTsd).toBe(0);
    expect(storedValue(pool['tw-295'], standing).potentialTsd).toBe(0);
  });
});
