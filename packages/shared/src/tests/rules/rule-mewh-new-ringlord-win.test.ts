/**
 * MEWH §5 — One Ring victory requires A New Ringlord.
 *
 * Source: The White Hand Insert, "The Victory Conditions": "In order to win by
 * recovering The One Ring at least A New Ringlord card must be played and the
 * conditions outlined on that card must be met."
 *
 * A Fallen-wizard has no generic "bear The One Ring → win" path: the Ringwraith
 * Barad-dûr win is alignment-gated, and the Wizard's Cracks of Doom win card is
 * banned for Fallen-wizards. The only Fallen-wizard One Ring win is the
 * end-of-turn roll granted by A New Ringlord (wh-60). This test asserts the
 * negative gate: a Fallen-wizard bearing The One Ring at an Information Ruins &
 * Lairs *without* A New Ringlord in play does not win and is not eliminated; the
 * positive win path is covered by the wh-60 card test.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA,
  resetMint, buildTestState, attachItemToChar, findCharInstanceId,
  dispatch, Phase, Alignment, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, EndOfTurnPhaseState, GameState } from '../../index.js';

const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;   // wizard avatar, played as Fallen-wizard
const AMON_HEN = 'tw-371' as CardDefinitionId;   // Ruins & Lairs where Information is playable
const RIVENDELL = 'tw-421' as CardDefinitionId;

const SIGNAL_END: EndOfTurnPhaseState = {
  phase: Phase.EndOfTurn,
  step: 'signal-end',
  discardDone: [true, true],
  resetHandDone: [true, true],
};

describe('MEWH §5 — One Ring victory requires A New Ringlord', () => {
  beforeEach(() => resetMint());

  test('a Fallen-wizard bearing The One Ring without A New Ringlord does not win at end of turn', () => {
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
    // Bears The One Ring at an Information R&L, but A New Ringlord is NOT in play.
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, THE_ONE_RING);
    state = { ...state, phaseState: SIGNAL_END };

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    // A roll of 12 would clear the >9 win band if a roll were even made.
    const after = dispatch({ ...state, cheatRollTotal: 12 }, { type: 'pass', player: PLAYER_1 });

    // No win — the gate prevents any One Ring victory without A New Ringlord.
    expect(after.phaseState.phase).not.toBe(Phase.GameOver);
    // And the Fallen-wizard is untouched (no roll happened at all).
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === gandalfId)).toBe(false);
  });
});
