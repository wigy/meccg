/**
 * @module rule-1.09-hero-non-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.09: Hero Non-Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's non-avatar characters can only be hero characters, but a Wizard player may include agent character cards in their deck. Instead of an agent being a character card for a Wizard player, it is treated as a hazard card for deck-building requirements and in all areas throughout the game.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { pool, HERO_RESOURCES_30, HAZARD_CREATURES_12 } from '../../test-helpers.js';
import {
  buildTestState, resetMint, viablePlayCharacterActions, nonViablePlayCharacterActions, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  RIVENDELL, LORIEN, BREE,
  Alignment,
} from '../../test-helpers.js';
import { validateDeck } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-120 = Aragorn II (hero-character — valid in hero deck)
// le-4   = Calendal (minion-character — invalid in hero deck)

const heroDeck: DeckList = {
  id: 'test-hero-nonavatar',
  name: 'Hero Non-Avatar Test',
  alignment: 'hero',
  pool: [],
  sideboard: [],
  sites: [{ name: 'Moria', card: 'tw-413' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [
      { name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 },
      { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 },
    ],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

// Bill Ferny (dm-3): agent character, homesite "Bree, Cameth Brin", mind 3
const BILL_FERNY = 'dm-3' as CardDefinitionId;

describe('Rule 1.09 — Hero Non-Avatar Characters', () => {
  test('Hero deck with hero-character has no alignment error', () => {
    const errors = validateDeck(heroDeck, pool);
    expect(errors.filter(e => e.section === 'characters' && e.card === ('tw-120' as CardDefinitionId))).toHaveLength(0);
  });

  test('Hero deck with a minion-character produces a characters error', () => {
    const deck: DeckList = {
      ...heroDeck,
      deck: {
        ...heroDeck.deck,
        characters: [
          { name: 'Gandalf', card: 'tw-156' as CardDefinitionId, qty: 1 },
          { name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    const errors = validateDeck(deck, pool);
    const charErrors = errors.filter(e => e.section === 'characters' && e.card === ('le-4' as CardDefinitionId));
    expect(charErrors.length).toBeGreaterThan(0);
    expect(charErrors[0].message).toContain('hero-character');
  });

  describe('Engine enforcement', () => {
    beforeEach(() => resetMint());

    test('[HERO] Wizard player cannot play agent character from hand — agent is treated as a hazard card', () => {
      // Bill Ferny has the "agent" keyword. For a Wizard player, agents are
      // treated as hazard cards in all areas and may not be played as characters
      // (rule 1.09 / rule 1.3.W2). The engine must mark the action as non-viable.
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Organization,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Wizard,
            hand: [BILL_FERNY],
            siteDeck: [RIVENDELL, BREE],
            companies: [],
          },
          { id: PLAYER_2, hand: [], siteDeck: [], companies: [{ site: LORIEN, characters: [LEGOLAS] }] },
        ],
        recompute: true,
      });

      const billFernyInstId = state.players[0].hand.find(c => c.definitionId === BILL_FERNY)?.instanceId;

      // Bill Ferny must appear as a non-viable play-character action
      const nonViable = nonViablePlayCharacterActions(state, PLAYER_1);
      expect(nonViable.some(a => a.characterInstanceId === billFernyInstId)).toBe(true);

      // No viable play-character action exists for Bill Ferny
      const viable = viablePlayCharacterActions(state, PLAYER_1);
      expect(viable.every(a => a.characterInstanceId !== billFernyInstId)).toBe(true);
    });
  });
});
