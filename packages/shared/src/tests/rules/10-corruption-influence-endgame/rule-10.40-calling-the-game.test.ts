/**
 * @module rule-10.40-calling-the-game
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.40: Calling the Game
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Calling the Game - The conditions that allow the normal end of the game to be initiated depend on the predetermined length of the game.
 * Starter ("1-deck") Game - If a player currently has at least 20 marshalling points not including cards at Under-deeps sites OR has exhausted their own play deck at least once, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least once, the game ends after the current turn.
 * Short ("2-deck") Game - If a player currently has at least 25 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least once OR has exhausted their own play deck at least twice, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least twice, the game ends after the current turn.
 * Long ("3-deck") Game - If a player currently has at least 30 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least twice OR has exhausted their own play deck at least three times, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least three times, the game ends after the current turn.
 * Campaign ("4-deck") Game - If a player currently has at least 40 marshalling points not including cards at Under-deeps sites and has exhausted their own play deck at least three times OR has exhausted their own play deck at least four times, that player may "call" to end the game at the end of their own turn, in which case their opponent gets one last turn. Otherwise, when each player's play deck has been exhausted at least four times, the game ends after the current turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { EndOfTurnPhaseState } from '../../../index.js';

describe('Rule 10.40 — Calling the Game', () => {
  beforeEach(() => resetMint());

  test('Game end conditions depend on game length: Starter (20 MP or 1 exhaust), Short (25 MP + 1 exhaust or 2), Long (30 MP + 2 or 3), Campaign (40 MP + 3 or 4)', () => {
    const eotSignalEnd: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };

    // Short game (default): 25 MPs + 1 exhaust → may call
    const state25mp1ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 25 }, deckExhaustionCount: 1 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state25mp1 = { ...state25mp1ex, phaseState: eotSignalEnd };
    const canCall25mp1 = viableFor(state25mp1, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall25mp1).toBe(true);

    // Short game: 2 exhausts (regardless of MPs) → may call
    const state0mp2ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 0 }, deckExhaustionCount: 2 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state0mp2 = { ...state0mp2ex, phaseState: eotSignalEnd };
    const canCall0mp2 = viableFor(state0mp2, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall0mp2).toBe(true);

    // Short game: 25 MPs but 0 exhausts → cannot call
    const state25mp0ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 25 }, deckExhaustionCount: 0 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state25mp0 = { ...state25mp0ex, phaseState: eotSignalEnd };
    const canCall25mp0 = viableFor(state25mp0, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall25mp0).toBe(false);

    // Short game: 10 MPs and 1 exhaust → cannot call (need 25 MPs)
    const state10mp1ex = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 10 }, deckExhaustionCount: 1 },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state10mp1 = { ...state10mp1ex, phaseState: eotSignalEnd };
    const canCall10mp1 = viableFor(state10mp1, PLAYER_1).some(a => a.action.type === 'call-free-council');
    expect(canCall10mp1).toBe(false);
  });
});
