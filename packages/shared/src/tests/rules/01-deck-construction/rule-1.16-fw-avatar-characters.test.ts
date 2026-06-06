/**
 * @module rule-1.16-fw-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.16: Fallen-Wizard Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's avatar characters can only be Fallen-wizard avatars.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter, Alignment } from '../../../index.js';

describe('Rule 1.16 — Fallen-Wizard Avatar Characters', () => {
  test('[FALLEN-WIZARD] Avatar characters can only be Fallen-wizard (Wizard) avatars', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'fallen-wizard');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const section of [deck.pool, deck.deck.characters, deck.sideboard]) {
        for (const entry of section) {
          if (!entry.card) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (!isAvatarCharacter(def)) continue;
          expect(
            def.alignment === Alignment.Wizard,
            `deck ${deck.id}: avatar character "${entry.card}" (${def.name}) has alignment "${def.alignment}", expected wizard`,
          ).toBe(true);
        }
      }
    }
  });
});
