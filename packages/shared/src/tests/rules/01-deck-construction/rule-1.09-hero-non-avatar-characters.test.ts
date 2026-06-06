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
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter } from '../../../index.js';

describe('Rule 1.09 — Hero Non-Avatar Characters', () => {
  test('[HERO] Non-avatar characters can only be hero characters; agents count as hazard cards', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'hero');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const section of [deck.pool, deck.deck.characters, deck.sideboard]) {
        for (const entry of section) {
          if (!entry.card) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (isAvatarCharacter(def)) continue;
          const isAgent = (def.keywords ?? []).includes('agent');
          if (isAgent) continue;
          expect(
            def.cardType === 'hero-character',
            `deck ${deck.id}: non-avatar character "${entry.card}" (${def.name}) has disallowed cardType "${def.cardType}"`,
          ).toBe(true);
        }
      }
    }
  });
});
