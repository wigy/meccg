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
import { pool, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

const baseDeck: DeckList = {
  id: 'test-sideboard',
  name: 'Sideboard Test',
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

describe('Rule 1.31 — Sideboard Rules', () => {
  test('Sideboard with 30 cards has no size error', () => {
    const deck: DeckList = {
      ...baseDeck,
      sideboard: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 30 }],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sideboard')).toHaveLength(0);
  });

  test('Sideboard with 31 cards produces a sideboard error', () => {
    const deck: DeckList = {
      ...baseDeck,
      sideboard: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 31 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'sideboard' && e.message.includes('max 30'))).toBe(true);
  });

  // MEWH — anti-Fallen-wizard sideboard: up to 10 preselected cards.
  test('Anti-FW sideboard with 10 cards has no size error', () => {
    const deck: DeckList = {
      ...baseDeck,
      antiFwSideboard: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 10 }],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'anti-fw-sideboard')).toHaveLength(0);
  });

  test('Anti-FW sideboard with 11 cards produces an anti-fw-sideboard error', () => {
    const deck: DeckList = {
      ...baseDeck,
      antiFwSideboard: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 11 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'anti-fw-sideboard' && e.message.includes('max 10'))).toBe(true);
  });

  test('Anti-FW sideboard cards count toward combined deck limits (unique card)', () => {
    // Orcrist (unique, max 1) appears once in the play deck; a second copy in
    // the anti-FW sideboard pushes the combined count to 2 — illegal.
    const deck: DeckList = {
      ...baseDeck,
      deck: {
        ...baseDeck.deck,
        resources: [
          { name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 29 },
          { name: 'Orcrist', card: 'tw-295' as CardDefinitionId, qty: 1 },
        ],
      },
      antiFwSideboard: [{ name: 'Orcrist', card: 'tw-295' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.message.includes('Orcrist') && e.message.includes('max 1'))).toBe(true);
  });
});
