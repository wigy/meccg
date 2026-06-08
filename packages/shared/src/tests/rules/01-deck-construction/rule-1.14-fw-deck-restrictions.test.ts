/**
 * @module rule-1.14-fw-deck-restrictions
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.14: Fallen-Wizard Deck Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player has the following restrictions on the number of cards in their deck (in addition to the general deck restrictions, e.g. no more than one of each unique card or unique resource manifestation, total mind of agent cards, etc.):
 * • No more than three of each non-unique Stage resource card.
 * • No more than two of each non-unique character card.
 * • No more than two of each non-unique hero resource card.
 * • No more than two of each non-unique minion resource card.
 */

import { describe, test, expect } from 'vitest';
import { pool, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-31  = Orc Captain (minion-character, non-unique) — FW character limit test
// tw-243 = Gates of Morning (hero-resource-event, non-unique) — FW hero resource limit test
// le-299 = Black Mace (minion-resource-item, non-unique) — FW minion resource limit test
// wh-75  = Hidden Haven (hero-resource-event, alignment=fallen-wizard, non-unique) — Stage resource (max 3)
// wh-58  = The White Towers (fallen-wizard-site, haven)

const baseFwDeck: DeckList = {
  id: 'test-fw-limits',
  name: 'FW Limits Test',
  alignment: 'fallen-wizard',
  pool: [],
  sideboard: [],
  sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [],
  },
};

describe('Rule 1.14 — Fallen-Wizard Deck Restrictions', () => {
  test('FW deck: non-unique character with 2 copies has no rule-1.14 character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Orc Captain', card: 'le-31' as CardDefinitionId, qty: 2 }],
      },
    };
    const rule14Errors = validateDeck(deck, pool).filter(
      e => e.section === 'characters' && e.card === ('le-31' as CardDefinitionId) && e.message.includes('max 2'),
    );
    expect(rule14Errors).toHaveLength(0);
  });

  test('FW deck: non-unique character with 3 copies produces a rule-1.14 character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Orc Captain', card: 'le-31' as CardDefinitionId, qty: 3 }],
      },
    };
    const errors = validateDeck(deck, pool);
    const rule14Errors = errors.filter(e => e.section === 'characters' && e.card === ('le-31' as CardDefinitionId));
    expect(rule14Errors.length).toBeGreaterThan(0);
    expect(rule14Errors[0].message).toContain('max 2');
    expect(rule14Errors[0].message).toContain('rule 1.14');
  });

  test('FW deck: non-unique hero resource with 2 copies has no rule-1.14 resource error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 2 }],
      },
    };
    const rule14Errors = validateDeck(deck, pool).filter(
      e => e.section === 'resources' && e.card === ('tw-243' as CardDefinitionId) && e.message.includes('max 2'),
    );
    expect(rule14Errors).toHaveLength(0);
  });

  test('FW deck: non-unique hero resource with 3 copies produces a rule-1.14 resource error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [{ name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 3 }],
      },
    };
    const errors = validateDeck(deck, pool);
    const rule14Errors = errors.filter(e => e.section === 'resources' && e.card === ('tw-243' as CardDefinitionId));
    expect(rule14Errors.length).toBeGreaterThan(0);
    expect(rule14Errors[0].message).toContain('max 2');
    expect(rule14Errors[0].message).toContain('rule 1.14');
  });

  test('FW deck: non-unique minion resource with 2 copies has no rule-1.14 resource error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [{ name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 2 }],
      },
    };
    const rule14Errors = validateDeck(deck, pool).filter(
      e => e.section === 'resources' && e.card === ('le-299' as CardDefinitionId) && e.message.includes('max 2'),
    );
    expect(rule14Errors).toHaveLength(0);
  });

  test('FW deck: non-unique minion resource with 3 copies produces a rule-1.14 resource error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [{ name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 3 }],
      },
    };
    const errors = validateDeck(deck, pool);
    const rule14Errors = errors.filter(e => e.section === 'resources' && e.card === ('le-299' as CardDefinitionId));
    expect(rule14Errors.length).toBeGreaterThan(0);
    expect(rule14Errors[0].message).toContain('max 2');
    expect(rule14Errors[0].message).toContain('rule 1.14');
  });

  test('FW Stage resource (alignment=fallen-wizard) with 3 copies has no rule-1.14 error', () => {
    // wh-75 = Hidden Haven: non-unique hero-resource-event with alignment=fallen-wizard
    // Stage resources retain the standard max of 3 (rule 1.04), not the FW max of 2
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [{ name: 'Hidden Haven', card: 'wh-75' as CardDefinitionId, qty: 3 }],
      },
    };
    const rule14Errors = validateDeck(deck, pool).filter(
      e => e.card === ('wh-75' as CardDefinitionId) && e.message.includes('max 2'),
    );
    expect(rule14Errors).toHaveLength(0);
  });
});
