/**
 * @module rule-10.41-minion-balrog-sudden-call
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.41: Minion/Balrog Sudden Call
 *
 * Source: docs/coe-rules.md
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player cannot freely call to end the game; instead,
 * a Ringwraith player may play Sudden Call, which may be played either as
 * a resource on a player's own turn if that player has met the normal
 * game-length conditions for calling the end of the game (after which
 * their opponent gets one last turn), or as a hazard during an opponent's
 * turn if that opponent has met the normal game-length conditions for
 * calling the end of the game (after which the player who played Sudden
 * Call gets one last turn).
 *
 * [BALROG] Identical rule for Balrog players.
 */

import { describe, test, expect } from 'vitest';
import { Alignment, Phase, computeLegalActions } from '../../../index.js';
import type { EndOfTurnPhaseState } from '../../../index.js';
import {
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../../index.js';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  buildTestState,
} from '../../test-helpers.js';

function signalEndState(alignment: Alignment) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.EndOfTurn,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [MORIA],
        alignment,
        // Raw MP 25 + 1 exhaust → eligible to call under Short-game rules (rule 10.40)
        marshallingPoints: { character: 15, item: 10 },
        deckExhaustionCount: 1,
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  // buildTestState enters EoT at step 'discard'; jump to 'signal-end' directly.
  const phaseState: EndOfTurnPhaseState = {
    phase: Phase.EndOfTurn,
    step: 'signal-end',
    discardDone: [true, true],
    resetHandDone: [true, true],
  } as EndOfTurnPhaseState;
  return { ...base, phaseState };
}

describe('Rule 10.41 — Minion/Balrog Sudden Call', () => {
  test('Wizard player at threshold IS offered call-free-council (regression)', () => {
    const state = signalEndState(Alignment.Wizard);
    const actionTypes = computeLegalActions(state, PLAYER_1).map(ea => ea.action.type);
    expect(actionTypes).toContain('call-free-council');
  });

  test('[MINION] Ringwraith player at threshold is NOT offered call-free-council', () => {
    const state = signalEndState(Alignment.Ringwraith);
    const actionTypes = computeLegalActions(state, PLAYER_1).map(ea => ea.action.type);
    expect(actionTypes).not.toContain('call-free-council');
    // Pass is still available (player can still end their turn normally).
    expect(actionTypes).toContain('pass');
  });

  test('[BALROG] Balrog player at threshold is NOT offered call-free-council', () => {
    const state = signalEndState(Alignment.Balrog);
    const actionTypes = computeLegalActions(state, PLAYER_1).map(ea => ea.action.type);
    expect(actionTypes).not.toContain('call-free-council');
    expect(actionTypes).toContain('pass');
  });

  test('Fallen-wizard player at threshold IS offered call-free-council (only Minion/Balrog are gated)', () => {
    const state = signalEndState(Alignment.FallenWizard);
    const actionTypes = computeLegalActions(state, PLAYER_1).map(ea => ea.action.type);
    expect(actionTypes).toContain('call-free-council');
  });

  // Sanity: PLAYER_1 is the resource player in the convention used above.
  test('resource player index is player 0', () => {
    expect(RESOURCE_PLAYER).toBe(0);
  });
});
