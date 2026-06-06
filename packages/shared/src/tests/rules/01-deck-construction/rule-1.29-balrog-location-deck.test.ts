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
import { pool } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-373 = Ettenmoors (minion-site, shadow-hold) — valid in balrog deck
// le-392 = Moria (minion-site) — invalid: requires ba-93 Balrog version
// le-352 = Barad-dûr (minion-site, dark-hold) — invalid: dark-holds need balrog version
// ba-93  = Moria (balrog-site) — valid
// tw-413 = Moria (hero-site) — invalid in balrog deck

const baseBalrogDeck: DeckList = {
  id: 'test-balrog-sites',
  name: 'Balrog Location Deck Test',
  alignment: 'balrog',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
    hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 12 }],
    resources: [{ name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 30 }],
  },
};

describe('Rule 1.29 — Balrog Location Deck', () => {
  test('Balrog deck with an ordinary minion site has no site error', () => {
    expect(validateDeck(baseBalrogDeck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('Balrog deck with balrog-site version of Moria has no site error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      sites: [
        { name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 },
        { name: 'Moria', card: 'ba-93' as CardDefinitionId, qty: 1 },
      ],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('Balrog deck with minion-site Moria produces a sites error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      sites: [{ name: 'Moria', card: 'le-392' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'sites' && e.card === ('le-392' as CardDefinitionId))).toBe(true);
  });

  test('Balrog deck with a dark-hold minion site produces a sites error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      sites: [{ name: 'Barad-dûr', card: 'le-352' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'sites' && e.card === ('le-352' as CardDefinitionId))).toBe(true);
  });

  test('Balrog deck with a hero site produces a sites error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      sites: [
        { name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 },
        { name: 'Moria (hero)', card: 'tw-413' as CardDefinitionId, qty: 1 },
      ],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'sites' && e.card === ('tw-413' as CardDefinitionId))).toBe(true);
  });
});
