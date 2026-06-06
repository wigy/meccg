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
import { loadAllDecks } from '../../test-helpers.js';

describe('Rule 1.03 — Deck Composition', () => {
  test('Each deck has all four components: location deck (sites), play deck (characters/hazards/resources), sideboard, and pool', () => {
    const decks = loadAllDecks();
    expect(decks.length).toBeGreaterThan(0);

    for (const deck of decks) {
      expect(Array.isArray(deck.sites), `deck ${deck.id}: missing sites (location deck)`).toBe(true);
      expect(Array.isArray(deck.pool), `deck ${deck.id}: missing pool`).toBe(true);
      expect(Array.isArray(deck.sideboard), `deck ${deck.id}: missing sideboard`).toBe(true);
      expect(deck.deck, `deck ${deck.id}: missing play deck`).toBeDefined();
      expect(Array.isArray(deck.deck.characters), `deck ${deck.id}: play deck missing characters section`).toBe(true);
      expect(Array.isArray(deck.deck.hazards), `deck ${deck.id}: play deck missing hazards section`).toBe(true);
      expect(Array.isArray(deck.deck.resources), `deck ${deck.id}: play deck missing resources section`).toBe(true);
    }
  });
});
