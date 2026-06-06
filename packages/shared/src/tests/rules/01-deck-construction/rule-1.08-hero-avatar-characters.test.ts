/**
 * @module rule-1.08-hero-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.08: Hero Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's avatar characters can only be Wizard avatars.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter } from '../../../index.js';

describe('Rule 1.08 — Hero Avatar Characters', () => {
  test('[HERO] Wizard player avatar characters can only be Wizard avatars', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (deck.alignment !== 'hero') continue;
      for (const entry of deck.deck.characters) {
        if (entry.card === null) continue;
        const def = pool[entry.card];
        if (!isCharacterCard(def) || !isAvatarCharacter(def)) continue;
        expect(
          def.race,
          `hero deck ${deck.id}: avatar "${entry.card}" (${def.name}) is not a Wizard avatar`,
        ).toBe('wizard');
      }
    }
  });
});
