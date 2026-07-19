/**
 * @module rule-1.17-fw-non-avatar-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.17: Fallen-Wizard Non-Avatar Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's non-avatar characters may include either hero or minion characters, with agent character cards counting as characters for deck-building requirements.
 * [FALLEN-WIZARD] A Fallen-wizard player's non-Orc, non-Troll characters are treated as hero characters.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, HERO_RESOURCES_30, HAZARD_CREATURES_12,
  buildTestState, resetMint, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  GLAMDRING,
} from '../../test-helpers.js';
import { validateDeck, Alignment, Phase } from '../../../index.js';
import type { DeckList, CardDefinitionId } from '../../../index.js';

// tw-120 = Aragorn II (hero-character) — valid in FW deck
// le-4   = Calendal (minion-character) — also valid in FW deck
// wh-9   = Saruman (Fallen-wizard avatar) — the declared avatar rule 1.37 requires

const baseFwDeck: DeckList = {
  id: 'test-fw-characters',
  name: 'FW Characters Test',
  alignment: 'fallen-wizard',
  pool: [{ name: 'Saruman', card: 'wh-9' as CardDefinitionId, qty: 1 }],
  sideboard: [],
  sites: [{ name: 'The White Towers', card: 'wh-58' as CardDefinitionId, qty: 1 }],
  deck: {
    characters: [],
    hazards: [...HAZARD_CREATURES_12],
    resources: [...HERO_RESOURCES_30],
  },
};

describe('Rule 1.17 — Fallen-Wizard Non-Avatar Characters', () => {
  beforeEach(() => resetMint());

  test('FW deck with a hero character has no character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('FW deck with a minion character has no character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('FW deck with both hero and minion characters has no character error', () => {
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [
          { name: 'Aragorn II', card: 'tw-120' as CardDefinitionId, qty: 1 },
          { name: 'Calendal', card: 'le-4' as CardDefinitionId, qty: 1 },
        ],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters')).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] Agent character in deck characters section produces no alignment error', () => {
    // dm-3 = Bill Ferny (minion-character, agent, unique) — agents are character cards
    // for deck-building in FW decks (unlike hero decks where they count as hazards)
    const deck: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Bill Ferny', card: 'dm-3' as CardDefinitionId, qty: 1 }],
      },
    };
    expect(validateDeck(deck, pool).filter(e => e.section === 'characters' && e.card === ('dm-3' as CardDefinitionId))).toHaveLength(0);
  });

  test('[FALLEN-WIZARD] a non-Orc, non-Troll character in play still receives hero-item bonuses', () => {
    // MEWH §9 strips a hero item's DSL effects (and structural stat bonuses)
    // from an Orc/Troll bearer, but that filter is keyed on the bearer's
    // race, not the controlling player's alignment. Aragorn II (tw-120,
    // race "dunadan") in a Fallen-wizard company is therefore treated as a
    // hero character: Glamdring's +3 prowess (capped at 8) still applies.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: 'wh-58' as CardDefinitionId, characters: [{ defId: 'tw-120' as CardDefinitionId, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, 'tw-120' as CardDefinitionId);
    const aragorn = state.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.effectiveStats.prowess).toBe(8);
  });
});
