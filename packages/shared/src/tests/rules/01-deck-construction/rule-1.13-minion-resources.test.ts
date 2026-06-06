/**
 * @module rule-1.13-minion-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.13: Minion Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player's resources can only be minion resources, except for hero items and/or hazards that may be played as resources.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';

describe('Rule 1.13 — Minion Resources', () => {
  test('[MINION] Resources can only be minion resources, except hero items and/or hazards playable as resources', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'minion');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const entry of deck.deck.resources) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        const allowed =
          ct.startsWith('minion-resource') ||
          ct === 'hero-resource-item' ||
          ct.startsWith('hazard-');
        expect(allowed, `deck ${deck.id}: resource "${entry.card}" has disallowed cardType "${ct}"`).toBe(true);
      }
    }
  });
});
