/**
 * @module rule-1.04-unique-card-limits
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.04: Unique Card Limits
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The entirety of a player's deck cannot include more than one copy of each "unique" non-avatar card, and cannot include more than three copies of each non-unique card (except for haven cards). Manifestations of the same unique resource are treated as the same unique card for the purpose of determining how many copies may be included.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-120 = Aragorn II (hero-character, unique)
// tw-020 = Cave-drake (hazard-creature, non-unique)
// tw-156 = Gandalf (wizard, avatar — max 3 copies allowed)
// tw-243 = Gates of Morning (hero-resource-event, non-unique)

const validDeck: DeckList = {
  id: 'test-unique-limits',
  name: 'Unique Card Limits Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 }],
    hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 }],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.04 — Unique Card Limits', () => {
  test('Valid deck with 1 unique and 3 non-unique has no copy-limit error', () => {
    expect(validateDeck(validDeck, pool).filter(e =>
      e.message.includes('copies') || e.message.includes('copy'),
    )).toHaveLength(0);
  });

  test('Unique non-avatar card with qty 2 produces an error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        characters: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 2 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === ('tw-120' as CardDefinitionId) && e.message.includes('max 1'))).toBe(true);
  });

  test('Non-unique card with qty 4 produces an error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 4 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === ('tw-020' as CardDefinitionId) && e.message.includes('max 3'))).toBe(true);
  });

  test('Avatar (wizard) with qty 3 produces no copy-limit error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 3 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e =>
      e.card === ('tw-156' as CardDefinitionId) && e.message.includes('copies'),
    )).toHaveLength(0);
  });
});
