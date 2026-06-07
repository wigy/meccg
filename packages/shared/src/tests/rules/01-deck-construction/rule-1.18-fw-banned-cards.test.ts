/**
 * @module rule-1.18-fw-banned-cards
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.18: Fallen-Wizard Banned Cards
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player cannot include the following cards in their deck:
 * • Bade to Rule
 * • The Balrog (Ally)
 * • Cracks of Doom
 * • Favor of the Valar
 * • Gollum's Fate
 * • Hour of Need
 * • Kill All But Not the Halflings
 * • The Lidless Eye
 * • Glamour of Surpassing Excellence
 * • Messenger of Mordor
 * • News Must Get Through
 * • News of the Shire
 * • Old Road
 * • The Sun Unveiled
 * • Use Your Legs
 * • The Windlord Found Me
 * • Wizard Uncloaked
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-167 = Bade to Rule (minion-resource-event) — banned in FW deck
// tw-243 = Gates of Morning (hero-resource-event) — allowed in FW deck

const baseFwDeck: DeckList = {
  id: 'test-fw-banned',
  name: 'FW Banned Cards Test',
  alignment: 'fallen-wizard',
  pool: [],
  sideboard: [],
  sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.18 — Fallen-Wizard Banned Cards', () => {
  test('Fallen-wizard deck without banned cards has no banned-card error', () => {
    expect(validateDeck(baseFwDeck, pool).filter(e => e.message.includes('rule 1.18'))).toHaveLength(0);
  });

  test('Fallen-wizard deck with Bade to Rule produces an error', () => {
    // le-167 = Bade to Rule — explicitly banned for FW players
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        resources: [
          ...HERO_RESOURCES_30,
          { name: 'Bade to Rule', card: 'le-167' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === ('le-167' as CardDefinitionId))).toBe(true);
  });
});
