/**
 * @module rule-1.27-minion-location-deck
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.27: Minion Location Deck
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player's location deck can only include minion site cards (and the designated Balrog site cards).
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isSiteCard } from '../../../index.js';

describe('Rule 1.27 — Minion Location Deck', () => {
  test('[MINION] Location deck can only include minion site cards (and designated Balrog sites)', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'minion');
    expect(decks.length).toBeGreaterThan(0);

    for (const deck of decks) {
      for (const entry of deck.sites) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!isSiteCard(def)) continue;
        expect(
          def.cardType,
          `deck ${deck.id}: site "${entry.card}" (${def.name}) has cardType "${def.cardType}", expected minion-site or balrog-site`,
        ).toMatch(/^(minion-site|balrog-site)$/);
      }
    }
  });
});
