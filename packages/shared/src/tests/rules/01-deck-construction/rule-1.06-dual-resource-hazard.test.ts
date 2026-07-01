/**
 * @module rule-1.06-dual-resource-hazard
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.06: Dual Resource/Hazard Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A card that may be played as a resource or hazard may be considered either for the purpose of deck construction.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12, MINION_RESOURCES_30 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-106 = Twilight, a hazard-event carrying the `playable-as-resource` play-flag
const TWILIGHT = 'tw-106' as CardDefinitionId;

const baseHeroDeck: DeckList = {
  id: 'test-dual-hero',
  name: 'Dual Card Test (Hero)',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Rivendell', card: 'tw-421' as CardDefinitionId, qty: 4 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

const baseMinionDeck: DeckList = {
  id: 'test-dual-minion',
  name: 'Dual Card Test (Minion)',
  alignment: 'minion',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Minas Morgul', card: 'le-390' as CardDefinitionId, qty: 4 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...MINION_RESOURCES_30],
  },
};

describe('Rule 1.06 — Dual Resource/Hazard Cards', () => {
  test('a hazard card playable as resource may be included in the hero resources section', () => {
    const deck: DeckList = {
      ...baseHeroDeck,
      deck: {
        ...baseHeroDeck.deck,
        resources: [...baseHeroDeck.deck.resources, { name: 'Twilight', card: TWILIGHT, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'resources')).toHaveLength(0);
  });

  test('a hazard card playable as resource may be included in the minion resources section', () => {
    const deck: DeckList = {
      ...baseMinionDeck,
      deck: {
        ...baseMinionDeck.deck,
        resources: [...baseMinionDeck.deck.resources, { name: 'Twilight', card: TWILIGHT, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'resources')).toHaveLength(0);
  });

  test('the same card is also valid left in the hazards section', () => {
    const deck: DeckList = {
      ...baseHeroDeck,
      deck: {
        ...baseHeroDeck.deck,
        hazards: [...baseHeroDeck.deck.hazards, { name: 'Twilight', card: TWILIGHT, qty: 1 }],
      },
    };
    // Leaving it as a hazard raises no error naming the card itself (a separate
    // rule-1.30 hazard/resource-count-mismatch error is expected from padding
    // the fixture's hazards without matching resources, and is not this rule's
    // concern).
    expect(validateDeck(deck, pool).some(e => e.card === TWILIGHT)).toBe(false);
  });

  test('a hazard card without the playable-as-resource flag is rejected from the resources section', () => {
    // tw-020 = Cave-drake, an ordinary hazard-creature with no dual play-flag.
    const deck: DeckList = {
      ...baseHeroDeck,
      deck: {
        ...baseHeroDeck.deck,
        resources: [...baseHeroDeck.deck.resources, { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'resources' && e.card === ('tw-020' as CardDefinitionId))).toBe(true);
  });
});
