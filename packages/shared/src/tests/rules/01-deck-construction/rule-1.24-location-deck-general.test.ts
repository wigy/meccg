/**
 * @module rule-1.24-location-deck-general
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.24: Location Deck - General
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A location deck may include any number of haven sites and one of each non-haven site (but no region cards, which are generally replaced with a map for tournament play).
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-413 = Moria (hero-site, non-haven)
// tw-421 = Rivendell (hero-site, haven)

const heroDeck: DeckList = {
  id: 'test-location-deck',
  name: 'Location Deck Test',
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

describe('Rule 1.24 — Location Deck - General', () => {
  test('Single copy of a non-haven site produces no error', () => {
    expect(validateDeck(heroDeck, pool).filter(e => e.section === 'sites')).toHaveLength(0);
  });

  test('Non-haven site with qty > 1 produces a sites error', () => {
    const deck: DeckList = {
      ...heroDeck,
      sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 2 }],
    };
    const errors = validateDeck(deck, pool);
    const siteErrors = errors.filter(e => e.section === 'sites' && e.card === ('tw-413' as CardDefinitionId));
    expect(siteErrors.length).toBeGreaterThan(0);
    expect(siteErrors[0].message).toMatch(/max is 1|more than once/);
  });

  test('Multiple copies of a haven site are allowed (no error)', () => {
    const deck: DeckList = {
      ...heroDeck,
      sites: [
        { name: 'Rivendell', card: 'tw-421' as CardDefinitionId, qty: 4 },
        { name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 },
      ],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'sites' && e.card === ('tw-421' as CardDefinitionId))).toHaveLength(0);
  });

  test('Non-site card in the location deck produces a sites error', () => {
    const deck: DeckList = {
      ...heroDeck,
      sites: [
        { name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 },
        { name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 },
      ],
    };
    const siteErrors = validateDeck(deck, pool).filter(
      e => e.section === 'sites' && e.card === ('tw-156' as CardDefinitionId),
    );
    expect(siteErrors.length).toBeGreaterThan(0);
    expect(siteErrors[0].message).toMatch(/only sites are allowed/);
  });

  test('Site card in the resources section produces a resources error', () => {
    const deck: DeckList = {
      ...heroDeck,
      deck: {
        ...heroDeck.deck,
        resources: [
          ...heroDeck.deck.resources,
          { name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool).filter(
      e => e.section === 'resources' && e.card === ('tw-413' as CardDefinitionId),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/only appear in the location deck/);
  });

  test('Site card in the sideboard produces a sideboard error', () => {
    const deck: DeckList = {
      ...heroDeck,
      sideboard: [{ name: 'Rivendell', card: 'tw-421' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool).filter(
      e => e.section === 'sideboard' && e.card === ('tw-421' as CardDefinitionId),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/only appear in the location deck/);
  });
});
