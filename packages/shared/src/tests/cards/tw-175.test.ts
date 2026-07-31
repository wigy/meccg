/**
 * @module tw-175.test
 *
 * Card test: Pallando (tw-175)
 * Type: hero-character (wizard)
 * Effects: 1
 *
 * "Unique. You may keep one more card than normal in your hand.
 *  Opponent must discard his cards face-up."
 *
 * Effect analysis:
 * | # | Effect Type        | Status | Notes                                                     |
 * |---|--------------------|--------|-------------------------------------------------------------|
 * | 1 | hand-size-modifier | OK     | +1 hand size unconditionally while Pallando in play          |
 * | 2 | face-up discard    | OK     | Handled in the player-view projection, not the DSL (see below)|
 *
 * The "opponent must discard face-up" rule (CRF 22: "Can only see the top
 * card of an opponent's discard pile") has no DSL effect — discard piles are
 * otherwise hidden to the opponent (cards are discarded face-down per the CoE
 * glossary). `projectPlayerView` in `@meccg/game-server`'s `projection.ts`
 * special-cases Pallando to reveal just the top card of the opponent's
 * discard pile; see `packages/game-server/src/ws/projection.test.ts` for the
 * projection-level regression tests.
 *
 * Tests:
 * 1. hand size is HAND_SIZE + 1 when Pallando is in play
 * 2. hand size is HAND_SIZE for a player without Pallando
 * 3. end-of-turn reset-hand draws to hand size limit respecting the +1 bonus
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  Phase, phaseStateAs,
} from '../test-helpers.js';
import type { EndOfTurnPhaseState, DrawCardsAction } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { resolveHandSize } from '../../engine/effects/index.js';

const PALLANDO = 'tw-175' as import('../../index.js').CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Pallando (tw-175)', () => {
  beforeEach(() => resetMint());

  test('hand size is HAND_SIZE + 1 while Pallando is in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [PALLANDO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
  });

  test('opponent hand size is unaffected by Pallando', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [PALLANDO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('end-of-turn reset-hand draws to HAND_SIZE + 1 with Pallando in play', () => {
    const dummyCards = Array.from({ length: 7 }, () => ARAGORN);
    const deckCards = Array.from({ length: 10 }, () => LEGOLAS);
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO] }],
          hand: dummyCards,
          siteDeck: [MORIA],
          playDeck: deckCards,
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: deckCards },
      ],
    });

    const eotState = phaseStateAs<EndOfTurnPhaseState>(state);
    const resetState: typeof state = {
      ...state,
      phaseState: { ...eotState, step: 'reset-hand' as const, discardDone: [true, true] } as EndOfTurnPhaseState,
    };

    // Player has 7 cards with Pallando in play → hand size is 9 → must draw 2
    const actions = computeLegalActions(resetState, PLAYER_1);
    const drawEval = actions.find(a => a.action.type === 'draw-cards');
    expect(drawEval).toBeDefined();
    expect((drawEval!.action as DrawCardsAction).count).toBe(2);
  });

  test('end-of-turn reset-hand discards excess when over HAND_SIZE + 1', () => {
    // Player has 10 cards with Pallando → hand size is 9 → must discard 1
    const dummyCards = Array.from({ length: 10 }, () => ARAGORN);
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO] }],
          hand: dummyCards,
          siteDeck: [MORIA],
          playDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: [] },
      ],
    });

    const eotState = phaseStateAs<EndOfTurnPhaseState>(state);
    const resetState: typeof state = {
      ...state,
      phaseState: { ...eotState, step: 'reset-hand' as const, discardDone: [true, true] } as EndOfTurnPhaseState,
    };

    // Must discard 1 card (10 - 9 = 1)
    const actions = computeLegalActions(resetState, PLAYER_1);
    const discardActions = actions.filter(a => a.action.type === 'discard-card');
    expect(discardActions.length).toBe(10); // one action per card in hand
    expect(discardActions.every(a => a.viable)).toBe(true);
  });
});
