/**
 * @module rule-1.26-hero-location-deck
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.26: Hero Location Deck
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's location deck can only include hero site cards (and the designated Balrog site cards).
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-413 = Moria (hero-site — valid in hero deck)
// le-373 = Ettenmoors (minion-site — invalid in hero deck)

const heroDeck: DeckList = {
  id: 'test-hero-sites',
  name: 'Hero Location Deck Test',
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

describe('Rule 1.26 — Hero Location Deck', () => {
  test('Hero deck with only hero-sites has no site alignment error', () => {
    expect(validateDeck(heroDeck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('Hero deck with a minion-site produces a sites error', () => {
    const deck: DeckList = {
      ...heroDeck,
      sites: [
        { name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 },
        { name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 },
      ],
    };
    const errors = validateDeck(deck, pool);
    const siteErrors = errors.filter(e => e.section === 'sites' && e.card === ('le-373' as CardDefinitionId));
    expect(siteErrors.length).toBeGreaterThan(0);
    expect(siteErrors[0].message).toContain('hero-site');
  });
});
