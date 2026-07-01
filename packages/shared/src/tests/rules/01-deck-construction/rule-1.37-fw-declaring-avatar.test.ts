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
import { Alignment, computeLegalActions } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint,
  viablePlayCharacterActions, nonViableOfType,
  PLAYER_1, PLAYER_2,
  SARUMAN, BILBO, RIVENDELL, MINAS_TIRITH,
  Phase,
} from '../../test-helpers.js';

// wh-9 = Saruman (Fallen-wizard avatar) — shares its name with the Wizard
// avatar tw-181 (SARUMAN), which is the "corresponding Wizard avatar".
const FW_SARUMAN = 'wh-9' as CardDefinitionId;

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

  test.todo('[FALLEN-WIZARD] Must declare a specific Fallen-wizard avatar with at least one copy in the deck');
  test.todo('Opponent Wizard may swap the matching Wizard avatar in their deck/sideboard for a different avatar from outside their deck');
});
