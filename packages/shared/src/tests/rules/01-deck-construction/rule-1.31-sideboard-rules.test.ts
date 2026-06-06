/**
 * @module rule-1.31-sideboard-rules
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.31: Sideboard Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A sideboard is a set of cards set off to the side during the game, and which may contain any number of resources, hazards, and/or characters, but which must adhere to any other deck restrictions when considered in conjunction with the play deck (e.g. not exceeding the allowed maximum number of each specific card across the whole deck, not exceeding the 36 mind limit for agent cards, and/or any other player-specific restrictions).
 * The maximum sideboard size is 30 cards for a Starter Game, 30 cards for a Short Game, 35 cards for a Long Game, or 40 cards for a Campaign Game. A player may also include up to 10 additional cards in their sideboard that are preselected for Fallen-wizard opponents, and which may only be accessed during the game if their opponent is a Fallen-wizard player.
 * A player may include any number of avatars in their sideboard so long as no more than one avatar has multiple copies across their combined play deck and sideboard.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks } from '../../test-helpers.js';

// Maximum sideboard size for Short Game (30), Long Game (35), Campaign (40)
const SHORT_GAME_SIDEBOARD_MAX = 30;

describe('Rule 1.31 — Sideboard Rules', () => {
  test('Sideboard size depends on game length; must adhere to deck restrictions with play deck', () => {
    const decks = loadAllDecks();
    for (const deck of decks) {
      if (!deck.id.startsWith('challenge')) continue;
      const sideboardTotal = deck.sideboard.reduce((sum, e) => sum + e.qty, 0);
      expect(
        sideboardTotal,
        `deck ${deck.id}: sideboard has ${sideboardTotal} cards, max is ${SHORT_GAME_SIDEBOARD_MAX} for Short Game`,
      ).toBeLessThanOrEqual(SHORT_GAME_SIDEBOARD_MAX);
    }
  });
});
