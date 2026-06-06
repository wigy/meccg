/**
 * @module rule-1.23-balrog-banned-cards
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.23: Balrog Banned Cards
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player cannot include the following cards in their deck:
 * • Above the Abyss
 * • Bade to Rule
 * • The Balrog (Ally)
 * • Balrog of Moria
 * • The Black Council
 * • Black Horse
 * • Black Rider
 * • By the Ringwraith's Word
 * • Creature of an Older World
 * • Durin's Bane
 * • Fell Rider
 * • The Fiery Blade
 * • Helm of Fear
 * • Heralded Lord
 * • Kill All But NOT the Halflings
 * • The Lidless Eye
 * • Morgul-Blade
 * • News of the Shire
 * • Open to the Summons
 * • Orders from Lugburz
 * • Padding Feet
 * • The Ring Leaves its Mark
 * • Ringwraith Unleashed cards
 * • Sauron
 * • They Ride Together
 * • Use Your Legs
 * • While The Yellow Face Sleeps
 */

import { describe, test, expect } from 'vitest';
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// as-77  = Above the Abyss (minion-resource-event) — banned in Balrog deck
// le-77  = Orcs of Dol Guldur (minion-resource-faction, race=orc) — allowed in Balrog deck

const baseBalrogDeck: DeckList = {
  id: 'test-balrog-banned',
  name: 'Balrog Banned Cards Test',
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

describe('Rule 1.23 — Balrog Banned Cards', () => {
  test('Balrog deck without banned cards has no banned-card error', () => {
    expect(validateDeck(baseBalrogDeck, pool).filter(e => e.message.includes('rule 1.23'))).toHaveLength(0);
  });

  test('Balrog deck with Above the Abyss produces an error', () => {
    // as-77 = Above the Abyss — explicitly banned for Balrog players
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        resources: [
          ...MINION_RESOURCES_30,
          { name: 'Above the Abyss', card: 'as-77' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === ('as-77' as CardDefinitionId))).toBe(true);
  });

  test('Balrog deck with a Ringwraith Unleashed card produces an error', () => {
    // le-170 = Black Rider (minion-resource-event, banned for balrog)
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        resources: [
          ...MINION_RESOURCES_30,
          { name: 'Black Rider', card: 'le-170' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === ('le-170' as CardDefinitionId))).toBe(true);
  });
});
