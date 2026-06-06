/**
 * @module rule-1.21-balrog-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.21: Balrog Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's resources can only be minion resources and/or hazards that may be played as resources.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';

describe('Rule 1.21 — Balrog Resources', () => {
  test('[BALROG] Resources can only be minion resources and/or hazards playable as resources', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'balrog');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const entry of deck.deck.resources) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        const allowed = ct.startsWith('minion-resource') || ct.startsWith('hazard-');
        expect(allowed, `deck ${deck.id}: resource "${entry.card}" has disallowed cardType "${ct}"`).toBe(true);
      }
    }
  });
});
