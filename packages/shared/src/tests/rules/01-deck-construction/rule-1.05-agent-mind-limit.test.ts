/**
 * @module rule-1.05-agent-mind-limit
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.05: Agent Mind Limit
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The total mind of all agent cards in the entirety of a player's deck (i.e. their play deck, sideboard, and pool combined) cannot exceed 36.
 */

import { describe, test, expect } from 'vitest';
import { loadAllDecks, pool } from '../../test-helpers.js';
import { isCharacterCard } from '../../../index.js';

const AGENT_MIND_LIMIT = 36;

describe('Rule 1.05 — Agent Mind Limit', () => {
  test('Total mind of all agent cards in entire deck cannot exceed 36', () => {
    const decks = loadAllDecks();

    for (const deck of decks) {
      let totalAgentMind = 0;

      for (const section of [deck.pool, deck.deck.characters, deck.deck.hazards, deck.deck.resources, deck.sideboard]) {
        for (const entry of section) {
          if (entry.card === null) continue;
          const def = pool[entry.card];
          if (!isCharacterCard(def)) continue;
          if (!def.keywords?.includes('agent')) continue;
          if (def.mind !== null) {
            totalAgentMind += def.mind * entry.qty;
          }
        }
      }

      expect(
        totalAgentMind,
        `deck ${deck.id}: total agent mind ${totalAgentMind} exceeds limit of ${AGENT_MIND_LIMIT}`,
      ).toBeLessThanOrEqual(AGENT_MIND_LIMIT);
    }
  });
});
