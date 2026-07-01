/**
 * @module rule-5.12-mh-step4-ongoing-effects
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.12: Step 4: Establish Order of Ongoing Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 4 (Establish Order of Ongoing Effects) - The hazard player determines the order to apply any ongoing effects (including effects played during the organization phase that depend on a company's movement), except for modifications to the hazard limit which are applied in an order chosen by the resource player. Actions cannot be taken during this step, which happens immediately and is considered synonymous with revealing the new site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, MORIA, LORIEN,
} from '../../test-helpers.js';
import { MovementType } from '../../../types/common.js';
import type { MovementHazardPhaseState } from '../../../index.js';

describe('Rule 5.12 — Step 4: Establish Order of Ongoing Effects', () => {
  beforeEach(() => resetMint());

  test('Step 4 happens immediately with no player action — declaring the path advances straight past order-effects', () => {
    // No player action targets `order-effects` directly: declaring the path
    // (step 2) auto-advances through set-hazard-limit and order-effects in
    // one reducer call, landing on draw-cards (or play-hazards for a
    // non-drawing site) — "actions cannot be taken during this step, which
    // happens immediately and is considered synonymous with revealing the
    // new site."
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Starter });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.step).not.toBe('order-effects');
    expect(mh.step).not.toBe('set-hazard-limit');
  });

  // The engine bypasses `order-effects` entirely (see
  // `enterSetHazardLimitAndAutoAdvance`'s doc comment) except to
  // auto-resolve Dragon Ahunt long-events — it does not yet implement an
  // interactive ordering choice for multiple simultaneous ongoing effects,
  // nor a separate resource-player-chosen order for hazard-limit
  // modifications.
  test.todo('Hazard player chooses the order of multiple simultaneous ongoing effects; resource player separately chooses the order of hazard-limit modifications');
});
