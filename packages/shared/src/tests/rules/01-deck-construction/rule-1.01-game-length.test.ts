/**
 * @module rule-1.01-game-length
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.01: Game Length
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The length of the game is determined either through mutual agreement or by the tournament organizer: Starter, Short (which is the default length), Long, or Campaign.
 */

import { describe, test, expect } from 'vitest';
import { pool, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// A deck's declared game length governs its maximum sideboard size (rule
// 1.6.1): 30 for Starter or Short, 35 for Long, 40 for Campaign.
const baseDeck: DeckList = {
  id: 'test-game-length',
  name: 'Game Length Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 30 }],
  },
};

function sideboardOf(count: number): DeckList['sideboard'] {
  return [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: count }];
}

describe('Rule 1.01 — Game Length', () => {
  test('a deck with no declared game length defaults to Short (max 30 sideboard cards)', () => {
    const deck: DeckList = { ...baseDeck, sideboard: sideboardOf(30) };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sideboard')).toHaveLength(0);
    const overDeck: DeckList = { ...baseDeck, sideboard: sideboardOf(31) };
    expect(validateDeck(overDeck, pool).some(e => e.section === 'sideboard')).toBe(true);
  });

  test('a Starter game caps the sideboard at 30 cards', () => {
    const deck: DeckList = { ...baseDeck, gameLength: 'starter', sideboard: sideboardOf(30) };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sideboard')).toHaveLength(0);
    const overDeck: DeckList = { ...baseDeck, gameLength: 'starter', sideboard: sideboardOf(31) };
    expect(validateDeck(overDeck, pool).some(e => e.section === 'sideboard')).toBe(true);
  });

  test('a Long game raises the sideboard cap to 35 cards', () => {
    const deck: DeckList = { ...baseDeck, gameLength: 'long', sideboard: sideboardOf(35) };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sideboard')).toHaveLength(0);
    const overDeck: DeckList = { ...baseDeck, gameLength: 'long', sideboard: sideboardOf(36) };
    expect(validateDeck(overDeck, pool).some(e => e.section === 'sideboard')).toBe(true);
  });

  test('a Campaign game raises the sideboard cap to 40 cards', () => {
    const deck: DeckList = { ...baseDeck, gameLength: 'campaign', sideboard: sideboardOf(40) };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sideboard')).toHaveLength(0);
    const overDeck: DeckList = { ...baseDeck, gameLength: 'campaign', sideboard: sideboardOf(41) };
    expect(validateDeck(overDeck, pool).some(e => e.section === 'sideboard')).toBe(true);
  });
});
