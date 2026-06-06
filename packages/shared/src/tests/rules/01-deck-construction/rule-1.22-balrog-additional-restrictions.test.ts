/**
 * @module rule-1.22-balrog-additional-restrictions
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.22: Balrog Additional Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player has the following additional restrictions on the cards in their deck:
 * • Non-avatar characters can only be Orc or Troll
 * • Characters can only have mind less than 9 unless they are Balrog-specific
 * • Factions can only be Orc, Troll, Wolf, Animal, or Dragon
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard, isAvatarCharacter, Alignment, Race } from '../../../index.js';

describe('Rule 1.22 — Balrog Additional Restrictions', () => {
  test('[BALROG] Non-avatar characters can only be Orc or Troll', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'balrog');
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
            def.race === Race.Orc || def.race === Race.Troll,
            `deck ${deck.id}: non-avatar character "${entry.card}" (${def.name}) has disallowed race "${def.race}"`,
          ).toBe(true);
        }
      }
    }
  });

  test('[BALROG] Characters can only have mind < 9 unless Balrog-specific', () => {
    const decks = loadAllDecks().filter(d => d.alignment === 'balrog');
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) {
      for (const section of [deck.pool, deck.deck.characters, deck.sideboard]) {
        for (const entry of section) {
          if (!entry.card) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (def.mind === null) continue;
          const isBalrogSpecific = def.alignment === Alignment.Balrog;
          expect(
            def.mind < 9 || isBalrogSpecific,
            `deck ${deck.id}: character "${entry.card}" (${def.name}) has mind ${def.mind} and is not Balrog-specific`,
          ).toBe(true);
        }
      }
    }
  });

  test.todo('[BALROG] Factions can only be Orc, Troll, Wolf, Animal, or Dragon');
});
