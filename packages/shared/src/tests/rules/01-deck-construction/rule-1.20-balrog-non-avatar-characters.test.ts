/**
 * @module rule-1.20-balrog-non-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.20: Balrog Non-Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's non-avatar characters can only be minion characters. Instead of an agent being a character card for a Balrog player, it is treated as a hazard card in all areas throughout the game and is worth half of a creature for deck-building requirements.
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// ba-2   = Azog (minion-character) — valid in balrog deck
// tw-120 = Aragorn II (hero-character) — invalid in balrog deck
// le-4   = Calendal (minion-character) — valid in balrog deck

const baseBalrogDeck: DeckList = {
  id: 'test-balrog-characters',
  name: 'Balrog Characters Test',
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

describe('Rule 1.20 — Balrog Non-Avatar Characters', () => {
  test('Balrog deck with a minion character has no character error', () => {
    expect(validateDeck(baseBalrogDeck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('Balrog deck with a hero character produces a character error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        characters: [
          { name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 },
          { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'characters' && e.card === ('tw-120' as CardDefinitionId))).toBe(true);
  });

  test.todo('[BALROG] Agent characters are treated as hazards and count as half a creature for deck-building');
});
