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
  test('Location deck contains at most one copy of each non-haven site', () => {
    const decks = loadAllDecks();
    expect(decks.length).toBeGreaterThan(0);

    for (const deck of decks) {
      const nonHavenCounts = new Map<string, number>();
      for (const entry of deck.sites) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!isSiteCard(def)) continue;
        if (def.siteType === SiteType.Haven) continue;
        nonHavenCounts.set(entry.card, (nonHavenCounts.get(entry.card) ?? 0) + (entry.qty ?? 1));
      }

      for (const [cardId, count] of nonHavenCounts) {
        expect(
          count,
          `deck ${deck.id}: non-haven site "${cardId}" appears ${count} times (max 1)`,
        ).toBe(1);
      }
    }
  });
});
