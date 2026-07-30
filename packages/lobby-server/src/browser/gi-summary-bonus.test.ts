/**
 * @module gi-summary-bonus.test
 *
 * Regression test for bug report 344a0fc393ba2897 (game ms6gbt8d-5na91m, seq
 * 437): "+5 GI is not reflected on GI summary." The player had *Bade to Rule*
 * (le-167) in play on their Ringwraith, which grants +5 general influence
 * (CoE 1.12.R1 / CRF 22) — `generalInfluenceUsed: 14`, `generalInfluenceBonus:
 * 5`, so the effective pool (`generalInfluence`) was 25 and the remaining GI
 * should read 11.
 *
 * `renderPlayerNames` computed the displayed GI as the hardcoded
 * `GENERAL_INFLUENCE` constant (20) minus `generalInfluenceUsed`, ignoring any
 * in-play bonus already folded into `view.self.generalInfluence` by the
 * projection — so it showed 6 instead of 11.
 */

import './test-dom-bootstrap.js'; // must precede the render-player-names import (load-time window access)
import { describe, test, expect } from 'vitest';
import { remainingGeneralInfluence } from './render-player-names.js';

describe('remaining GI reflects in-play bonuses (Bade to Rule le-167)', () => {
  test('a +5 bonus from Bade to Rule is included in the remaining total', () => {
    // Matches game ms6gbt8d-5na91m seq 437: generalInfluenceUsed 14, pool 25 (20 + 5).
    expect(remainingGeneralInfluence({ generalInfluence: 25, generalInfluenceUsed: 14 })).toBe(11);
  });

  test('with no bonus in play, the remaining total matches the base pool', () => {
    expect(remainingGeneralInfluence({ generalInfluence: 20, generalInfluenceUsed: 14 })).toBe(6);
  });
});
