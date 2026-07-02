/**
 * @module rule-1.37-fw-declaring-avatar
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.37: Fallen-Wizard Declaring Avatar
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] If a player declares that they are a Fallen-wizard at the start of the game, they must also declare which specific Fallen-wizard avatar they are playing, at least one copy of which must be in that player's deck. If their opponent is a Wizard player, their opponent may then switch any Wizard versions of that avatar in their play deck or sideboard with a different Wizard avatar from outside of their deck. Wizard players cannot play the corresponding Wizard avatar of a Fallen-wizard avatar that has been declared by their opponent.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, computeLegalActions, validateDeck } from '../../../index.js';
import type { CardDefinitionId, DeckList } from '../../../index.js';
import {
  buildTestState, resetMint, pool, HERO_RESOURCES_30, HAZARD_CREATURES_12,
  viablePlayCharacterActions, nonViableOfType,
  PLAYER_1, PLAYER_2,
  SARUMAN, BILBO, RIVENDELL, MINAS_TIRITH,
  Phase,
} from '../../test-helpers.js';

// wh-9 = Saruman (Fallen-wizard avatar) — shares its name with the Wizard
// avatar tw-181 (SARUMAN), which is the "corresponding Wizard avatar".
const FW_SARUMAN = 'wh-9' as CardDefinitionId;
const FW_GANDALF = 'wh-4' as CardDefinitionId;

describe('Rule 1.37 — Fallen-Wizard Declaring Avatar', () => {
  beforeEach(() => resetMint());

  test('a Wizard player may play the matching avatar when the opponent has not declared it', () => {
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [SARUMAN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const viable = viablePlayCharacterActions(state, PLAYER_2);
    const sarumanId = state.players[1].hand.find(c => c.definitionId === SARUMAN)!.instanceId;
    expect(viable.some(a => a.characterInstanceId === sarumanId)).toBe(true);
  });

  test('a Wizard player cannot play the Wizard avatar corresponding to the opponent\'s declared Fallen-wizard avatar', () => {
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [], hand: [FW_SARUMAN], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [SARUMAN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sarumanId = state.players[1].hand.find(c => c.definitionId === SARUMAN)!.instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_2);
    expect(viable.some(a => a.characterInstanceId === sarumanId)).toBe(false);

    // Rewritten to an explicit not-playable entry naming the opponent's declaration.
    const actions = computeLegalActions(state, PLAYER_2);
    const notPlayable = nonViableOfType(actions, 'not-playable')
      .find(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === sarumanId);
    expect(notPlayable?.reason).toMatch(/Fallen-wizard/);
  });

  test('[FALLEN-WIZARD] the deck must include at least one copy of a single declared Fallen-wizard avatar', () => {
    const baseFwDeck: DeckList = {
      id: 'test-fw-declaring-avatar',
      name: 'FW Declaring Avatar Test',
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

    // No Fallen-wizard avatar anywhere in the deck → rule 1.37 error.
    const missing = validateDeck(baseFwDeck, pool)
      .filter(e => e.message.includes('rule 1.37'));
    expect(missing.some(e => e.message.includes('at least one copy'))).toBe(true);

    // One declared avatar (Saruman wh-9) → no rule 1.37 error.
    const declared: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [{ name: 'Saruman', card: FW_SARUMAN, qty: 1 }],
      },
    };
    expect(validateDeck(declared, pool).filter(e => e.message.includes('rule 1.37'))).toHaveLength(0);

    // Two distinct Fallen-wizard avatars → not a single specific declaration.
    const twoAvatars: DeckList = {
      ...baseFwDeck,
      deck: {
        ...baseFwDeck.deck,
        characters: [
          { name: 'Saruman', card: FW_SARUMAN, qty: 1 },
          { name: 'Gandalf', card: FW_GANDALF, qty: 1 },
        ],
      },
    };
    const conflicting = validateDeck(twoAvatars, pool)
      .filter(e => e.message.includes('rule 1.37'));
    expect(conflicting.some(e => e.message.includes('single specific'))).toBe(true);
  });

  // The swap itself ("with a different Wizard avatar from outside of their
  // deck") has no representation: there is no pre-game deck-modification
  // setup step, and cards from outside the registered deck list cannot be
  // introduced. Needs a whole new setup interaction.
  test.todo('Opponent Wizard may swap the matching Wizard avatar in their deck/sideboard for a different avatar from outside their deck');
});
