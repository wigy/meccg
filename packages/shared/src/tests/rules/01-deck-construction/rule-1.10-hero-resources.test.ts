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

const HERO_RESOURCE_TYPES = new Set([
  'hero-resource-item',
  'hero-resource-faction',
  'hero-resource-ally',
  'hero-resource-event',
]);

describe('Rule 1.10 — Hero Resources', () => {
  test('[HERO] Resources can only be hero resources, except minion items and/or hazards playable as resources', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'hero') continue;
      for (const entry of deck.deck.resources) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        const allowed = HERO_RESOURCE_TYPES.has(ct) || ct === 'minion-resource-item';
        expect(
          allowed,
          `hero deck ${deck.id}: resource "${entry.card}" (${def.name}) has cardType "${ct}" — must be hero-resource-* or minion-resource-item`,
        ).toBe(true);
      }
    }
  });
});
