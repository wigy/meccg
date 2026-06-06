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
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// ba-2   = Azog (orc, mind 7) — valid: orc, mind < 9
// le-21  = Lieutenant of Dol Guldur (troll, mind 9) — invalid: mind ≥ 9 and not ba-*
// le-4   = Calendal (elf, mind 6) — invalid: race not orc or troll

const baseBalrogDeck: DeckList = {
  id: 'test-balrog-restrictions',
  name: 'Balrog Restrictions Test',
  alignment: 'balrog',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...MINION_RESOURCES_30],
  },
};

describe('Rule 1.22 — Balrog Additional Restrictions', () => {
  test('Balrog deck with an Orc character (mind < 9) has no restriction error', () => {
    expect(validateDeck(baseBalrogDeck, pool).filter(e =>
      e.section === 'characters' && e.card === ('ba-2' as CardDefinitionId),
    )).toHaveLength(0);
  });

  test('Balrog deck with a non-Orc non-Troll character produces a character error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        characters: [
          { name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 },
          { name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'characters' && e.card === ('le-4' as CardDefinitionId))).toBe(true);
  });

  test('Balrog deck with a troll character of mind 9 produces a mind error', () => {
    // le-21 Lieutenant of Dol Guldur (troll, mind 9) — valid race but mind ≥ 9
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        characters: [
          { name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 },
          { name: 'Lieutenant of Dol Guldur', card: 'le-21' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'characters' && e.card === ('le-21' as CardDefinitionId) && e.message.includes('mind'))).toBe(true);
  });

  test.todo('[BALROG] Factions can only be Orc, Troll, Wolf, Animal, or Dragon');
});
