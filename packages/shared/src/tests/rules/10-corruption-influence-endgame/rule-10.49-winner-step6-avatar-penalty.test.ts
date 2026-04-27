/**
 * @module rule-10.49-winner-step6-avatar-penalty
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.49: Step 6: Avatar Elimination Penalty
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 6 (Penalties for Eliminated Avatars) - If a player's avatar was eliminated, the -5 MPs are applied to that player's miscellaneous points after all other modifications (despite having already been in effect for the purposes of determining whether the game could be called).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, GANDALF, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { FreeCouncilPhaseState, GameOverPhaseState, GameState } from '../../../index.js';
import type { CardInstanceId } from '../../../index.js';

describe('Rule 10.49 — Step 6: Avatar Elimination Penalty', () => {
  beforeEach(() => resetMint());

  test('If avatar eliminated, -5 misc MP applied after all other modifications', () => {
    // P1 has Gandalf (wizard avatar) in outOfPlayPile (eliminated).
    // Both players have equal MPs (10 character each) before the penalty.
    // After scoring: P1 should have score (10 - 5 = 5) vs P2 (10).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          marshallingPoints: { character: 10 },
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
          marshallingPoints: { character: 10 },
        },
      ],
    });

    // Inject Gandalf into P1's outOfPlayPile (eliminated wizard avatar)
    const gandalfEliminated = { instanceId: 'gandalf-elim-1' as CardInstanceId, definitionId: GANDALF };
    const stateWithElim = {
      ...base,
      players: [
        { ...base.players[0], outOfPlayPile: [gandalfEliminated] },
        base.players[1],
      ] as typeof base.players,
    };

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    let state: GameState = { ...stateWithElim, phaseState: fcState } as GameState;

    // P1 passes (no characters to check; Gandalf is eliminated)
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // P2 passes → both done → final scoring
    state = dispatch(state, { type: 'pass', player: PLAYER_2 });

    // Game should now be over
    expect(state.phaseState.phase).toBe(Phase.GameOver);
    const gameOver = state.phaseState as unknown as GameOverPhaseState;

    // P1 (eliminated avatar) has -5 penalty applied: 10 - 5 = 5
    // P2 (no eliminated avatar) has no penalty: 10
    const p1Score = gameOver.finalScores[PLAYER_1 as string];
    const p2Score = gameOver.finalScores[PLAYER_2 as string];
    expect(p1Score).toBe(p2Score - 5);
    // P2 wins
    expect(gameOver.winner).toBe(PLAYER_2);
  });
});
