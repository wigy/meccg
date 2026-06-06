/**
 * @module rule-1.10-hero-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.10: Hero Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's resources can only be hero resources, except for minion items and/or hazards that may be played as resources.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';

describe('Rule 1.10 — Hero Resources', () => {
  test('[HERO] Resources can only be hero resources, except minion items and/or hazards playable as resources', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'hero');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const entry of deck.deck.resources) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        const allowed =
          ct.startsWith('hero-resource') ||
          ct === 'minion-resource-item' ||
          ct.startsWith('hazard-');
        expect(allowed, `deck ${deck.id}: resource "${entry.card}" has disallowed cardType "${ct}"`).toBe(true);
      }
    }
  });
});
