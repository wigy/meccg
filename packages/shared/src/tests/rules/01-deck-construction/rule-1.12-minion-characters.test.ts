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
import { isCharacterCard, isAvatarCharacter } from '../../../index.js';

describe('Rule 1.12 — Minion Characters', () => {
  test('[MINION] Characters can only be minion characters; agents count as both character and hazard until played', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'minion') continue;
      for (const section of [deck.pool, deck.deck.characters]) {
        for (const entry of section) {
          if (entry.card === null) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (isAvatarCharacter(def)) continue;
          expect(
            def.cardType,
            `minion deck ${deck.id}: character "${entry.card}" (${def.name}) has cardType "${def.cardType}" — must be minion-character`,
          ).toBe('minion-character');
        }
      }
    }
  });
});
