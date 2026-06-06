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

const MINION_RESOURCE_TYPES = new Set([
  'minion-resource-item',
  'minion-resource-faction',
  'minion-resource-ally',
  'minion-resource-event',
]);

describe('Rule 1.13 — Minion Resources', () => {
  test('[MINION] Resources can only be minion resources, except hero items and/or hazards playable as resources', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'minion') continue;
      for (const entry of deck.deck.resources) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        const allowed = MINION_RESOURCE_TYPES.has(ct) || ct === 'hero-resource-item';
        expect(
          allowed,
          `minion deck ${deck.id}: resource "${entry.card}" (${def.name}) has cardType "${ct}" — must be minion-resource-* or hero-resource-item`,
        ).toBe(true);
      }
    }
  });
});
