/**
 * @module rule-1.28-fw-location-deck
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.28: Fallen-Wizard Location Deck
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's location deck may include one copy of each hero site and one copy of each minion site (including havens), and may include multiple copies of each Fallen-wizard site.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// wh-58  = The White Towers (fallen-wizard-site, haven)
// tw-413 = Moria (hero-site)
// le-373 = Ettenmoors (minion-site)
// ba-93  = Moria (balrog-site) — not valid in FW deck

const baseFwDeck: DeckList = {
  id: 'test-fw-sites',
  name: 'FW Location Deck Test',
  alignment: 'fallen-wizard',
  pool: [],
  sideboard: [],
  sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.28 — Fallen-Wizard Location Deck', () => {
  test('FW deck with only fallen-wizard site has no site error', () => {
    expect(validateDeck(baseFwDeck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('FW deck with hero site (qty 1) has no site error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      sites: [
        { name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 },
        { name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 },
      ],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('FW deck with minion site (qty 1) has no site error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      sites: [
        { name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 },
        { name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 },
      ],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('FW deck with fallen-wizard site (qty 2) has no site error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 2 }],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('FW deck with hero site (qty 2) produces a sites error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 2 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'sites' && e.card === ('tw-413' as CardDefinitionId))).toBe(true);
  });

  test('FW deck with a balrog site produces a sites error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      sites: [
        { name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 },
        { name: 'Moria (Balrog)', card: 'ba-93' as CardDefinitionId, qty: 1 },
      ],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'sites' && e.card === ('ba-93' as CardDefinitionId))).toBe(true);
  });
});
