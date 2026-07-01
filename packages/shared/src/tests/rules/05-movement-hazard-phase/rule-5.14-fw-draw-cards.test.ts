/**
 * @module rule-5.14-fw-draw-cards
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.14: Fallen-Wizard/Balrog Draw Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] When a Fallen-wizard player moves a company, the number of cards that either player may draw is based on the new site (instead of the site of origin when moving to a haven).
 * [BALROG] When a Balrog player moves a company, the number of cards that either player may draw is based on the new site (instead of the site of origin when moving to a haven).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, MORIA, LORIEN,
} from '../../test-helpers.js';
import { MovementType } from '../../../types/common.js';
import type { MovementHazardPhaseState } from '../../../index.js';

// Moria: hazardDraws 3. Rivendell (a haven): hazardDraws 2. A normal Wizard
// player moving Moria → Rivendell draws based on the site of origin (Moria,
// 3); a Fallen-wizard/Balrog player draws based on the new site (Rivendell,
// 2) even though it is a haven.
describe('Rule 5.14 — Fallen-Wizard/Balrog Draw Cards', () => {
  beforeEach(() => resetMint());

  test('[HERO] A Wizard player moving to a haven draws based on the site of origin', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: RIVENDELL }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Starter });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.hazardDrawMax).toBe(3);
  });

  test('[FALLEN-WIZARD] A Fallen-wizard player moving to a haven draws based on the new site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: RIVENDELL }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Starter });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.hazardDrawMax).toBe(2);
  });

  test('[BALROG] A Balrog player moving to a haven draws based on the new site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: RIVENDELL }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const after = dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Starter });
    const mh = after.phaseState as MovementHazardPhaseState;

    expect(mh.hazardDrawMax).toBe(2);
  });
});
