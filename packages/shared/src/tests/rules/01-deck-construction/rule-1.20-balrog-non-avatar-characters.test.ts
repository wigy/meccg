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
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter } from '../../../index.js';

describe('Rule 1.20 — Balrog Non-Avatar Characters', () => {
  test('[BALROG] Non-avatar characters can only be minion characters', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'balrog');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const section of [deck.pool, deck.deck.characters, deck.sideboard]) {
        for (const entry of section) {
          if (!entry.card) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (isAvatarCharacter(def)) continue;
          expect(def.cardType, `deck ${deck.id}: non-avatar character "${entry.card}" (${def.name}) must be a minion character`).toBe('minion-character');
        }
      }
    }
  });
});
