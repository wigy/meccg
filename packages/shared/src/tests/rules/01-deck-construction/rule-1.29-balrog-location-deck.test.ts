/**
 * @module rule-1.29-balrog-location-deck
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.29: Balrog Location Deck
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's location deck may include one copy of each minion site other than the following, which require a Balrog version of the site:
 * • Moria, Carn Dûm, Dol Guldur, Minas Morgul
 * • Any Under-deeps sites
 * • Any Dark-Holds
 * [BALROG] A Balrog player treats their own Geann a-Lisch site card as a Ruins & Lairs with no Darkhaven effects in all areas throughout the game.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';

describe('Rule 1.29 — Balrog Location Deck', () => {
  test('[BALROG] Location deck may only include balrog or minion sites', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'balrog');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const entry of deck.sites) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!def) continue;
        const ct = def.cardType;
        expect(
          ct === 'balrog-site' || ct === 'minion-site',
          `deck ${deck.id}: site "${entry.card}" has disallowed cardType "${ct}"`,
        ).toBe(true);
      }
    }
  });
});
