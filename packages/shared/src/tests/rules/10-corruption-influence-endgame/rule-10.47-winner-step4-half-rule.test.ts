/**
 * @module rule-10.47-winner-step4-half-rule
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.47: Step 4: Reducing Sources to Half
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 4 (Reducing Sources to Half of Total) - If more than half of a player's marshalling point total comes from a single source (ignoring negative sources), that player reduces their marshalling points from that source until it is no more than half of their own marshalling point total.
 */

import { describe, test, expect } from 'vitest';
import { computeTournamentBreakdown, ZERO_MARSHALLING_POINTS } from '../../../index.js';

describe('Rule 10.47 — Step 4: Reducing Sources to Half', () => {
  test('If more than half of MP total from single source (ignoring negative), reduce to no more than half', () => {
    // Player has 20 item MPs and 4 character MPs. Items (20) > half of total
    // (24/2=12) so items must be capped to 12. Total after cap = 12 + 4 = 16,
    // and items (12) = half of 16 exactly (floor(16/2)=8 … wait, iterative:
    // cap at floor(24/2)=12: total=16, items(12)>floor(16/2)=8: cap at 8,
    // total=12, items(8)>floor(12/2)=6: cap at 6, total=10, items(6)>floor(10/2)=5:
    // cap at 5, total=9, items(5)=floor(9/2)=4: cap at 4, total=8...
    // Actually let me compute more carefully by using a case where no iteration needed.
    //
    // Simpler: 10 item MPs and 2 other MPs. Total=12. Half=6. Items(10)>6 → cap to 6.
    // New total = 6+2 = 8. Half = 4. Items(6) > 4 → cap to 4.
    // New total = 4+2 = 6. Half = 3. Items(4) > 3 → cap to 3.
    // New total = 3+2 = 5. Half = 2. Items(3) > 2 → cap to 2.
    // New total = 2+2 = 4. Half = 2. Items(2) = 2 → stable.
    // Final: item=2, character=2, total=4.
    //
    // Use a case where the single source is capped once and stabilizes:
    // character=6 (no opponent → doubled to 12), item=4, opponent has character=10.
    // Let me just use a direct case with opponent also having values.
    //
    // Concrete example: character=5, item=10. Opponent has character=5, item=5.
    // Step 3: no doubling. Step 4: total=15, half=7, item(10)>7 → cap to 7.
    // New total=12, half=6, item(7)>6 → cap to 6. New total=11, half=5,
    // item(6)>5 → cap to 5. total=10, half=5, item(5)=5 → stable.
    // Final: character=5, item=5, total=10.
    const self = { ...ZERO_MARSHALLING_POINTS, character: 5, item: 10 };
    const opponent = { ...ZERO_MARSHALLING_POINTS, character: 5, item: 5 };

    const breakdown = computeTournamentBreakdown(self, opponent);
    // The item source dominates and must be reduced
    expect(breakdown.item).toBeLessThanOrEqual(Math.floor((breakdown.character + breakdown.item) / 2) + 1);
    // No single source may exceed half the total
    const total = breakdown.character + breakdown.item + breakdown.faction + breakdown.ally + breakdown.kill + breakdown.misc;
    for (const src of ['character', 'item', 'faction', 'ally', 'kill', 'misc'] as const) {
      if (breakdown[src] > 0) {
        expect(breakdown[src]).toBeLessThanOrEqual(Math.floor(total / 2));
      }
    }
    // Original item value was reduced
    expect(breakdown.item).toBeLessThan(10);
  });
});
