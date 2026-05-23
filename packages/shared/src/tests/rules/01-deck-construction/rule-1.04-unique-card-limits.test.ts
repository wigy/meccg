/**
 * @module rule-1.04-unique-card-limits
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.04: Unique Card Limits
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The entirety of a player's deck cannot include more than one copy of each "unique" non-avatar card, and cannot include more than three copies of each non-unique card (except for haven cards). Manifestations of the same unique resource are treated as the same unique card for the purpose of determining how many copies may be included.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isAvatarCharacter } from '../../../index.js';

describe('Rule 1.04 — Unique Card Limits', () => {
  test('Max one copy of each unique non-avatar card; max three copies of each non-unique card (except havens)', () => {
    const decks = loadAllDecks();

    for (const deck of decks) {
      // Count copies of each card across pool + play deck + sideboard.
      // Haven cards in the sites section are exempt and not counted here.
      const counts = new Map<string, number>();
      for (const section of [deck.pool, deck.deck.characters, deck.deck.hazards, deck.deck.resources, deck.sideboard]) {
        for (const entry of section) {
          if (entry.card !== null) {
            counts.set(entry.card, (counts.get(entry.card) ?? 0) + entry.qty);
          }
        }
      }

      for (const [cardId, count] of counts) {
        const def = pool[cardId];
        if (isAvatarCharacter(def)) continue; // avatars (wizards, ringwraiths, etc.) may have 3 copies

        if (def && 'unique' in def && def.unique) {
          expect(
            count,
            `deck ${deck.id}: unique card "${cardId}" has ${count} copies (max 1)`,
          ).toBe(1);
        } else {
          expect(
            count,
            `deck ${deck.id}: non-unique card "${cardId}" has ${count} copies (max 3)`,
          ).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});
