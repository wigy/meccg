/**
 * @module rule-1.11-minion-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.11: Minion Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player's avatar characters can only be Ringwraith avatars.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter } from '../../../index.js';

describe('Rule 1.11 — Minion Avatar Characters', () => {
  test('[MINION] Ringwraith player avatar characters can only be Ringwraith avatars', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'minion') continue;
      for (const entry of deck.deck.characters) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!isCharacterCard(def) || !isAvatarCharacter(def)) continue;
        expect(
          def.race,
          `minion deck ${deck.id}: avatar "${entry.card}" (${def.name}) is not a Ringwraith — race is "${def.race}"`,
        ).toBe('ringwraith');
      }
    }
  });
});
