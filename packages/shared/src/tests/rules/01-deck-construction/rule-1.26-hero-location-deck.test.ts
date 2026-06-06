/**
 * @module rule-1.26-hero-location-deck
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.26: Hero Location Deck
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's location deck can only include hero site cards (and the designated Balrog site cards).
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';

describe('Rule 1.26 — Hero Location Deck', () => {
  test('[HERO] Location deck can only include hero site cards (and designated Balrog sites)', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'hero');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const entry of deck.sites) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        expect(
          ct === 'hero-site' || ct === 'balrog-site',
          `deck ${deck.id}: site "${entry.card}" (${def.name}) has disallowed cardType "${ct}"`,
        ).toBe(true);
      }
    }
  });
});
