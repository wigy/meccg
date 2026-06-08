/**
 * @module rule-1.16-fw-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.16: Fallen-Wizard Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's avatar characters can only be Fallen-wizard avatars.
 */

import { describe, test, expect } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-156 = Gandalf (wizard avatar — invalid in fallen-wizard deck)
// wh-58  = The White Towers (fallen-wizard-site, haven)

const baseFwDeck: DeckList = {
  id: 'test-fw-avatar',
  name: 'FW Avatar Test',
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

describe('Rule 1.16 — Fallen-Wizard Avatar Characters', () => {
  test('FW deck with a Wizard avatar produces a characters error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    const avatarErrors = errors.filter(e => e.section === 'characters' && e.card === ('tw-156' as CardDefinitionId));
    expect(avatarErrors.length).toBeGreaterThan(0);
    expect(avatarErrors[0].message).toContain('fallen-wizard');
  });

  test.todo('[FALLEN-WIZARD] FW deck with a Fallen-wizard avatar produces no error — no FW avatar cards in database yet');
});
