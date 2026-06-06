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
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard } from '../../../index.js';

describe('Rule 1.12 — Minion Characters', () => {
  test('[MINION] Characters section contains only minion-character type cards', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'minion') continue;
      for (const entry of deck.deck.characters) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!isCharacterCard(def)) continue;
        expect(
          def.cardType,
          `minion deck ${deck.id}: character "${entry.card}" (${def.name}) has type "${def.cardType}", expected "minion-character"`,
        ).toBe('minion-character');
      }
    }
  });
});
