/**
 * @module rule-10.46-winner-step3-doubling
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.46: Step 3: Doubling 0 MP Sources
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 3 (Doubling 0 MP Sources) - If a player has zero or less marshalling points in a source other than kill or miscellaneous, their opponent's marshalling points are doubled for that source.
 */

import { describe, test, expect } from 'vitest';
import { computeTournamentBreakdown, ZERO_MARSHALLING_POINTS } from '../../../index.js';

describe('Rule 10.46 — Step 3: Doubling 0 MP Sources', () => {
  test('If player has 0 or less in a source (not kill/misc), opponent doubles that source', () => {
    // Self has 2 each of character, item, faction, ally; opponent has 0 character.
    // After doubling: character=4, others=2. Total=10, half=5. No source >5 → no cap.
    const self = { ...ZERO_MARSHALLING_POINTS, character: 2, item: 2, faction: 2, ally: 2 };
    const opponent = { ...ZERO_MARSHALLING_POINTS, character: 0, item: 3, faction: 3, ally: 3 };

    const breakdown = computeTournamentBreakdown(self, opponent);
    // Opponent has 0 character → self's character doubled: 2*2 = 4
    expect(breakdown.character).toBe(4);
    // Opponent has >0 item/faction/ally → no doubling
    expect(breakdown.item).toBe(2);
    expect(breakdown.faction).toBe(2);

    // Doubling does not apply to kill or miscellaneous sources.
    // Add character=5 so the half-rule does not reduce kill or misc.
    const selfKillMisc = { ...ZERO_MARSHALLING_POINTS, character: 5, kill: 3, misc: 2 };
    const opponentKillMisc = { ...ZERO_MARSHALLING_POINTS, character: 3, kill: 0, misc: 0 };
    const km = computeTournamentBreakdown(selfKillMisc, opponentKillMisc);
    // kill and misc are exempt from doubling even when opponent has 0
    expect(km.kill).toBe(3);
    expect(km.misc).toBe(2);

    // Opponent with negative faction (≤ 0) still triggers doubling.
    // character=6, faction=3 → opponent has faction=-1 → faction doubled to 6.
    // Total=12, half=6. Neither source >6 → no cap.
    const selfFaction = { ...ZERO_MARSHALLING_POINTS, character: 6, faction: 3 };
    const opponentNegFaction = { ...ZERO_MARSHALLING_POINTS, character: 5, faction: -1 };
    const neg = computeTournamentBreakdown(selfFaction, opponentNegFaction);
    expect(neg.faction).toBe(6);
  });
});
