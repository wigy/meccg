/**
 * @module wh-60.test
 *
 * Card test: A New Ringlord (wh-60)
 * Type: hero-resource-event (permanent, fallen-wizard alignment)
 * Effects:
 *   1. play-condition: site-type haven — played on the Fallen-wizard at one of
 *      your Wizardhavens
 *   2. play-target: character (the avatar) bearing The One Ring
 *   3. on-event: owner-end-of-turn → win-condition-roll — during each of the
 *      controller's end-of-turn phases, if the Fallen-wizard bears The One
 *      Ring at a Ruins & Lairs where Information is playable, roll 2d6 (+1 per
 *      A New Ringlord in play): <6 eliminates the Fallen-wizard; >9 wins the
 *      game (CoE rule 10.39).
 *
 * Card text: "Playable on your Fallen-wizard if he has The One Ring at one of
 * your Wizardhavens. ... Make a roll during each of your end-of-turn phases if
 * your Fallen-wizard is bearing The One Ring and is at a Ruins & Lairs where
 * Information is playable. Add 1 for each A New Ringlord you have in play. If
 * the result is less than 6, your Fallen-wizard is eliminated. If the result
 * is greater than 9, you win the game."
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA,
  resetMint, buildTestState, attachItemToChar, attachHazardToChar, findCharInstanceId,
  dispatch, expectCharNotInPlay,
  Phase, Alignment, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, EndOfTurnPhaseState, GameOverPhaseState, GameState } from '../../index.js';

const A_NEW_RINGLORD = 'wh-60' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId; // wizard avatar, played as Fallen-wizard
const AMON_HEN = 'tw-371' as CardDefinitionId; // Ruins & Lairs where Information is playable
const RIVENDELL = 'tw-421' as CardDefinitionId;

const SIGNAL_END: EndOfTurnPhaseState = {
  phase: Phase.EndOfTurn,
  step: 'signal-end',
  discardDone: [true, true],
  resetHandDone: [true, true],
};

/**
 * Build an end-of-turn signal-end state with the Fallen-wizard (Gandalf) at
 * Amon Hen bearing The One Ring and A New Ringlord, ready for the end-of-turn
 * scan on `pass`.
 */
function ringlordEndOfTurnState(): GameState {
  let state: GameState = buildTestState({
    phase: Phase.EndOfTurn,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: AMON_HEN, characters: [GANDALF] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: ['tw-120' as CardDefinitionId] }],
        hand: [],
        siteDeck: [MORIA],
      },
    ],
  });
  state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, THE_ONE_RING);
  state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, A_NEW_RINGLORD);
  return { ...state, phaseState: SIGNAL_END };
}

describe('A New Ringlord (wh-60)', () => {
  beforeEach(() => resetMint());

  test('end-of-turn roll > 9 wins the game', () => {
    const state = ringlordEndOfTurnState();
    // +1 for the one copy in play; cheat 12 → total 13 > 9 → win.
    const after = dispatch({ ...state, cheatRollTotal: 12 }, { type: 'pass', player: PLAYER_1 });

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.alignment).toBe(Alignment.FallenWizard);
      expect(go.winReason.card).toBe(A_NEW_RINGLORD);
    }
  });

  test('end-of-turn roll < 6 eliminates the Fallen-wizard (no win)', () => {
    const state = ringlordEndOfTurnState();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    // +1 for the copy in play; cheat 2 → total 3 < 6 → eliminate.
    const after = dispatch({ ...state, cheatRollTotal: 2 }, { type: 'pass', player: PLAYER_1 });

    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    expectCharNotInPlay(after, RESOURCE_PLAYER, gandalfId);
    // Eliminated (out-of-play), not merely discarded.
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gandalfId)).toBe(true);
  });

  test('elimination disperses the avatar\'s attached hazards and followers', () => {
    // Regression: the win-condition eliminateAvatar discarded only the
    // avatar's items and allies — attached hazards (opponent's corruption
    // cards in char.hazards) and followers were silently deleted with the
    // character record. Hazards must go to the hazard owner's discard pile
    // and followers must be freed to general influence, exactly as the
    // canonical eliminateCharacter machinery does.
    const LURE_OF_THE_SENSES = 'tw-60' as CardDefinitionId; // hazard corruption
    const BILBO = 'tw-131' as CardDefinitionId;
    let state: GameState = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: AMON_HEN, characters: [GANDALF, { defId: BILBO, followerOf: 0 }] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: ['tw-120' as CardDefinitionId] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, THE_ONE_RING);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, A_NEW_RINGLORD);
    state = attachHazardToChar(state, RESOURCE_PLAYER, GANDALF, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    state = { ...state, phaseState: SIGNAL_END };

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const lureInstId = state.players[RESOURCE_PLAYER].characters[gandalfId].hazards[0].instanceId;

    const after = dispatch({ ...state, cheatRollTotal: 2 }, { type: 'pass', player: PLAYER_1 });

    // Avatar eliminated as before.
    expectCharNotInPlay(after, RESOURCE_PLAYER, gandalfId);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gandalfId)).toBe(true);

    // The attached corruption card lands in its owner's (the hazard player's)
    // discard pile, exactly once — not deleted with the character record.
    expect(after.players[HAZARD_PLAYER].discardPile.filter(c => c.instanceId === lureInstId)).toHaveLength(1);

    // The follower survives, freed to general influence.
    const bilbo = after.players[RESOURCE_PLAYER].characters[bilboId];
    expect(bilbo).toBeDefined();
    expect(bilbo.controlledBy).toBe('general');
  });

  test('mid-range roll (6–9) neither wins nor eliminates', () => {
    const state = ringlordEndOfTurnState();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    // +1 for the copy; cheat 7 → total 8 → no band matches → nothing happens.
    const after = dispatch({ ...state, cheatRollTotal: 7 }, { type: 'pass', player: PLAYER_1 });

    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    expect(after.players[RESOURCE_PLAYER].characters[gandalfId]).toBeDefined();
  });

  test('no roll when the Fallen-wizard is not bearing The One Ring', () => {
    let state: GameState = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: AMON_HEN, characters: [GANDALF] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: ['tw-120' as CardDefinitionId] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });
    // A New Ringlord attached, but no One Ring → gate fails, no roll.
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, A_NEW_RINGLORD);
    state = { ...state, phaseState: SIGNAL_END };

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const after = dispatch({ ...state, cheatRollTotal: 2 }, { type: 'pass', player: PLAYER_1 });

    // No elimination (the gate prevented the roll); turn proceeds normally.
    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    // Gandalf is still in play somewhere (the turn advanced, not eliminated).
    const stillInPlay = after.players[RESOURCE_PLAYER].characters[gandalfId]
      ?? after.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === gandalfId);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gandalfId)).toBe(false);
    expect(stillInPlay).toBeDefined();
  });
});
