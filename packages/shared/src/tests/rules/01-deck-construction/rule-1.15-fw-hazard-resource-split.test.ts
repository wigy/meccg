/**
 * @module rule-1.15-fw-hazard-resource-split
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.15: Fallen-Wizard Hazard/Resource Split
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] For each hazard that may be played as a resource, a Fallen-wizard player can only count up to two copies as resources for deck requirements, while the third must be counted as a hazard.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-106 = Twilight, a hazard-event carrying the `playable-as-resource` play-flag
const TWILIGHT = 'tw-106' as CardDefinitionId;

const baseFwDeck: DeckList = {
  id: 'test-fw-hazard-resource-split',
  name: 'FW Hazard/Resource Split Test',
  alignment: 'fallen-wizard',
  pool: [],
  sideboard: [],
  sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.15 — Fallen-Wizard Hazard/Resource Split', () => {
  test('[FALLEN-WIZARD] two copies of a dual card counted as resources is fine', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [...baseFwDeck.deck.resources, { name: 'Twilight', card: TWILIGHT, qty: 2 }],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === TWILIGHT)).toBe(false);
  });

  test('[FALLEN-WIZARD] three copies of a dual card counted as resources raises a rule-1.15 error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [...baseFwDeck.deck.resources, { name: 'Twilight', card: TWILIGHT, qty: 3 }],
      },
    };
    const errors = validateDeck(deck, pool).filter(e => e.card === TWILIGHT);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('rule 1.15');
  });

  test('[FALLEN-WIZARD] the third copy is fine once it is counted as a hazard instead', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        hazards: [...baseFwDeck.deck.hazards, { name: 'Twilight', card: TWILIGHT, qty: 1 }],
        resources: [...baseFwDeck.deck.resources, { name: 'Twilight', card: TWILIGHT, qty: 2 }],
      },
    };
    expect(validateDeck(deck, pool).some(e => e.card === TWILIGHT)).toBe(false);
  });

  test('a non-Fallen-wizard alignment is unaffected by the two-copy resource cap', () => {
    const heroDeck: DeckList = {
      id: 'test-hero-dual',
      name: 'Hero Dual Card Test',
      alignment: 'hero',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Rivendell', card: 'tw-421' as CardDefinitionId, qty: 4 }],
      deck: {
        characters: [],
        hazards: [...HAZARD_CREATURES_12],
        resources: [...HERO_RESOURCES_30, { name: 'Twilight', card: TWILIGHT, qty: 3 }],
      },
    };
    expect(validateDeck(heroDeck, pool).some(e => e.card === TWILIGHT)).toBe(false);
  });
});
