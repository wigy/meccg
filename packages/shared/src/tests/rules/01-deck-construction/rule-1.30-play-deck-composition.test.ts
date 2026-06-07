/**
 * @module rule-1.30-play-deck-composition
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.30: Play Deck Composition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A play deck may include between 30-50 resources, a number of hazards equal to the number of resources, up to 10 non-avatar characters, and up to three avatars with any combination allowed except for three different avatars.
 * The hazard portion of a play deck must include at least 12 creatures. The following hazards count as half of a creature (rounded down) for the purpose of meeting this 12-creature requirement:
 * • An agent that counts as a hazard
 * • An "Ahunt" or "At Home" Dragon manifestation
 * • A creature that is also playable as an event
 * • A Spawn permanent-event
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

const validDeck: DeckList = {
  id: 'test-deck-composition',
  name: 'Deck Composition Test',
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

describe('Rule 1.30 — Play Deck Composition', () => {
  test('Valid deck (30 resources, 12 creatures, 0 non-avatar characters) has no composition error', () => {
    expect(validateDeck(validDeck, pool).filter(e => ['resources', 'hazards', 'characters'].includes(e.section))).toHaveLength(0);
  });

  test('Fewer than 30 resources produces a resources error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: { ...validDeck.deck, resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 29 }] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'resources' && e.message.includes('min 30'))).toBe(true);
  });

  test('More than 50 resources produces a resources error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: { ...validDeck.deck, resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 51 }] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'resources' && e.message.includes('max 50'))).toBe(true);
  });

  test('Fewer than 12 creatures in hazards produces a hazards error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: { ...validDeck.deck, hazards: [{ name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 11 }] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'hazards' && e.message.includes('min 12'))).toBe(true);
  });

  test('More than 10 non-avatar characters produces a characters error', () => {
    const deck: DeckList = {
      ...validDeck,
      deck: {
        ...validDeck.deck,
        characters: [
          { name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 },
          { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 11 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.section === 'characters' && e.message.includes('max 10'))).toBe(true);
  });
});
