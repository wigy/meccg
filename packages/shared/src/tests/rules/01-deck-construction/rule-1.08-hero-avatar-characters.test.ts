/**
 * @module rule-1.08-hero-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.08: Hero Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's avatar characters can only be Wizard avatars.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-156 = Gandalf (wizard — valid hero avatar)
// le-50  = Adûnaphel the Ringwraith (ringwraith — invalid as hero avatar)

const heroDeck: DeckList = {
  id: 'test-hero-avatar',
  name: 'Hero Avatar Test',
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

describe('Rule 1.08 — Hero Avatar Characters', () => {
  test('Hero deck with a Wizard avatar has no avatar-alignment error', () => {
    const errors = validateDeck(heroDeck, pool);
    expect(errors.filter(e => e.section === 'characters' && e.card === ('tw-156' as CardDefinitionId))).toHaveLength(0);
  });

  test('Hero deck with a Ringwraith avatar produces a characters error', () => {
    const deck: DeckList = {
      ...heroDeck,
      deck: {
        ...heroDeck.deck,
        characters: [{ name: 'Adûnaphel', card: 'le-50' as CardDefinitionId, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    const avatarErrors = errors.filter(e => e.section === 'characters' && e.card === ('le-50' as CardDefinitionId));
    expect(avatarErrors.length).toBeGreaterThan(0);
    expect(avatarErrors[0].message).toContain('Wizard');
  });
});
