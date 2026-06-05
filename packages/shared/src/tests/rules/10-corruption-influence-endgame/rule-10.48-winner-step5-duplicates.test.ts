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
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, ARAGORN,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  CardStatus,
} from '../../test-helpers.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId } from '../../test-helpers.js';
import type { FreeCouncilPhaseState, GameOverPhaseState } from '../../../types/state-phases.js';
import type { GameState } from '../../../types/state.js';

// Gwaihir (tw-251): unique hero-resource-ally, 2 MP — unique=true in card data
const GWAIHIR = 'tw-251' as CardDefinitionId;

describe('Rule 10.48 — Step 5: Revealing Duplicates', () => {
  beforeEach(() => resetMint());

  test('Unique card in hand matching opponent\'s in-play unique reduces opponent MP by 1', () => {
    // Both players have the same character (Aragorn) and the same ally (Gwaihir)
    // in cardsInPlay, so their base scores are symmetric before the penalty.
    // P2 additionally holds a third Gwaihir copy in hand.
    // At Free Council step 5, P2's unplayed matching unique reduces P1's score by 1.
    const gwaihirP1: CardInPlay = {
      instanceId: 'gwaihir-p1' as CardInstanceId,
      definitionId: GWAIHIR,
      status: CardStatus.Untapped,
    };
    const gwaihirP2: CardInPlay = {
      instanceId: 'gwaihir-p2' as CardInstanceId,
      definitionId: GWAIHIR,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [gwaihirP1],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [GWAIHIR],
          siteDeck: [RIVENDELL],
          cardsInPlay: [gwaihirP2],
        },
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

    let state: GameState = { ...base, phaseState: fcState } as GameState;
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect(state.phaseState.phase).toBe(Phase.GameOver);
    const gameOver = state.phaseState as unknown as GameOverPhaseState;

    const p1Score = gameOver.finalScores[PLAYER_1 as string];
    const p2Score = gameOver.finalScores[PLAYER_2 as string];
    // Both start at the same base score (symmetric setup); P2's hand duplicate
    // reduces P1 by 1, so P2 wins by exactly 1 point.
    expect(p1Score).toBe(p2Score - 1);
    expect(gameOver.winner).toBe(PLAYER_2);
  });

  test('No hand duplicate: both players\' scores are equal (tie)', () => {
    // Both players have the same character (Aragorn) and the same ally (Gwaihir)
    // in cardsInPlay — equal base scores. P2 holds no matching card in hand,
    // so the duplicate-reveal step has no effect and the game ends in a tie.
    const gwaihirP1: CardInPlay = {
      instanceId: 'gwaihir-p1' as CardInstanceId,
      definitionId: GWAIHIR,
      status: CardStatus.Untapped,
    };
    const gwaihirP2: CardInPlay = {
      instanceId: 'gwaihir-p2' as CardInstanceId,
      definitionId: GWAIHIR,
      status: CardStatus.Untapped,
    };

    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [gwaihirP1],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
          cardsInPlay: [gwaihirP2],
        },
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

    let state: GameState = { ...base, phaseState: fcState } as GameState;
    state = dispatch(state, { type: 'pass', player: PLAYER_1 });
    state = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect(state.phaseState.phase).toBe(Phase.GameOver);
    const gameOver = state.phaseState as unknown as GameOverPhaseState;

    const p1Score = gameOver.finalScores[PLAYER_1 as string];
    const p2Score = gameOver.finalScores[PLAYER_2 as string];
    // Equal points, no duplicate penalty → tie
    expect(p1Score).toBe(p2Score);
    expect(gameOver.winner).toBeNull();
  });
});
