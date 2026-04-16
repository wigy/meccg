/**
 * @module rule-3.23-company-composition
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.23: Setting Company Composition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Organizing by Setting Company Composition - The resource player may compose their characters into and within companies while organizing during the organization phase.
 *
 * The composition primitives (split, merge, move-to-follower, move-to-company,
 * move-to-influence) are exercised in rules 3.27–3.31. This test only
 * verifies the umbrella claim: that the resource player has at least one
 * composition-style action available during the organization phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';

/** Action types that constitute "setting company composition" in rule 3.23. */
const COMPOSITION_ACTION_TYPES = new Set([
  'split-company', 'merge-companies',
  'move-to-company', 'move-to-influence', 'move-to-follower',
]);

describe('Rule 3.23 — Setting Company Composition', () => {
  beforeEach(() => resetMint());

  test('Resource player has at least one company-composition action while organizing', () => {
    // P1's two characters share a haven (Rivendell). The engine should
    // offer composition-style actions — split, merge, move-to-company,
    // move-to-influence, etc. — enabling the resource player to rearrange.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const p1Composition = viableFor(state, PLAYER_1)
      .filter(a => COMPOSITION_ACTION_TYPES.has(a.action.type));
    expect(p1Composition.length).toBeGreaterThan(0);
  });

  test('Hazard player has no company-composition actions in the resource player\'s organization phase', () => {
    // The umbrella permission is for the resource player only; the hazard
    // player gets no organization-phase composition actions on opponent's
    // turn.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const p2Composition = viableFor(state, PLAYER_2)
      .filter(a => COMPOSITION_ACTION_TYPES.has(a.action.type));
    expect(p2Composition).toHaveLength(0);
  });
});
