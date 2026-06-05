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
import { isAvatarCharacter, isCharacterCard, Alignment } from '../../../index.js';

describe('Rule 1.16 — Fallen-Wizard Avatar Characters', () => {
  test('[FALLEN-WIZARD] Avatar characters can only be Fallen-wizard avatars', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'fallen-wizard');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const entry of deck.deck.characters) {
        if (!entry.card) continue;
        const def = pool[entry.card];
        if (!isAvatarCharacter(def)) continue;
        expect(isCharacterCard(def) && def.alignment, `deck ${deck.id}: avatar "${entry.card}" (${def && 'name' in def ? def.name : '?'}) must have fallen-wizard alignment`).toBe(Alignment.FallenWizard);
      }
    }
  });
});
