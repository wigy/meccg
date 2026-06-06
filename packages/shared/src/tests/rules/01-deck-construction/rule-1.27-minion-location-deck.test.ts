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
import { pool } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-373 = Ettenmoors (minion-site — valid in minion deck)
// tw-413 = Moria (hero-site — invalid in minion deck)

const minionDeck: DeckList = {
  id: 'test-minion-sites',
  name: 'Minion Location Deck Test',
  alignment: 'minion',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Adûnaphel', card: 'le-50' as CardDefinitionId, qty: 1 }],
    hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 12 }],
    resources: [{ name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 30 }],
  },
};

describe('Rule 1.27 — Minion Location Deck', () => {
  test('Minion deck with only minion-sites has no site alignment error', () => {
    expect(validateDeck(minionDeck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('Minion deck with a hero-site produces a sites error', () => {
    const deck: DeckList = {
      ...minionDeck,
      sites: [
        { name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 },
        { name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 },
      ],
    };
    const errors = validateDeck(deck, pool);
    const siteErrors = errors.filter(e => e.section === 'sites' && e.card === ('tw-413' as CardDefinitionId));
    expect(siteErrors.length).toBeGreaterThan(0);
    expect(siteErrors[0].message).toContain('minion-site');
  });
});
