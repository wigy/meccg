/**
 * @module rule-1.32-pool-rules
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.32: Pool Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A pool is a set of up to 10 non-avatar characters that adhere to any deck restrictions when considered in conjunction with the play deck and the sideboard other than total number of characters (i.e. a player may have up to 10 characters in their pool even if they already have up to 10 non-avatar characters in their play deck). A pool may also contain up to two non-unique, non-hoard minor items that adhere to any deck restrictions when considered in conjunction with the play deck and the sideboard.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-120 = Aragorn II (hero-character, non-avatar) — valid pool character
// tw-206 = Dagger of Westernesse (hero-resource-item, minor, non-unique) — valid pool item
// tw-225 = Elven Cloak (hero-resource-item, minor, non-unique) — valid pool item

const baseDeck: DeckList = {
  id: 'test-pool-rules',
  name: 'Pool Rules Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.32 — Pool Rules', () => {
  test('Pool with 10 non-avatar characters has no pool error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 10 }],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'pool')).toHaveLength(0);
  });

  test('Pool with 11 non-avatar characters produces a pool error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 11 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'pool' && e.message.includes('max 10'))).toBe(true);
  });

  test('Pool with 2 non-unique minor items has no pool error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Dagger of Westernesse', card: 'tw-206' as CardDefinitionId, qty: 2 }],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'pool')).toHaveLength(0);
  });

  test('Pool with 3 non-unique minor items produces a pool error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Dagger of Westernesse', card: 'tw-206' as CardDefinitionId, qty: 3 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'pool' && e.message.includes('max 2'))).toBe(true);
  });

  test('Pool with 2 Elven Cloaks has no pool error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Elven Cloak', card: 'tw-225' as CardDefinitionId, qty: 2 }],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'pool')).toHaveLength(0);
  });

  // Rule 1.7 — a card that may not be part of a starting company has no legal
  // use in the pool (whose only purpose is starting-company setup) and must go
  // in the play deck. td-91 = Fram Framson (hero-character flagged
  // `not-starting-character`); as-130 = Records Unread (minor item flagged
  // `no-starting-company`).
  test('Pool with a `not-starting-character` character produces a pool error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Fram Framson', card: 'td-91' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'pool' && e.message.includes('may not be included with a starting company'))).toBe(true);
  });

  test('Pool with a `no-starting-company` minor item produces a pool error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Records Unread', card: 'as-130' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'pool' && e.message.includes('may not be included with a starting company'))).toBe(true);
  });

  test('Pool with Forgotten Scrolls (dm-169) produces a pool error', () => {
    // Regression: dm-169 prints "Cannot be included with a starting company"
    // but lacked the `no-starting-company` play-flag its siblings (as-130,
    // as-131) carry, so both this pool check and the item-draft refusal
    // silently accepted it.
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Forgotten Scrolls', card: 'dm-169' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'pool' && e.message.includes('may not be included with a starting company'))).toBe(true);
  });

  test('Pool with Lost Tome (dm-172) produces a pool error', () => {
    // Same regression as dm-169 — the flag was missing from the data.
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Lost Tome', card: 'dm-172' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'pool' && e.message.includes('may not be included with a starting company'))).toBe(true);
  });

  test('Pool with an ordinary character has no starting-company error', () => {
    const deck: DeckList = {
      ...baseDeck,
      pool: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.message.includes('may not be included with a starting company'))).toBe(false);
  });
});
