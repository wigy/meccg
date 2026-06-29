/**
 * @module rule-10.48-winner-step5-duplicates
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.48: Step 5: Revealing Duplicates
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 5 (Revealing Duplicates) - Each player may reveal any cards in their hand that would normally give the revealing player marshalling points when played if the card(s) match a unique card or manifestation of a card (regardless of alignment) that is giving their opponent at least one marshalling point. For each matching card revealed in this way, the opponent's marshalling point total is reduced by one point.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { FreeCouncilPhaseState, GameOverPhaseState } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  RANGERS_OF_THE_NORTH,
  addCardInPlay,
} from '../../test-helpers.js';

describe('Rule 10.48 — Step 5: Revealing Duplicates', () => {
  beforeEach(() => resetMint());

  test('Hand card matching opponent unique in-play card reduces opponent final score by 1', () => {
    // P2 has Rangers of the North (unique, 3 MPs) in cardsInPlay.
    // P1 has Rangers of the North in hand — a unique card matching P2's
    // in-play copy. Per rule 10.48, P2's final score is reduced by 1.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, hand: [RANGERS_OF_THE_NORTH], siteDeck: [], companies: [] },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [] },
      ],
    });

    const withRangers = addCardInPlay(base, HAZARD_PLAYER, RANGERS_OF_THE_NORTH);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...withRangers, phaseState: fcState };

    // P1 passes (no characters to check) → switches to P2
    const afterP1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // P2 passes → game ends, duplicate reveal applied
    const afterP2 = dispatch(afterP1, { type: 'pass', player: PLAYER_2 });

    const gameOver = afterP2.phaseState as GameOverPhaseState;
    expect(gameOver.phase).toBe(Phase.GameOver);
    // P1's Rangers in hand matches P2's Rangers in play → P2 gets -1
    expect(gameOver.finalScores[PLAYER_2]).toBe(-1);
    // P1 has no match in P2's hand → no reduction
    expect(gameOver.finalScores[PLAYER_1]).toBe(0);
  });

  test('No matching hand cards: opponent final score unaffected', () => {
    // P2 has Rangers of the North in cardsInPlay, but P1 holds no matching
    // unique card. No duplicate penalty is applied to either player's score.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, hand: [], siteDeck: [], companies: [] },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [] },
      ],
    });

    const withRangers = addCardInPlay(base, HAZARD_PLAYER, RANGERS_OF_THE_NORTH);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...withRangers, phaseState: fcState };

    const afterP1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterP2 = dispatch(afterP1, { type: 'pass', player: PLAYER_2 });

    const gameOver = afterP2.phaseState as GameOverPhaseState;
    expect(gameOver.phase).toBe(Phase.GameOver);
    // No duplicate hand cards → no score penalty for either player
    expect(gameOver.finalScores[PLAYER_2]).toBe(0);
    expect(gameOver.finalScores[PLAYER_1]).toBe(0);
  });
});
