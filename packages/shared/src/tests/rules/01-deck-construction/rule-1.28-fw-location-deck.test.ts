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

describe('Rule 1.28 — Fallen-Wizard Location Deck', () => {
  test('[FALLEN-WIZARD] Location deck may include hero, minion, and multiple Fallen-wizard sites', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'fallen-wizard');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      const nonFwCounts = new Map<string, number>();
      for (const entry of deck.sites) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        expect(
          ct === 'hero-site' || ct === 'minion-site' || ct === 'fallen-wizard-site',
          `deck ${deck.id}: site "${entry.card}" (${def.name}) has disallowed cardType "${ct}"`,
        ).toBe(true);
        if (ct === 'hero-site' || ct === 'minion-site') {
          const prev = nonFwCounts.get(entry.card) ?? 0;
          nonFwCounts.set(entry.card, prev + (entry.qty ?? 1));
        }
      }
      for (const [cardId, count] of nonFwCounts) {
        const def = pool[cardId];
        expect(
          count,
          `deck ${deck.id}: ${def?.cardType} site "${cardId}" (${def?.name}) appears ${count} times (max 1)`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });
});
