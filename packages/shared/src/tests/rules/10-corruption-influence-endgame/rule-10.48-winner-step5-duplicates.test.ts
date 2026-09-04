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
  RANGERS_OF_THE_NORTH, GIMLI, MORIA,
  addCardInPlay, findCharInstanceId,
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
    // Regression: the -1 was applied to finalScores but never recorded
    // anywhere a player could see why — uniqueCardReveals must list the match
    // so the result screen can explain the deduction.
    expect(gameOver.uniqueCardReveals).toEqual([
      { revealedBy: PLAYER_1, penalizedPlayer: PLAYER_2, cardId: RANGERS_OF_THE_NORTH },
    ]);
  });

  test('Hand card matching opponent unique in-play character reduces opponent final score by 1', () => {
    // P2 has Gimli (unique character) in play. P1 has Gimli in hand — a unique
    // card matching P2's in-play copy. Characters live in `players[].characters`,
    // not `cardsInPlay`, so this exercises the character-scanning path of the
    // duplicate-reveal check separately from the cardsInPlay path above.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, hand: [GIMLI], siteDeck: [], companies: [] },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [{ site: MORIA, characters: [GIMLI] }] },
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
    const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);

    // P1 passes → switches to P2
    const afterP1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // P2 checks Gimli (CP 0, no company mate, no reactive plays → resolves immediately)
    const afterCheck = dispatch(afterP1, {
      type: 'corruption-check',
      player: PLAYER_2,
      characterId: gimliId,
      corruptionPoints: 0,
      corruptionModifier: 0,
      possessions: [],
      need: 1,
      explanation: 'Need roll > 0 (CP 0)',
    });
    const afterP2 = dispatch(afterCheck, { type: 'pass', player: PLAYER_2 });

    const gameOver = afterP2.phaseState as GameOverPhaseState;
    expect(gameOver.phase).toBe(Phase.GameOver);
    // P1's Gimli in hand matches P2's in-play Gimli character → P2 gets -1
    expect(gameOver.finalScores[PLAYER_2]).toBe(-1);
    expect(gameOver.finalScores[PLAYER_1]).toBe(0);
  });

  test('a 0-MP unique match causes NO deduction (both 10.3.v conditions unmet)', () => {
    // Huntsman's Garb (wh-92) is unique but worth 0 MP. Rule 10.3.v allows
    // revealing only hand cards "that would normally give the revealing
    // player marshalling points when played", and only against a unique card
    // "that is giving their opponent at least one marshalling point".
    // Regression: any unique-name match deducted a point — a 0-MP permanent
    // event on both sides flipped games decided by 1 point.
    const HUNTSMANS_GARB = 'wh-92' as import('../../../index.js').CardDefinitionId;
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, hand: [HUNTSMANS_GARB], siteDeck: [], companies: [] },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [] },
      ],
    });
    const withGarb = addCardInPlay(base, HAZARD_PLAYER, HUNTSMANS_GARB);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };
    const state = { ...withGarb, phaseState: fcState };

    const afterP1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterP2 = dispatch(afterP1, { type: 'pass', player: PLAYER_2 });

    const gameOver = afterP2.phaseState as GameOverPhaseState;
    expect(gameOver.phase).toBe(Phase.GameOver);
    // No deduction: the in-play copy gives no MP and the hand copy would
    // give the revealer none.
    expect(gameOver.finalScores[PLAYER_2]).toBe(0);
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
