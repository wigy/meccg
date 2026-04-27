/**
 * @module rule-1.58-determining-first-player
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.58: Determining Who Goes First
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining Who Goes First - To determine who goes first, each player makes a roll. Re-roll ties. The player with the higher roll must take the first turn.
 */

import { describe, test, expect } from 'vitest';
import {
  runSetupToInitiativeRoll, reduce, PLAYER_1, PLAYER_2, Phase,
} from '../../test-helpers.js';

describe('Rule 1.58 — Determining Who Goes First', () => {
  test('Each player rolls; re-roll ties; higher roll must take first turn', () => {
    // Navigate to the initiative-roll setup step with a clean state.
    let state = runSetupToInitiativeRoll();
    expect(state.phaseState.phase).toBe(Phase.Setup);
    expect((state.phaseState as { setupStep: { step: string } }).setupStep.step).toBe('initiative-roll');

    // === Case 1: PLAYER_1 rolls higher → PLAYER_1 goes first ===
    // Inject cheatRollTotal=12 before PLAYER_1 rolls, then 7 before PLAYER_2 rolls.
    const r1 = reduce({ ...state, cheatRollTotal: 12 }, { type: 'roll-initiative', player: PLAYER_1 });
    expect(r1.error).toBeUndefined();
    const afterP1Roll = r1.state;

    const r2 = reduce({ ...afterP1Roll, cheatRollTotal: 7 }, { type: 'roll-initiative', player: PLAYER_2 });
    expect(r2.error).toBeUndefined();
    const afterBothRolls = r2.state;

    // Should now be in Untap phase with PLAYER_1 as active (and starting) player.
    expect(afterBothRolls.phaseState.phase).toBe(Phase.Untap);
    expect(afterBothRolls.activePlayer).toBe(PLAYER_1);
    expect(afterBothRolls.startingPlayer).toBe(PLAYER_1);

    // === Case 2: Tie → rolls are cleared; another roll is needed ===
    // Give both players the same total (7) so they tie.
    state = runSetupToInitiativeRoll();
    const tie1 = reduce({ ...state, cheatRollTotal: 7 }, { type: 'roll-initiative', player: PLAYER_1 });
    expect(tie1.error).toBeUndefined();
    const tie2 = reduce({ ...tie1.state, cheatRollTotal: 7 }, { type: 'roll-initiative', player: PLAYER_2 });
    expect(tie2.error).toBeUndefined();
    const afterTie = tie2.state;

    // Still in setup / initiative-roll step (not yet resolved).
    expect(afterTie.phaseState.phase).toBe(Phase.Setup);
    expect((afterTie.phaseState as { setupStep: { step: string } }).setupStep.step).toBe('initiative-roll');

    // After the tie, a fresh pair of rolls resolves the game.
    const reroll1 = reduce({ ...afterTie, cheatRollTotal: 10 }, { type: 'roll-initiative', player: PLAYER_1 });
    expect(reroll1.error).toBeUndefined();
    const reroll2 = reduce({ ...reroll1.state, cheatRollTotal: 6 }, { type: 'roll-initiative', player: PLAYER_2 });
    expect(reroll2.error).toBeUndefined();

    expect(reroll2.state.phaseState.phase).toBe(Phase.Untap);
    expect(reroll2.state.activePlayer).toBe(PLAYER_1);
  });
});
