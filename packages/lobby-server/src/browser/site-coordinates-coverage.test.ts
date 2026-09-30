/**
 * @module site-coordinates-coverage.test
 *
 * Data check for the map destination picker (map-site-picker.ts): every site
 * and region in the card pool must have a map position in
 * `public/data/site-coordinates.json`, so a new card set cannot silently
 * drop destinations from the map. Sites listed in {@link ALLOWED_MISSING}
 * have no printed map position; the picker places them at their region's
 * centroid instead, or — when they have no region either — lists them in its
 * "Other destinations" strip.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect } from 'vitest';
import { loadCardPool, isSiteCard } from '@meccg/shared';

const pool = loadCardPool();
const coords = JSON.parse(readFileSync(
  resolve(__dirname, '../../public/data/site-coordinates.json'), 'utf8',
)) as Record<string, [number, number]>;
const names = new Set(Object.keys(coords).map(n => n.toLowerCase()));

/** Dream-card sites without coordinates, and where the picker shows them instead. */
const ALLOWED_MISSING = new Map<string, 'region' | 'strip'>([
  ['Hermit’s Hill', 'region'],
  ['Wondrous Maps', 'strip'], // no region at all
]);

describe('site-coordinates.json coverage', () => {
  test('every site has coordinates or is explicitly allowed to fall back to its region', () => {
    const missing = new Set<string>();
    for (const def of Object.values(pool)) {
      if (!isSiteCard(def)) continue;
      if (names.has(def.name.toLowerCase()) || ALLOWED_MISSING.has(def.name)) continue;
      missing.add(def.name);
    }
    expect([...missing].sort()).toEqual([]);
  });

  test('every region has a centroid', () => {
    const missing = Object.values(pool)
      .filter(def => def.cardType === 'region' && !names.has(def.name.toLowerCase()))
      .map(def => def.name);
    expect(missing).toEqual([]);
  });

  test('allowed-missing sites meant for their region can be placed there', () => {
    for (const def of Object.values(pool)) {
      if (!isSiteCard(def) || ALLOWED_MISSING.get(def.name) !== 'region') continue;
      expect(names.has(def.region.toLowerCase()), `${def.name} region ${def.region}`).toBe(true);
    }
  });
});
