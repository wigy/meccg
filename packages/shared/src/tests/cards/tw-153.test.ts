/**
 * @module tw-153.test
 *
 * Card test: Galadriel (tw-153)
 * Type: hero-character
 * Effects: 2
 *
 * "Unique. When Galadriel is at Lórien, you may keep one more card than
 *  normal in your hand. -3 marshalling points if eliminated."
 *
 * Tests:
 * 1. hand-size-modifier: +1 when self.location is Lórien
 * 2. mp-modifier: -3 when reason is elimination
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, GALADRIEL, LEGOLAS,
  LORIEN, RIVENDELL, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, mint,
  Phase, phaseStateAs,
} from '../test-helpers.js';
import type { EndOfTurnPhaseState, CharacterCard, CardInstance, DrawCardsAction } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { resolveHandSize } from '../../engine/effects/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Galadriel (tw-153)', () => {
  beforeEach(() => resetMint());

  test('hand size is 9 when Galadriel is at Lórien', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [GALADRIEL] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(resolveHandSize(state, 0)).toBe(HAND_SIZE + 1);
    // Player 2 (no Galadriel) stays at base hand size
    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('hand size is 8 when Galadriel is NOT at Lórien', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GALADRIEL] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(resolveHandSize(state, 0)).toBe(HAND_SIZE);
  });

  test('end-of-turn reset-hand draws to 9 when Galadriel is at Lórien', () => {
    // Player 1 has 7 cards and Galadriel at Lórien → hand size 9 → must draw 2
    const dummyCards = Array.from({ length: 7 }, () => ARAGORN);
    const deckCards = Array.from({ length: 10 }, () => LEGOLAS);
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [GALADRIEL] }],
          hand: dummyCards,
          siteDeck: [MORIA],
          playDeck: deckCards,
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: deckCards },
      ],
    });

    // Advance to reset-hand step by setting the phase state directly
    const eotState = phaseStateAs<EndOfTurnPhaseState>(state);
    const resetState: typeof state = {
      ...state,
      phaseState: { ...eotState, step: 'reset-hand' as const, discardDone: [true, true] } as EndOfTurnPhaseState,
    };

    // Player 1 should get a draw-cards action for 2 cards (9 - 7)
    const actions = computeLegalActions(resetState, PLAYER_1);
    const drawEval = actions.find(a => a.action.type === 'draw-cards');
    expect(drawEval).toBeDefined();
    expect((drawEval!.action as DrawCardsAction).count).toBe(2);
  });

  test('-3 marshalling points when Galadriel is in the eliminated pile', () => {
    const rawState = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Recompute derived to get correct baseline MP (Aragorn = 3 character MP)
    const state = recomputeDerived(rawState);
    const baseMp = state.players[0].marshallingPoints.character;
    expect(baseMp).toBe(3);

    // Manually place Galadriel in the eliminated pile
    const galadrielInstId = mint();
    const galadrielInstance: CardInstance = { instanceId: galadrielInstId, definitionId: GALADRIEL };
    const stateWithEliminated = recomputeDerived({
      ...state,
      players: [
        { ...state.players[0], outOfPlayPile: [galadrielInstance] },
        state.players[1],
      ],
    });

    // Galadriel is worth 3 character MP normally, but -3 when eliminated
    const galadrielDef = pool[GALADRIEL as string] as CharacterCard;
    expect(galadrielDef.marshallingPoints).toBe(3);

    // The mp-modifier applies -3 on top of the base character MP (3 - 3 = 0)
    expect(stateWithEliminated.players[0].marshallingPoints.character).toBe(baseMp - 3);
  });
});
