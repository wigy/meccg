/**
 * @module site-path-region-types
 *
 * Data-integrity guard for site paths. A site's path from its nearest haven
 * always ends in the region the site itself lies in, so the last region type
 * of `sitePath` must equal that region's `regionType`. Several minion sites
 * once encoded a final Border-land as a Shadow-land (e.g. Beorn's House from
 * Dol Guldur read `[dark, shadow]` instead of `[dark, border]`), which made
 * Anduin Vales count as a Shadow-land for hazard keying.
 */

import { describe, test, expect } from 'vitest';
import { loadCardPool } from '../index.js';

const pool = loadCardPool();
const defs = Object.values(pool) as unknown as Record<string, unknown>[];

const regionTypes = new Map<string, string>();
for (const d of defs) {
  if (d.cardType === 'region') regionTypes.set(d.name as string, d.regionType as string);
}

/** Sites with pre-existing, unrelated path data quirks (coastal naming, truncated path). */
const KNOWN_EXCEPTIONS = new Set(['as-140', 'tw-401', 'tw-405']);

describe('site path region types', () => {
  test('Beorn’s House (minion) path from Dol Guldur is dark, border', () => {
    expect((pool['le-354'] as unknown as { sitePath: string[] }).sitePath).toEqual(['dark', 'border']);
  });

  test('last site-path region type matches the site’s own region type', () => {
    const mismatches: string[] = [];
    for (const d of defs) {
      const sitePath = d.sitePath as string[] | undefined;
      if (!sitePath || sitePath.length === 0 || KNOWN_EXCEPTIONS.has(d.id as string)) continue;
      const regionType = regionTypes.get(d.region as string);
      if (regionType === undefined) continue;
      const last = sitePath[sitePath.length - 1];
      if (last !== regionType) {
        mismatches.push(`${d.id as string} ${d.name as string}: path ends ${last}, ${d.region as string} is ${regionType}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
