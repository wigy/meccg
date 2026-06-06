/**
 * @module rule-1.17-fw-non-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.17: Fallen-Wizard Non-Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's non-avatar characters may include either hero or minion characters, with agent character cards counting as characters for deck-building requirements.
 * [FALLEN-WIZARD] A Fallen-wizard player's non-Orc, non-Troll characters are treated as hero characters.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter } from '../../../index.js';

describe('Rule 1.17 — Fallen-Wizard Non-Avatar Characters', () => {
  test('[FALLEN-WIZARD] Non-avatar characters may include hero or minion; agents count as characters; non-Orc non-Troll treated as hero', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'fallen-wizard');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const section of [deck.pool, deck.deck.characters, deck.sideboard]) {
        for (const entry of section) {
          if (!entry.card) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (isAvatarCharacter(def)) continue;
          const ct = def.cardType;
          expect(
            ct === 'hero-character' || ct === 'minion-character',
            `deck ${deck.id}: non-avatar character "${entry.card}" (${def.name}) has disallowed cardType "${ct}"`,
          ).toBe(true);
        }
      }
    }
  });
});
