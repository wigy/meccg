/**
 * @module rule-1.11-minion-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.11: Minion Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player's avatar characters can only be Ringwraith avatars.
 */

import { describe, test, expect } from 'vitest';
import { pool, MINION_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// le-50  = Adûnaphel the Ringwraith (ringwraith — valid minion avatar)
// tw-156 = Gandalf (wizard — invalid as minion avatar)

const minionDeck: DeckList = {
  id: 'test-minion-avatar',
  name: 'Minion Avatar Test',
  alignment: 'minion',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [{ name: 'Adûnaphel', card: 'le-50' as CardDefinitionId, qty: 1 }],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...MINION_RESOURCES_30],
  },
};

describe('Rule 1.11 — Minion Avatar Characters', () => {
  test('Minion deck with a Ringwraith avatar has no avatar-alignment error', () => {
    const errors = validateDeck(minionDeck, pool);
    expect(errors.filter(e => e.section === 'characters' && e.card === ('le-50' as CardDefinitionId))).toHaveLength(0);
  });

  test('Minion deck with a Wizard avatar produces a characters error', () => {
    const deck: DeckList = {
      ...minionDeck,
      deck: {
        ...minionDeck.deck,
        characters: [{ name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 }],
      },
    };
    const errors = validateDeck(deck, pool);
    const avatarErrors = errors.filter(e => e.section === 'characters' && e.card === ('tw-156' as CardDefinitionId));
    expect(avatarErrors.length).toBeGreaterThan(0);
    expect(avatarErrors[0].message).toContain('Ringwraith');
  });
});
