/**
 * @module rule-10.44-winner-step1-corruption
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.44: Step 1: Corruption Checks
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 1 (Corruption Checks) - Starting with the player who took the last turn, each player makes a corruption check for each of their non-Ringwraith, non-Balrog characters in the order of that player's choosing. Either player may take resource/character actions if doing so would directly affect one of these corruption checks, including tapping one or more characters in the same company to provide +1 support, or actions that would reduce a character's corruption point total or prevent a character from being discarded. These actions may be taken even if their effect(s) would normally only last until the end of the turn and instead last until the end of the game.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { FreeCouncilPhaseState } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableFor,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  findCharInstanceId,
} from '../../test-helpers.js';

describe('Rule 10.44 — Step 1: Corruption Checks', () => {
  beforeEach(() => resetMint());

  test('Last-turn player (currentPlayer) gets corruption checks; opponent must wait', () => {
    // The last-turn player is PLAYER_1 (activePlayer). In the Free Council,
    // currentPlayer = PLAYER_1, so only PLAYER_1 can declare corruption checks.
    // PLAYER_2 must wait until PLAYER_1 passes.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...base, phaseState: fcState };

    // PLAYER_1 (last-turn player) gets corruption-check actions
    const p1Checks = viableFor(state, PLAYER_1).filter(a => a.action.type === 'corruption-check');
    expect(p1Checks.length).toBeGreaterThan(0);

    // PLAYER_2 does not get corruption-check actions yet
    const p2Checks = viableFor(state, PLAYER_2).filter(a => a.action.type === 'corruption-check');
    expect(p2Checks).toHaveLength(0);
  });

  test('After last-turn player passes, opponent performs corruption checks', () => {
    // Once PLAYER_1 marks their character as checked and passes, the engine
    // switches currentPlayer to PLAYER_2 for their corruption checks.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    // Mark PLAYER_1's character as already checked, then pass
    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [aragornId],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const stateP1Done = { ...base, phaseState: fcState };
    const afterPass = dispatch(stateP1Done, { type: 'pass', player: PLAYER_1 });

    // Now PLAYER_2 gets corruption-check actions
    const p2Checks = viableFor(afterPass, PLAYER_2).filter(a => a.action.type === 'corruption-check');
    expect(p2Checks.length).toBeGreaterThan(0);

    // PLAYER_1 no longer gets corruption-check actions
    const p1Checks = viableFor(afterPass, PLAYER_1).filter(a => a.action.type === 'corruption-check');
    expect(p1Checks).toHaveLength(0);
  });
});
