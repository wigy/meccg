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
import { isAvatarCharacter, isCharacterCard, Race } from '../../../index.js';

describe('Rule 1.11 — Minion Avatar Characters', () => {
  test('[MINION] Ringwraith player avatar characters can only be Ringwraith avatars', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'minion');
    expect(decks.length).toBeGreaterThan(0);

    for (const deck of decks) {
      for (const entry of deck.deck.characters) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!isAvatarCharacter(def)) continue;
        expect(
          isCharacterCard(def) && def.race,
          `deck ${deck.id}: avatar "${entry.card}" (${def && 'name' in def ? def.name : '?'}) must be race ringwraith`,
        ).toBe(Race.Ringwraith);
      }
    }
  });
});
