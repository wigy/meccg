/**
 * @module rule-1.28-fw-location-deck
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.28: Fallen-Wizard Location Deck
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's location deck may include one copy of each hero site and one copy of each minion site (including havens), and may include multiple copies of each Fallen-wizard site.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isSiteCard } from '../../../index.js';

describe('Rule 1.28 — Fallen-Wizard Location Deck', () => {
  test('[FALLEN-WIZARD] Hero and minion sites appear at most once; fallen-wizard sites may appear multiple times', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'fallen-wizard');
    expect(decks.length).toBeGreaterThan(0);

    for (const deck of decks) {
      const nonFwCounts = new Map<string, number>();
      for (const entry of deck.sites) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!isSiteCard(def)) continue;
        if (def.cardType === 'fallen-wizard-site') continue;
        nonFwCounts.set(entry.card, (nonFwCounts.get(entry.card) ?? 0) + entry.qty);
      }

      for (const [cardId, count] of nonFwCounts) {
        const def = pool[cardId];
        expect(
          count,
          `deck ${deck.id}: non-FW site "${cardId}" (${def && 'name' in def ? def.name : '?'}) appears ${count} times (max 1)`,
        ).toBe(1);
      }
    }
  });
});
