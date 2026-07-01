/**
 * @module rule-1.07-avatar-specific-cards
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.07: Avatar-Specific Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A card that is "specific" to a certain avatar can only be included in a deck if its player declares that they are playing that avatar at the start of the game.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// wh-117 = The Forge-master, a "Saruman specific" Stage resource.
// wh-9   = Saruman, the matching Fallen-wizard avatar.
// wh-4   = Gandalf, a different Fallen-wizard avatar.

const baseFwDeck: DeckList = {
  id: 'test-avatar-specific',
  name: 'Avatar-Specific Card Test',
  alignment: 'fallen-wizard',
  pool: [],
  sideboard: [],
  sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30, { name: 'The Forge-master', card: 'wh-117' as CardDefinitionId, qty: 1 }],
  },
};

describe('Rule 1.07 — Avatar-Specific Cards', () => {
  test('an avatar-specific card without its matching avatar declared raises an error', () => {
    const errors = validateDeck(baseFwDeck, pool).filter(e => e.card === ('wh-117' as CardDefinitionId));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('Saruman');
  });

  test('an avatar-specific card is fine once its matching avatar is declared', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Saruman', card: 'wh-9' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === ('wh-117' as CardDefinitionId))).toBe(false);
  });

  test('a different declared avatar does not satisfy the requirement', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Gandalf', card: 'wh-4' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === ('wh-117' as CardDefinitionId))).toBe(true);
  });
});
