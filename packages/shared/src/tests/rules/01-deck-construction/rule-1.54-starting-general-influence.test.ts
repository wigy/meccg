/**
 * @module rule-1.54-starting-general-influence
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.54: Starting General Influence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Starting General Influence - Players begin the game with 20 points of general influence, from which the mind values of their starting characters are then deducted.
 * A player cannot have negative available general influence; available general influence always stops being reduced at zero.
 */

import { describe, test, expect } from 'vitest';
import { runFullSetup, Phase } from '../../test-helpers.js';

describe('Rule 1.54 — Starting General Influence', () => {
  test('Players begin with 20 general influence; cannot go negative', () => {
    // Default config: P1 picks Aragorn II (mind 9), P2 picks Legolas (mind 6).
    // After setup: P1 used GI = 9, P2 used GI = 6.
    const state = runFullSetup();

    expect(state.phaseState.phase).toBe(Phase.Untap);

    // P1: Aragorn II (mind 9) — used 9 of 20 GI
    expect(state.players[0].generalInfluenceUsed).toBe(9);

    // P2: Legolas (mind 6) — used 6 of 20 GI
    expect(state.players[1].generalInfluenceUsed).toBe(6);
  });
});
