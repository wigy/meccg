/**
 * @module rule-1.57-dice-rolling
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.57: Dice Rolling
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Whenever you're told to "make a roll," you roll two six-sided dice (2D6) and add the results. Once a roll is made, the result is final, so any effects that would modify the roll need to be played prior to the dice actually being rolled.
 */

import { describe, test, expect } from 'vitest';
import {
  runSetupToInitiativeRoll, reduce, PLAYER_1, Phase,
} from '../../test-helpers.js';

const VALID_DIE_VALUES = [1, 2, 3, 4, 5, 6] as const;

describe('Rule 1.57 — Dice Rolling', () => {
  test('Make a roll means rolling 2D6; result is final, modifications must be played before rolling', () => {
    const state = runSetupToInitiativeRoll();
    expect(state.phaseState.phase).toBe(Phase.Setup);

    // Roll without cheating to verify the dice produce a natural 2D6 result.
    const result = reduce(state, { type: 'roll-initiative', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const roll = result.state.players[0].lastDiceRoll;
    expect(roll).not.toBeNull();

    // Each die must be a valid face value (1–6) — this is what 2D6 means.
    expect(VALID_DIE_VALUES).toContain(roll!.die1);
    expect(VALID_DIE_VALUES).toContain(roll!.die2);

    // The total is the sum of both dice.
    const total = roll!.die1 + roll!.die2;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(total).toBeLessThanOrEqual(12);

    // "Result is final" — the roll is captured in state once the action resolves.
    // Modifications (cheatRollTotal) must be set on the state before the action, not after.
    // Verify: setting cheatRollTotal before rolling changes the total as expected.
    const cheatedResult = reduce({ ...state, cheatRollTotal: 9 }, { type: 'roll-initiative', player: PLAYER_1 });
    expect(cheatedResult.error).toBeUndefined();
    const cheatedRoll = cheatedResult.state.players[0].lastDiceRoll;
    expect(cheatedRoll).not.toBeNull();
    expect(cheatedRoll!.die1 + cheatedRoll!.die2).toBe(9);
  });
});
