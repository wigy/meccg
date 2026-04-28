/**
 * @module rule-10.45-winner-step2-total-mp
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.45: Step 2: Totaling Marshalling Points
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Determining the Winner, Step 2 (Totaling MPs) - Each player then totals their marshalling points for each of six sources, including sources at Under-deeps sites, and applies any modifications from active effects.
 * • Character points (in an octagon shape)
 * • Ally points (in a triangle pointing up)
 * • Item points (in a square)
 * • Faction points (in a triangle pointing down)
 * • Kill points (in a circle)
 * • Miscellaneous points (in a diamond)
 */

import { describe, test, expect } from 'vitest';
import { computeTournamentScore, ZERO_MARSHALLING_POINTS } from '../../../index.js';

describe('Rule 10.45 — Step 2: Totaling Marshalling Points', () => {
  test('Total MPs from 6 sources: character, ally, item, faction, kill, miscellaneous', () => {
    // A player has points spread across all six MP sources. The total must
    // include each source. The opponent has points in every source so no
    // doubling applies (step 3), and no single source dominates (step 4).
    const self = {
      ...ZERO_MARSHALLING_POINTS,
      character: 5,
      ally: 2,
      item: 3,
      faction: 4,
      kill: 1,
      misc: 2,
    };
    // Opponent has equal spread so doubling (step 3) does not trigger
    const opponent = { ...self };

    const total = computeTournamentScore(self, opponent);
    expect(total).toBe(5 + 2 + 3 + 4 + 1 + 2);
  });
});
