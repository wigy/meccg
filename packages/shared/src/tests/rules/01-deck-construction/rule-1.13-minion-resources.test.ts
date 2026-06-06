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
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-299 = Black Mace (minion-resource-item — valid)
// tw-243 = Gates of Morning (hero-resource-event — NOT allowed in minion deck)

const minionDeck: DeckList = {
  id: 'test-minion-resources',
  name: 'Minion Resources Test',
  alignment: 'minion',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Adûnaphel', card: 'le-50' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...MINION_RESOURCES_30],
  },
};

describe('Rule 1.13 — Minion Resources', () => {
  test('Minion deck with minion-resource-item has no resource alignment error', () => {
    const errors = validateDeck(minionDeck, pool);
    expect(errors.filter(e => e.section === 'resources')).toHaveLength(0);
  });

  test('Minion deck with a hero-resource-event produces a resources error', () => {
    const deck: DeckList = {
      ...minionDeck,
      deck: {
        ...minionDeck.deck,
        resources: [
          { name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 29 },
          { name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    const resErrors = errors.filter(e => e.section === 'resources' && e.card === ('tw-243' as CardDefinitionId));
    expect(resErrors.length).toBeGreaterThan(0);
    expect(resErrors[0].message).toContain('minion-resource');
  });
});
