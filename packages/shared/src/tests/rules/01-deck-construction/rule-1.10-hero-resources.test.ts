/**
 * @module rule-1.10-hero-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.10: Hero Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's resources can only be hero resources, except for minion items and/or hazards that may be played as resources.
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-243 = Gates of Morning (hero-resource-event — valid)
// le-299 = Black Mace (minion-resource-item — allowed in hero deck as cross-alignment item)
// le-265 = Goblins of Goblin-gate (minion-resource-faction — NOT allowed in hero deck)

const heroDeck: DeckList = {
  id: 'test-hero-resources',
  name: 'Hero Resources Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
    hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 12 }],
    resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 30 }],
  },
};

describe('Rule 1.10 — Hero Resources', () => {
  test('Hero deck with hero-resource-event has no resource alignment error', () => {
    const errors = validateDeck(heroDeck, pool);
    expect(errors.filter(e => e.section === 'resources')).toHaveLength(0);
  });

  test('Hero deck with minion-resource-item (cross-alignment item) has no error', () => {
    const deck: DeckList = {
      ...heroDeck,
      deck: {
        ...heroDeck.deck,
        resources: [
          { name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 29 },
          { name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'resources' && e.card === ('le-299' as CardDefinitionId))).toHaveLength(0);
  });

  test('Hero deck with a minion-resource-faction produces a resources error', () => {
    // le-265 = Goblins of Goblin-gate: minion-resource-faction — not allowed in hero deck
    const deck: DeckList = {
      ...heroDeck,
      deck: {
        ...heroDeck.deck,
        resources: [
          { name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 29 },
          { name: 'Goblins of Goblin-gate', card: 'le-265' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    const resErrors = errors.filter(e => e.section === 'resources' && e.card === ('le-265' as CardDefinitionId));
    expect(resErrors.length).toBeGreaterThan(0);
    expect(resErrors[0].message).toContain('hero-resource');
  });
});
