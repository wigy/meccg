/**
 * @module rule-1.09-hero-non-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.09: Hero Non-Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's non-avatar characters can only be hero characters, but a Wizard player may include agent character cards in their deck. Instead of an agent being a character card for a Wizard player, it is treated as a hazard card for deck-building requirements and in all areas throughout the game.
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-120 = Aragorn II (hero-character — valid in hero deck)
// le-4   = Calendal (minion-character — invalid in hero deck)

const heroDeck: DeckList = {
  id: 'test-hero-nonavatar',
  name: 'Hero Non-Avatar Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [
      { name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 },
      { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 },
    ],
    hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 12 }],
    resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 30 }],
  },
};

describe('Rule 1.09 — Hero Non-Avatar Characters', () => {
  test('Hero deck with hero-character has no alignment error', () => {
    const errors = validateDeck(heroDeck, pool);
    expect(errors.filter(e => e.section === 'characters' && e.card === ('tw-120' as CardDefinitionId))).toHaveLength(0);
  });

  test('Hero deck with a minion-character produces a characters error', () => {
    const deck: DeckList = {
      ...heroDeck,
      deck: {
        ...heroDeck.deck,
        characters: [
          { name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 },
          { name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    const charErrors = errors.filter(e => e.section === 'characters' && e.card === ('le-4' as CardDefinitionId));
    expect(charErrors.length).toBeGreaterThan(0);
    expect(charErrors[0].message).toContain('hero-character');
  });
});
