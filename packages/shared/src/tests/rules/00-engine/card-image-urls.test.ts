/**
 * @module card-image-urls
 *
 * Engine data integrity — every card definition must point at an image
 * that actually exists in the Council of Rivendell remaster repository.
 *
 * Regression for bug c1b07bf26f492f45 (game ms1ut2yf-ndju07, seq 149):
 * a player planned movement to the minion site Woodmen-town (le-414) and
 * the site card rendered with no picture. The card data carried the URL
 * `.../en-remaster/le/Woodmen-town.jpg`, which serves a 404 — the remaster
 * filenames strip every non-alphanumeric character from the card name, so
 * the hyphen must not appear (`Woodmentown.jpg`). The hero-side printing
 * of the same site (tw-438) already used the stripped spelling, which is
 * why only the minion version was blank.
 *
 * These assertions pin the naming convention offline: no network access is
 * needed to catch a filename that could not possibly resolve. A few images
 * legitimately carry a trailing `2` (names reused across sets) or fix a
 * typo in our own `name` field, so the test checks the *shape* of the
 * filename rather than deriving it from the card name.
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../../test-helpers.js';

/** Base URL every card image is served from. */
const REMASTER_BASE =
  'https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/';

describe('card image URLs', () => {
  const cards = Object.values(pool);

  test('every card definition carries a non-empty image URL', () => {
    const missing = cards
      .filter((card) => card.image.length === 0)
      .map((card) => `${card.id} (${card.name})`);
    expect(missing).toEqual([]);
  });

  test('images are served from the remaster repository as .jpg', () => {
    const offenders = cards
      .filter((card) => !card.image.startsWith(REMASTER_BASE) || !card.image.endsWith('.jpg'))
      .map((card) => `${card.id} (${card.name}): ${card.image}`);
    expect(offenders).toEqual([]);
  });

  test('image lives in the directory matching the card set prefix', () => {
    const offenders = cards
      .filter((card) => {
        const [set] = card.id.split('-');
        return !card.image.startsWith(`${REMASTER_BASE}${set}/`);
      })
      .map((card) => `${card.id} (${card.name}): ${card.image}`);
    expect(offenders).toEqual([]);
  });

  test('image filenames are strictly alphanumeric — no hyphens, spaces or accents', () => {
    const offenders = cards
      .filter((card) => {
        const stem = card.image.slice(REMASTER_BASE.length).split('/')[1]?.replace(/\.jpg$/, '');
        return !/^[A-Za-z0-9]+$/.test(stem ?? '');
      })
      .map((card) => `${card.id} (${card.name}): ${card.image}`);
    expect(offenders).toEqual([]);
  });

  test('minion Woodmen-town (le-414) resolves to Woodmentown.jpg', () => {
    expect(pool['le-414']?.image).toBe(`${REMASTER_BASE}le/Woodmentown.jpg`);
  });
});
