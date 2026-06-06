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
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'minion') continue;
      for (const entry of deck.sites) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!isSiteCard(def)) continue;
        const ct = def.cardType;
        expect(
          ct === 'minion-site' || ct === 'balrog-site',
          `minion deck ${deck.id}: site "${entry.card}" (${def.name}) has cardType "${ct}" — must be minion-site or balrog-site`,
        ).toBe(true);
      }
    }
  });
});
