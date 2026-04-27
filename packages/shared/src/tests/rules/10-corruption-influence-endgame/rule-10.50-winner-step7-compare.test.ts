/**
 * @module rule-10.50-winner-step7-compare
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.50: Step 7: Comparing Totals
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 7 (Comparing Totals) - The player with the highest final marshalling point total wins the game. If both players have the same mashalling point total, the game ends in a tie.
 */

import { describe, test, expect } from 'vitest';
import { computeTournamentScore, ZERO_MARSHALLING_POINTS } from '../../../index.js';

describe('Rule 10.50 — Step 7: Comparing Totals', () => {
  test('Highest final MP total wins; tie = tie', () => {
    // Player A has more MPs → wins
    const playerA = { ...ZERO_MARSHALLING_POINTS, character: 10, item: 5 };
    const playerB = { ...ZERO_MARSHALLING_POINTS, character: 8, item: 4 };
    const scoreA = computeTournamentScore(playerA, playerB);
    const scoreB = computeTournamentScore(playerB, playerA);
    expect(scoreA).toBeGreaterThan(scoreB);

    // Equal totals → tie (both scores are the same)
    const tied = { ...ZERO_MARSHALLING_POINTS, character: 5, item: 5 };
    const scoreT1 = computeTournamentScore(tied, tied);
    const scoreT2 = computeTournamentScore(tied, tied);
    expect(scoreT1).toBe(scoreT2);
  });
});
