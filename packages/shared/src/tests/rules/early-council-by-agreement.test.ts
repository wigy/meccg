/**
 * @module early-council-by-agreement
 *
 * Agreed early Free Council: a house-rule option letting two humans who play
 * to a fixed time limit end the game with a normal Free Council, rather than
 * one of them conceding. One player proposes, the opponent accepts or
 * declines (the proposer may withdraw), and on acceptance the engine flags a
 * Council call for the active player exactly like a resource-side Sudden
 * Call — the current turn finishes, the other player takes one last turn,
 * and the Free Council scores the game.
 *
 * Like concede, the handshake is a player-facing meta-action layered on by
 * `withMetaActions` (via `computePlayerFacingActions`); the engine's own
 * `computeLegalActions` never lists it, so AI agents and auto-resolution are
 * unaffected. The reducer intercepts it ahead of chain/combat/pending
 * dispatch so the opponent can answer from any sub-state.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  MORIA, LORIEN, ARAGORN, LEGOLAS, MINAS_TIRITH, RIVENDELL,
  ELROND, THRANDUILS_HALLS, WOOD_ELVES,
  resetMint, buildTestState, dispatch, viableEarlyCouncilActionTypes,
  makeDetainmentStrikeState, buildInfluenceAttemptChainState,
  Phase,
} from '../test-helpers.js';
import type { CardDefinitionId, EndOfTurnPhaseState, GameState } from '../../index.js';
import { computeLegalActions, isMetaAction } from '../../index.js';
import { reduce } from '../../engine/reducer.js';

const TEMPERING_FRIENDSHIP = 'tw-337' as CardDefinitionId;

const EOT_SIGNAL_END: EndOfTurnPhaseState = {
  phase: Phase.EndOfTurn,
  step: 'signal-end',
  discardDone: [true, true],
  resetHandDone: [true, true],
};

describe('Early Free Council by agreement', () => {
  let base: GameState;

  beforeEach(() => {
    resetMint();
    base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
  });

  test('both seats may propose when nothing is pending; the engine set never lists it', () => {
    const state = base;
    expect(viableEarlyCouncilActionTypes(state, PLAYER_1)).toEqual(['propose-early-council']);
    expect(viableEarlyCouncilActionTypes(state, PLAYER_2)).toEqual(['propose-early-council']);
    expect(computeLegalActions(state, PLAYER_1).some(a => isMetaAction(a.action.type))).toBe(false);
    expect(computeLegalActions(state, PLAYER_2).some(a => isMetaAction(a.action.type))).toBe(false);
  });

  test('propose records the proposal and offers accept/decline to the opponent, withdraw to the proposer', () => {
    const after = dispatch(base, { type: 'propose-early-council', player: PLAYER_2 });
    expect(after.earlyCouncilProposal).toBe(PLAYER_2);
    expect(after.phaseState.phase).toBe(Phase.Organization);
    expect(viableEarlyCouncilActionTypes(after, PLAYER_1)).toEqual(['accept-early-council', 'decline-early-council']);
    expect(viableEarlyCouncilActionTypes(after, PLAYER_2)).toEqual(['decline-early-council']);
  });

  test('decline and withdraw both clear the proposal', () => {
    const proposed = dispatch(base, { type: 'propose-early-council', player: PLAYER_1 });

    const declined = dispatch(proposed, { type: 'decline-early-council', player: PLAYER_2 });
    expect(declined.earlyCouncilProposal).toBeNull();
    expect(declined.lastTurnFor).toBeNull();
    expect(viableEarlyCouncilActionTypes(declined, PLAYER_1)).toEqual(['propose-early-council']);

    const withdrawn = dispatch(proposed, { type: 'decline-early-council', player: PLAYER_1 });
    expect(withdrawn.earlyCouncilProposal).toBeNull();
    expect(withdrawn.lastTurnFor).toBeNull();
  });

  test('rejects proposing twice and accepting your own proposal', () => {
    const proposed = dispatch(base, { type: 'propose-early-council', player: PLAYER_1 });
    expect(reduce(proposed, { type: 'propose-early-council', player: PLAYER_2 }).error).toBeDefined();
    expect(reduce(proposed, { type: 'accept-early-council', player: PLAYER_1 }).error).toBeDefined();
    expect(reduce(base, { type: 'accept-early-council', player: PLAYER_2 }).error).toBeDefined();
  });

  test('not offered before the first turn, after a Council call, or once the game is over', () => {
    const preGame = { ...base, turnNumber: 0 };
    expect(viableEarlyCouncilActionTypes(preGame, PLAYER_1)).toEqual([]);
    expect(reduce(preGame, { type: 'propose-early-council', player: PLAYER_1 }).error).toBeDefined();

    const called = { ...base, lastTurnFor: PLAYER_2 };
    expect(viableEarlyCouncilActionTypes(called, PLAYER_1)).toEqual([]);
    expect(reduce(called, { type: 'propose-early-council', player: PLAYER_1 }).error).toBeDefined();

    const over = dispatch(base, { type: 'concede', player: PLAYER_1 });
    expect(viableEarlyCouncilActionTypes(over, PLAYER_1)).toEqual([]);
    expect(viableEarlyCouncilActionTypes(over, PLAYER_2)).toEqual([]);
  });

  test('accept lets the current turn finish, gives the other player one last turn, then runs the Free Council', () => {
    const proposed = dispatch(base, { type: 'propose-early-council', player: PLAYER_2 });
    const accepted = dispatch(proposed, { type: 'accept-early-council', player: PLAYER_1 });

    // The current turn continues untouched; only the Council call is flagged.
    expect(accepted.phaseState.phase).toBe(Phase.Organization);
    expect(accepted.activePlayer).toBe(PLAYER_1);
    expect(accepted.turnNumber).toBe(proposed.turnNumber);
    expect(accepted.lastTurnFor).toBe(PLAYER_2);
    expect(accepted.earlyCouncilProposal).toBeNull();
    expect(viableEarlyCouncilActionTypes(accepted, PLAYER_1)).toEqual([]);
    expect(viableEarlyCouncilActionTypes(accepted, PLAYER_2)).toEqual([]);

    // PLAYER_1 ends their turn → PLAYER_2 takes the last turn.
    const p1End = dispatch({ ...accepted, phaseState: EOT_SIGNAL_END }, { type: 'pass', player: PLAYER_1 });
    expect(p1End.activePlayer).toBe(PLAYER_2);
    expect(p1End.turnNumber).toBe(accepted.turnNumber + 1);
    expect(p1End.phaseState.phase).not.toBe(Phase.FreeCouncil);

    // PLAYER_2 ends their last turn → Free Council.
    const p2End = dispatch({ ...p1End, phaseState: EOT_SIGNAL_END }, { type: 'pass', player: PLAYER_2 });
    expect(p2End.phaseState.phase).toBe(Phase.FreeCouncil);
  });

  test('can be proposed and accepted mid-combat without disturbing combat', () => {
    const { state } = makeDetainmentStrikeState({ detainment: false, strikeProwess: 7 });
    expect(state.combat).not.toBeNull();

    const proposed = dispatch(state, { type: 'propose-early-council', player: PLAYER_2 });
    expect(proposed.combat).toEqual(state.combat);
    const accepted = dispatch(proposed, { type: 'accept-early-council', player: PLAYER_1 });
    expect(accepted.combat).toEqual(state.combat);
    expect(accepted.lastTurnFor).not.toBeNull();
    expect(accepted.lastTurnFor).not.toBe(state.activePlayer);
  });

  test('can be proposed and accepted mid-chain without disturbing the chain', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [TEMPERING_FRIENDSHIP, WOOD_ELVES],
      factionDefId: WOOD_ELVES,
    });
    expect(state.chain).not.toBeNull();

    expect(viableEarlyCouncilActionTypes(state, PLAYER_2)).toEqual(['propose-early-council']);
    const proposed = dispatch(state, { type: 'propose-early-council', player: PLAYER_2 });
    const accepted = dispatch(proposed, { type: 'accept-early-council', player: PLAYER_1 });
    expect(accepted.chain).toEqual(state.chain);
    expect(accepted.lastTurnFor).toBe(PLAYER_2);
  });
});
