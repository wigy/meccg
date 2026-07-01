/**
 * @module rule-1.33-fw-pool-stage-resources
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.33: Fallen-Wizard Pool Stage Resources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player must include up to three Stage resource permanent-events in their pool, according to the following restrictions:
 * • They must have a combined total of exactly three stage points.
 * • They must include at least one non-unique resource.
 * • They must adhere to any other deck restrictions when considered in conjunction with the play deck and the sideboard (e.g. no more than three copies of each non-unique resource in the entirety of the player's deck).
 * These stage resources may also include resources specific to the player's declared avatar.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// wh-59 = A Merrier World, non-unique Stage resource, 2 stage points
// wh-66 = Double-dealing, non-unique Stage resource, 1 stage point
// wh-61 = A Strident Spawn, unique Stage resource, 4 stage points
// wh-68 = The Fortress of Isen, unique Stage resource, 3 stage points

const baseFwDeck: DeckList = {
  id: 'test-fw-pool-stage-resources',
  name: 'FW Pool Stage Resources Test',
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

describe('Rule 1.33 — Fallen-Wizard Pool Stage Resources', () => {
  test('[FALLEN-WIZARD] two non-unique Stage resources totaling exactly 3 stage points is valid', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      pool: [
        { name: 'A Merrier World', card: 'wh-59' as CardDefinitionId, qty: 1 },
        { name: 'Double-dealing', card: 'wh-66' as CardDefinitionId, qty: 1 },
      ],
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'pool')).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] Stage resources totaling more than 3 points raise a rule-1.33 error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      pool: [{ name: 'A Strident Spawn', card: 'wh-61' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool).filter(e => e.section === 'pool');
    expect(errors.some(e => e.message.includes('rule 1.33') && e.message.includes('4 stage points'))).toBe(true);
  });

  test('[FALLEN-WIZARD] exactly 3 stage points but all unique raises a rule-1.33 error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      pool: [{ name: 'The Fortress of Isen', card: 'wh-68' as CardDefinitionId, qty: 1 }],
    };
    const errors = validateDeck(deck, pool).filter(e => e.section === 'pool');
    expect(errors.some(e => e.message.includes('rule 1.33') && e.message.includes('non-unique'))).toBe(true);
  });

  test('a non-Fallen-wizard deck is unaffected by the Stage-points requirement', () => {
    const heroDeck: DeckList = {
      id: 'test-hero-no-stage',
      name: 'Hero No Stage Resources',
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
    expect(validateDeck(heroDeck, pool).filter(e => e.section === 'pool')).toHaveLength(0);
  });
});
