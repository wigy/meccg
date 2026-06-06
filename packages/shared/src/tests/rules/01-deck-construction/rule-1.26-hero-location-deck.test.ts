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
import { isSiteCard } from '../../../index.js';

describe('Rule 1.26 — Hero Location Deck', () => {
  test('[HERO] Location deck only includes hero or Balrog site cards', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'hero') continue;
      for (const entry of deck.sites) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!isSiteCard(def)) continue;
        expect(
          ['hero-site', 'balrog-site'],
          `hero deck ${deck.id}: site "${entry.card}" (${def.name}) has type "${def.cardType}", expected hero-site or balrog-site`,
        ).toContain(def.cardType);
      }
    }
  });
});
