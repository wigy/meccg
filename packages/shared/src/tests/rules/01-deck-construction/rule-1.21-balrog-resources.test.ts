/**
 * @module rule-1.21-balrog-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.21: Balrog Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's resources can only be minion resources and/or hazards that may be played as resources.
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-299 = Black Mace (minion-resource-item) — valid in balrog deck
// tw-243 = Gates of Morning (hero-resource-event) — invalid in balrog deck

const baseBalrogDeck: DeckList = {
  id: 'test-balrog-resources',
  name: 'Balrog Resources Test',
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

describe('Rule 1.21 — Balrog Resources', () => {
  test('Balrog deck with only minion resources has no resource error', () => {
    expect(validateDeck(baseBalrogDeck, pool).filter(e => e.section === 'resources')).toHaveLength(0);
  });

  test('Balrog deck with a hero resource produces a resource error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        resources: [
          { name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 29 },
          { name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'resources' && e.card === ('tw-243' as CardDefinitionId))).toBe(true);
  });

  test.todo('[BALROG] Hazards playable as resources are also valid in the resource section');
});
