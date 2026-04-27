/**
 * @module rule-5.02-mh-step1-reveal-site
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.02: Step 1: Reveal the New Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 1 (Reveal the New Site) - If the company is moving, the company's new site is revealed. No other actions can be taken during this step, which happens immediately.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActionTypes,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase,
} from '../../test-helpers.js';

describe('Rule 5.02 — Step 1: Reveal the New Site', () => {
  beforeEach(() => resetMint());

  test('Moving company: declare-path offered during reveal-new-site; no other actions', () => {
    // A moving company has a destinationSite set. During reveal-new-site,
    // the resource player must declare their path (starter or region movement).
    // No other actions are offered at this step.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const types = viableActionTypes(state, PLAYER_1);
    // declare-path must be offered (to choose starter or region movement)
    expect(types).toContain('declare-path');
    // No resource plays, hazard plays, or other actions during this step
    expect(types.filter(t => t !== 'declare-path')).toHaveLength(0);
  });

  test('Hazard player has no actions during reveal-new-site step', () => {
    // The hazard player cannot act during the reveal-new-site step.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const types = viableActionTypes(state, PLAYER_2);
    expect(types).toHaveLength(0);
  });
});
