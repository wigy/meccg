/**
 * @module rule-1.12-minion-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.12: Minion Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player's characters can only be minion characters, with agent character cards counting as characters for deck-building requirements. During the game, an agent card in a Ringwraith player's deck counts as both a character card and a hazard card until it is played as one or the other.
 */

import { describe, test, expect } from 'vitest';
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-4   = Calendal (minion-character — valid in minion deck)
// tw-120 = Aragorn II (hero-character — invalid in minion deck)

const minionDeck: DeckList = {
  id: 'test-minion-chars',
  name: 'Minion Characters Test',
  alignment: 'minion',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [
      { name: 'Adûnaphel', card: 'le-50' as CardDefinitionId, qty: 1 },
      { name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 },
    ],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...MINION_RESOURCES_30],
  },
};

describe('Rule 1.12 — Minion Characters', () => {
  test('Minion deck with a minion-character has no alignment error', () => {
    const errors = validateDeck(minionDeck, pool);
    expect(errors.filter(e => e.section === 'characters' && e.card === ('le-4' as CardDefinitionId))).toHaveLength(0);
  });

  test('Minion deck with a hero-character produces a characters error', () => {
    const deck: DeckList = {
      ...minionDeck,
      deck: {
        ...minionDeck.deck,
        characters: [
          { name: 'Adûnaphel', card: 'le-50' as CardDefinitionId, qty: 1 },
          { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    const charErrors = errors.filter(e => e.section === 'characters' && e.card === ('tw-120' as CardDefinitionId));
    expect(charErrors.length).toBeGreaterThan(0);
    expect(charErrors[0].message).toContain('minion-character');
  });
});
