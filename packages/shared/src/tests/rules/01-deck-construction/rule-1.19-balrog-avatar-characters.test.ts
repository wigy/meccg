/**
 * @module rule-1.19-balrog-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.19: Balrog Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's avatar characters can only be Balrog avatars.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isAvatarCharacter, isCharacterCard, Alignment } from '../../../index.js';

describe('Rule 1.19 — Balrog Avatar Characters', () => {
  test('[BALROG] Avatar characters can only be Balrog avatars', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'balrog');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const entry of deck.deck.characters) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!isAvatarCharacter(def)) continue;
        expect(isCharacterCard(def) && def.alignment, `deck ${deck.id}: avatar "${entry.card}" (${def && 'name' in def ? def.name : '?'}) must have balrog alignment`).toBe(Alignment.Balrog);
      }
    }
  });
});
