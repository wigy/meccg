/**
 * @module rule-5.10-mh-step3-hazard-limit
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.10: Step 3: Set the Base Hazard Limit
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 3 (Set the Base Hazard Limit) - The company's base hazard limit is set to the current size of the company or two, whichever is greater (rounded up), then the base hazard limit is halved (rounded up) if the hazard player accessed the sideboard during this turn's untap phase. Actions cannot be taken during this step, which happens immediately and is considered synonymous with revealing the new site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { MovementHazardPhaseState } from '../../../index.js';

/** Build a minimal MovementHazardPhaseState at the set-hazard-limit step. */
function makeSetHazardLimitState(
  companyCharacters: typeof ARAGORN[],
  sideboardAccessed = false,
) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: companyCharacters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const mhState: MovementHazardPhaseState = {
    phase: Phase.MovementHazard,
    step: 'set-hazard-limit',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    movementType: null,
    declaredRegionPath: [],
    maxRegionDistance: 4,
    hazardsPlayedThisCompany: 0,
    hazardLimitAtReveal: 0,
    preRevealHazardLimitConstraintIds: [],
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: null,
    destinationSiteName: null,
    resourceDrawMax: 0,
    hazardDrawMax: 0,
    resourceDrawCount: 0,
    hazardDrawCount: 0,
    resourcePlayerPassed: false,
    hazardPlayerPassed: false,
    onGuardPlacedThisCompany: false,
    siteRevealed: false,
    returnedToOrigin: false,
    hazardsEncountered: [],
    ahuntAttacksResolved: 0,
    corruptionCardsPlayedPerChar: {},
  };

  const players = sideboardAccessed
    ? [
        state.players[RESOURCE_PLAYER],
        { ...state.players[1], sideboardAccessedDuringUntap: true },
      ]
    : state.players;

  return { ...state, phaseState: mhState, players } as typeof state;
}

describe('Rule 5.10 — Step 3: Set the Base Hazard Limit', () => {
  beforeEach(() => resetMint());

  test('Hazard limit = max(company size, 2), halved if sideboard accessed; fixed for duration of M/H phase', () => {
    // Solo company (1 character): limit = max(1, 2) = 2
    const solo = makeSetHazardLimitState([ARAGORN]);
    const afterSolo = dispatch(solo, { type: 'pass', player: PLAYER_1 });
    expect((afterSolo.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(2);

    // Three-character company: limit = max(3, 2) = 3
    const triple = makeSetHazardLimitState([ARAGORN, BILBO, LEGOLAS]);
    const afterTriple = dispatch(triple, { type: 'pass', player: PLAYER_1 });
    expect((afterTriple.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(3);

    // When hazard player accessed sideboard during untap, limit is halved (rounded up)
    const withSideboard = makeSetHazardLimitState([ARAGORN], true);
    const afterSideboard = dispatch(withSideboard, { type: 'pass', player: PLAYER_1 });
    // ceil(2 / 2) = 1
    expect((afterSideboard.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(1);
  });
});
