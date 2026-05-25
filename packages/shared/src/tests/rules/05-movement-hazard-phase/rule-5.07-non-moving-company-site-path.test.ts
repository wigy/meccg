/**
 * @module rule-5.07-non-moving-company-site-path
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.07: Non-Moving Company Site Path
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If the company is not moving, the company's current site is considered both its new site and its site of origin, but the company does not have a site path. Actions cannot be taken during this step, which happens immediately and is considered synonymous with revealing the new site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActionTypes,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH,
  Phase,
} from '../../test-helpers.js';
import type { MovementHazardPhaseState } from '../../../index.js';

describe('Rule 5.07 — Non-Moving Company Site Path', () => {
  beforeEach(() => resetMint());

  test('Non-moving company: only pass is offered during reveal-new-site step', () => {
    // A non-moving company has no destinationSite. During reveal-new-site,
    // no declare-path or other actions are offered — only pass to advance.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // No destinationSite → company is not moving
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const types = viableActionTypes(state, PLAYER_1);
    // Only pass should be offered during this step for a non-moving company
    expect(types).toEqual(['pass']);
    // No declare-path offered
    expect(types).not.toContain('declare-path');
  });

  test('Non-moving company: passing reveal-new-site auto-advances through set-hazard-limit to play-hazards', () => {
    // When a non-moving company passes through reveal-new-site, the engine now
    // auto-advances through set-hazard-limit and order-effects (both skipped as
    // there are no interactive choices), landing on play-hazards. The current
    // site (MORIA) is used as both destination and origin (rule 5.07).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const mhAfter = after.phaseState as MovementHazardPhaseState;

    // Auto-advances past set-hazard-limit and order-effects straight to play-hazards
    // (non-moving company has no destination, so draw-cards is skipped too)
    expect(mhAfter.step).toBe('play-hazards');
    // Current site (MORIA) is used as both new site and site of origin
    expect(mhAfter.destinationSiteName).toBeTruthy();
  });
});
