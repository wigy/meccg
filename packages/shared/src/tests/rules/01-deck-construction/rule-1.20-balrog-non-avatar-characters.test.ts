/**
 * @module rule-1.20-balrog-non-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.20: Balrog Non-Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's non-avatar characters can only be minion characters. Instead of an agent being a character card for a Balrog player, it is treated as a hazard card in all areas throughout the game and is worth half of a creature for deck-building requirements.
 */

import { describe, test, expect } from 'vitest';
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// ba-2   = Azog (minion-character) — valid in balrog deck
// tw-120 = Aragorn II (hero-character) — invalid in balrog deck
// le-4   = Calendal (minion-character) — valid in balrog deck

const baseBalrogDeck: DeckList = {
  id: 'test-balrog-characters',
  name: 'Balrog Characters Test',
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

describe('Rule 1.20 — Balrog Non-Avatar Characters', () => {
  test('Balrog deck with a minion character has no character error', () => {
    expect(validateDeck(baseBalrogDeck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('Balrog deck with a hero character produces a character error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        characters: [
          { name: 'Azog', card: 'ba-2' as CardDefinitionId, qty: 1 },
          { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'characters' && e.card === ('tw-120' as CardDefinitionId))).toBe(true);
  });

  test('[BALROG] Agents in hazards section count as half a creature toward the 12-creature minimum', () => {
    // 11 hazard-creatures + 2 agents × 0.5 = 12 → no creature-count error
    // dm-3 = Bill Ferny (minion-character, agent, unique)
    // dm-5 = Deallus (minion-character, agent, unique)
    const deckAtMinimum: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        hazards: [
          { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
          { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
          { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
          { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 2 },
          { name: 'Bill Ferny', card: 'dm-3' as CardDefinitionId, qty: 1 },
          { name: 'Deallus', card: 'dm-5' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const creatureErrors = validateDeck(deckAtMinimum, pool)
      .filter(e => e.section === 'hazards' && e.message.includes('creatures'));
    expect(creatureErrors).toHaveLength(0);
  });

  test('[BALROG] Fewer than 12 creature-equivalents (counting agents as 0.5) produces a hazards error', () => {
    // 10 hazard-creatures + 1 agent × 0.5 = 10.5 < 12 → creature-count error
    const deckBelowMinimum: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        hazards: [
          { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
          { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
          { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
          { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 1 },
          { name: 'Bill Ferny', card: 'dm-3' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const creatureErrors = validateDeck(deckBelowMinimum, pool)
      .filter(e => e.section === 'hazards' && e.message.includes('creatures'));
    expect(creatureErrors.length).toBeGreaterThan(0);
    expect(creatureErrors[0].message).toContain('creatures');
  });
});
