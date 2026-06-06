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
import { isCharacterCard, isAvatarCharacter, Alignment } from '../../../index.js';

describe('Rule 1.11 — Minion Avatar Characters', () => {
  test('[MINION] Ringwraith player avatar characters can only be Ringwraith avatars', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'minion');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const section of [deck.pool, deck.deck.characters, deck.sideboard]) {
        for (const entry of section) {
          if (!entry.card) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (!isAvatarCharacter(def)) continue;
          expect(
            def.alignment === Alignment.Ringwraith,
            `deck ${deck.id}: avatar character "${entry.card}" (${def.name}) has alignment "${def.alignment}", expected ringwraith`,
          ).toBe(true);
        }
      }
    }
  });
});
