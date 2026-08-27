/**
 * @module concede
 *
 * Concede: a player may end the match immediately, handing the win to their
 * opponent, without waiting to reach the Free Council or exhausting other
 * ways out of a game they no longer want to play.
 *
 * Concede is the one action offered unconditionally in every phase and
 * sub-state — including mid-chain and mid-combat, which normally restrict
 * legal actions to a narrow resolution-specific set (see
 * `computeLegalActions` in `engine/legal-actions/index.ts`). The reducer
 * mirrors this: `reduce()` intercepts `concede` before any chain/combat/
 * pending dispatch (`engine/reducer.ts`), so it always reaches
 * `endGame()` regardless of what else is mid-resolution.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  MORIA, LORIEN, ARAGORN, LEGOLAS, MINAS_TIRITH, RIVENDELL,
  ELROND, THRANDUILS_HALLS, WOOD_ELVES,
  resetMint, buildTestState, dispatch, viableActionTypes,
  makeDetainmentStrikeState, buildInfluenceAttemptChainState,
  Phase,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const TEMPERING_FRIENDSHIP = 'tw-337' as CardDefinitionId;

describe('Concede', () => {
  beforeEach(() => resetMint());

  test('is legal for both players in an ordinary phase (organization)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    expect(viableActionTypes(state, PLAYER_1)).toContain('concede');
    expect(viableActionTypes(state, PLAYER_2)).toContain('concede');
  });

  test('ends the game with the opponent as forced winner and winReason concession', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const after = dispatch(state, { type: 'concede', player: PLAYER_1 });

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    if (after.phaseState.phase !== Phase.GameOver) throw new Error('unreachable');
    expect(after.phaseState.winner).toBe(PLAYER_2);
    expect(after.phaseState.winReason).toEqual({ kind: 'concession', concededBy: PLAYER_1 });
    // Final scores are still computed for the result screen even though the
    // outcome was forced, same as a One Ring win.
    expect(after.phaseState.finalScores[PLAYER_1]).toBeDefined();
    expect(after.phaseState.finalScores[PLAYER_2]).toBeDefined();

    // Once the game is over, concede is no longer offered to either player —
    // 'finished' (the result-screen acknowledgement) is the only action left.
    expect(viableActionTypes(after, PLAYER_1)).not.toContain('concede');
    expect(viableActionTypes(after, PLAYER_2)).not.toContain('concede');
    expect(viableActionTypes(after, PLAYER_1)).toContain('finished');
  });

  test('remains legal mid-combat and bypasses the active strike resolution', () => {
    const { state } = makeDetainmentStrikeState({ detainment: false, strikeProwess: 7 });
    expect(state.combat).not.toBeNull();

    expect(viableActionTypes(state, PLAYER_1)).toContain('concede');

    const after = dispatch(state, { type: 'concede', player: PLAYER_1 });
    expect(after.phaseState.phase).toBe(Phase.GameOver);
    if (after.phaseState.phase !== Phase.GameOver) throw new Error('unreachable');
    expect(after.phaseState.winner).toBe(PLAYER_2);
    expect(after.phaseState.winReason.kind).toBe('concession');
  });

  test('remains legal mid-chain and bypasses the active chain response window', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ELROND],
      site: THRANDUILS_HALLS,
      hand: [TEMPERING_FRIENDSHIP, WOOD_ELVES],
      factionDefId: WOOD_ELVES,
    });
    expect(state.chain).not.toBeNull();

    expect(viableActionTypes(state, PLAYER_1)).toContain('concede');

    const after = dispatch(state, { type: 'concede', player: PLAYER_1 });
    expect(after.phaseState.phase).toBe(Phase.GameOver);
    if (after.phaseState.phase !== Phase.GameOver) throw new Error('unreachable');
    expect(after.phaseState.winner).toBe(PLAYER_2);
    expect(after.phaseState.winReason.kind).toBe('concession');
  });
});
