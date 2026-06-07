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
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// dm-2  = Baduila (agent, mind 8, unique) — 4 agents × 8 = 32 ≤ 36 OK; 5 agents × 8 would need non-unique agents
// dm-3  = Bill Ferny (agent, mind 3, unique) — small-mind agent
// dm-14 = Glorfindel II agent? — let's use agents with higher mind
// We need non-unique agents to hit > 36. Use dm-3 (mind 3) * 13 = 39 > 36
// Actually dm-3 is unique, so max 1 copy. Need to find non-unique agents.

const baseDeck: DeckList = {
  id: 'test-agent-mind',
  name: 'Agent Mind Limit Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.05 — Agent Mind Limit', () => {
  test('Deck with agents totalling ≤ 36 mind has no agent mind error', () => {
    // dm-2 Baduila (mind 8, unique) × 1 = 8 ≤ 36
    const deck: DeckList = {
      ...baseDeck,
      deck: {
        ...baseDeck.deck,
        characters: [{ name: 'Baduila', card: 'dm-2' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'general' && e.message.includes('agent'))).toHaveLength(0);
  });

  test('Deck with agents totalling > 36 mind produces a general error', () => {
    // dm-2 Baduila (mind 8, unique) × 1 in deck + Anarin dm-1 (mind 7) × 1 + ...
    // Spread across characters + hazards + sideboard to hit > 36
    // dm-1 (7) + dm-2 (8) + dm-4 (5) + dm-5 (3) + dm-6 (5) + dm-7 (5) + dm-8 (5) = 38
    const deck: DeckList = {
      ...baseDeck,
      deck: {
        ...baseDeck.deck,
        characters: [
          { name: 'Anarin', card: 'dm-1' as CardDefinitionId, qty: 1 },
          { name: 'Baduila', card: 'dm-2' as CardDefinitionId, qty: 1 },
          { name: 'Dâsakûn', card: 'dm-4' as CardDefinitionId, qty: 1 },
          { name: 'Deallus', card: 'dm-5' as CardDefinitionId, qty: 1 },
          { name: 'Drór', card: 'dm-6' as CardDefinitionId, qty: 1 },
          { name: 'Elerína', card: 'dm-7' as CardDefinitionId, qty: 1 },
          { name: 'Elwen', card: 'dm-8' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'general' && e.message.includes('agent') && e.message.includes('36'))).toBe(true);
  });
});
