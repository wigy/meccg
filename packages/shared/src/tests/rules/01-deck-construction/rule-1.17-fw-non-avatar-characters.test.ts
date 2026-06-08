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
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-120 = Aragorn II (hero-character) — valid in FW deck
// le-4   = Calendal (minion-character) — also valid in FW deck

const baseFwDeck: DeckList = {
  id: 'test-fw-characters',
  name: 'FW Characters Test',
  alignment: 'fallen-wizard',
  pool: [],
  sideboard: [],
  sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.17 — Fallen-Wizard Non-Avatar Characters', () => {
  test('FW deck with a hero character has no character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('FW deck with a minion character has no character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('FW deck with both hero and minion characters has no character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [
          { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 },
          { name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] Agent character in deck characters section produces no alignment error', () => {
    // dm-3 = Bill Ferny (minion-character, agent, unique) — agents are character cards
    // for deck-building in FW decks (unlike hero decks where they count as hazards)
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Bill Ferny', card: 'dm-3' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters' && e.card === ('dm-3' as CardDefinitionId))).toHaveLength(0);
  });

  test.todo('[FALLEN-WIZARD] Non-Orc, non-Troll characters treated as hero characters in play');
});
