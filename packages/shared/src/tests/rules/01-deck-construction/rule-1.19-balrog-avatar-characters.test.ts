/**
 * @module rule-1.19-balrog-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.19: Balrog Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player's avatar characters can only be Balrog avatars.
 */

import { describe, test, expect } from 'vitest';
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-50  = Adûnaphel the Ringwraith (ringwraith avatar — invalid in balrog deck)
// le-373 = Ettenmoors (minion-site)

const baseBalrogDeck: DeckList = {
  id: 'test-balrog-avatar',
  name: 'Balrog Avatar Test',
  alignment: 'balrog',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...MINION_RESOURCES_30],
  },
};

describe('Rule 1.19 — Balrog Avatar Characters', () => {
  test('Balrog deck with a Ringwraith avatar produces a characters error', () => {
    const deck: DeckList = {
      ...baseBalrogDeck,
      deck: {
        ...baseBalrogDeck.deck,
        characters: [{ name: 'Adûnaphel', card: 'le-50' as CardDefinitionId, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    const avatarErrors = errors.filter(e => e.section === 'characters' && e.card === ('le-50' as CardDefinitionId));
    expect(avatarErrors.length).toBeGreaterThan(0);
    expect(avatarErrors[0].message).toContain('balrog');
  });

  test.todo('[BALROG] Balrog deck with a Balrog avatar produces no error — no Balrog avatar cards in database yet');
});
