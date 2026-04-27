/**
 * @module rule-5.16-mh-step7-play-hazards
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.16: Step 7: Play Hazards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 7 (Play Hazards) - The hazard player may take the following actions in any order and as many times as desired (unless otherwise noted) until the hazard limit is reached.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GLAMDRING, ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeShadowMHState, viableActions,
} from '../../test-helpers.js';
import { computeLegalActions, Phase } from '../../../index.js';
import type { GameState, MovementHazardPhaseState, CardInstanceId } from '../../../index.js';

describe('Rule 5.16 — Step 7: Play Hazards', () => {
  beforeEach(() => resetMint());

  test('Hazard player may take actions until hazard limit reached', () => {
    // P1 at MORIA (shadow-hold). P2 has ORC_PATROL in hand.
    // When hazardsPlayedThisCompany < hazardLimitAtReveal → ORC_PATROL is playable.
    // When hazardsPlayedThisCompany == hazardLimitAtReveal → ORC_PATROL is NOT viable.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const atLimit: GameState = {
      ...base,
      phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 2 }),
    };
    const belowLimit: GameState = {
      ...base,
      phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };

    // Below limit: at least one viable play-hazard action for ORC_PATROL
    const playableActions = viableActions(belowLimit, PLAYER_2, 'play-hazard');
    expect(playableActions.length).toBeGreaterThan(0);

    // At limit: no viable play-hazard actions (ORC_PATROL non-viable due to limit)
    const nonViable = viableActions(atLimit, PLAYER_2, 'play-hazard');
    expect(nonViable).toHaveLength(0);
  });

  test('resource player hand cards without actions get not-playable reasons', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GLAMDRING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState: MovementHazardPhaseState = {
      phase: Phase.MovementHazard,
      step: 'play-hazards',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      movementType: null,
      declaredRegionPath: [],
      maxRegionDistance: 4,
      hazardsPlayedThisCompany: 0,
      hazardLimitAtReveal: 4,
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
    const mhGameState: GameState = { ...state, phaseState: mhState };

    const actions = computeLegalActions(mhGameState, PLAYER_1);
    const glamdringId = mhGameState.players[0].hand[0].instanceId;
    const notPlayable = actions.find(
      ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === glamdringId,
    );

    expect(notPlayable).toBeDefined();
    expect(notPlayable!.reason).toBeDefined();
    expect(notPlayable!.reason!.length).toBeGreaterThan(0);
  });
});
