/**
 * @module rule-1.03-deck-composition
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.03: Deck Composition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Each player prepares a deck that comprises four distinct sets of cards: a location deck, a play deck, a sideboard, and a pool.
 */

import { describe, test, expect } from 'vitest';
import { pool } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// Minimal valid hero deck — passes all structural checks
const validDeck: DeckList = {
  id: 'test-valid',
  name: 'Valid',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
    hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 12 }],
    resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 30 }],
  },
};

describe('Rule 1.03 — Deck Composition', () => {
  test('Valid deck has no structural errors', () => {
    expect(validateDeck(validDeck, pool)).toHaveLength(0);
  });

  test('Missing pool produces a general error', () => {
    const deck = { ...validDeck, pool: undefined as unknown as DeckList['pool'] };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'general' && e.message.includes('pool'))).toBe(true);
  });

  test('Missing sideboard produces a general error', () => {
    const deck = { ...validDeck, sideboard: undefined as unknown as DeckList['sideboard'] };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'general' && e.message.includes('sideboard'))).toBe(true);
  });

  test('Missing sites (location deck) produces a general error', () => {
    const deck = { ...validDeck, sites: undefined as unknown as DeckList['sites'] };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'general' && e.message.includes('location'))).toBe(true);
  });

  test('Missing deck.characters produces a characters error', () => {
    const deck = {
      ...validDeck,
      deck: { ...validDeck.deck, characters: undefined as unknown as DeckList['deck']['characters'] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'characters' && e.message.includes('characters'))).toBe(true);
  });

  test('Missing deck.hazards produces a hazards error', () => {
    const deck = {
      ...validDeck,
      deck: { ...validDeck.deck, hazards: undefined as unknown as DeckList['deck']['hazards'] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('hazards'))).toBe(true);
  });

  test('Missing deck.resources produces a resources error', () => {
    const deck = {
      ...validDeck,
      deck: { ...validDeck.deck, resources: undefined as unknown as DeckList['deck']['resources'] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'resources' && e.message.includes('resources'))).toBe(true);
  });
});
