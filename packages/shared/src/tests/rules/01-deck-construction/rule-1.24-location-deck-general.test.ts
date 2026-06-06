/**
 * @module rule-1.24-location-deck-general
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.24: Location Deck - General
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A location deck may include any number of haven sites and one of each non-haven site (but no region cards, which are generally replaced with a map for tournament play).
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isSiteCard, SiteType } from '../../../index.js';

describe('Rule 1.24 — Location Deck - General', () => {
  test('Non-haven sites appear at most once; haven sites may appear any number of times', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      const nonHavenIds = new Set<string>();
      for (const entry of deck.sites) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!isSiteCard(def)) continue;
        if (def.siteType === SiteType.Haven) continue;
        expect(
          entry.qty,
          `deck ${deck.id}: non-haven site "${entry.card}" (${def.name}) has qty ${entry.qty}, max is 1`,
        ).toBeLessThanOrEqual(1);
        expect(
          nonHavenIds.has(entry.card as string),
          `deck ${deck.id}: non-haven site "${entry.card}" (${def.name}) appears more than once`,
        ).toBe(false);
        nonHavenIds.add(entry.card as string);
      }
    }
  });
});
