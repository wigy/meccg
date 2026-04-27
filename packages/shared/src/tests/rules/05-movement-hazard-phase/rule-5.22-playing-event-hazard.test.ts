/**
 * @module rule-5.22-playing-event-hazard
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.22: Playing an Event Hazard
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing an Event Hazard - As an action during a movement/hazard phase, the hazard player may play a hazard short-event or hazard permanent-event that targets one or more of the following (or an attribute thereof):
 * • the current company or an entity associated with that company
 * • the company's site path
 * • the company's new site if the company is moving
 * • the company's current site if the company is not moving
 * The hazard player may also play a hazard long-event or a hazard permanent-event that potentially targets one of the above entities, or that doesn't have a target. Playing a hazard event counts as one against the hazard limit.
 * Hazards may affect more than one company even if they are only played on the current company.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, makeShadowMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  EYE_OF_SAURON, RIVER,
  Phase,
} from '../../test-helpers.js';
import type { MovementHazardPhaseState } from '../../../index.js';

describe('Rule 5.22 — Playing an Event Hazard', () => {
  beforeEach(() => resetMint());

  test('Hazard long-event (untargeted) is playable against moving company and counts against hazard limit', () => {
    // Eye of Sauron is a hazard long-event with no specific company target.
    // Per rule 5.22, long-events that "potentially target" or have no target
    // may be played during the M/H phase, counting 1 against the hazard limit.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = {
      ...base,
      phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }),
    };

    // Eye of Sauron must be offered as a viable play-hazard action
    const eyeInstId = state.players[1].hand[0].instanceId;
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === eyeInstId)).toBe(true);

    // Playing it increments the hazard count by 1
    const after = dispatch(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: eyeInstId, targetCompanyId: state.players[RESOURCE_PLAYER].companies[0].id });
    const mhAfter = after.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsPlayedThisCompany).toBe(1);
  });

  test('Hazard short-event targeting moving company site is playable and counts against hazard limit', () => {
    // River is a hazard short-event targeting the destination site of a moving company.
    // Per rule 5.22: hazard short-events targeting the company's new site are valid.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [RIVER], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Company is moving to MORIA via a wilderness region
    const state = {
      ...base,
      phaseState: makeShadowMHState({
        hazardLimitAtReveal: 2,
        hazardsPlayedThisCompany: 0,
        siteRevealed: true,
      }),
    };

    // River should be offered as a play-hazard action targeting the destination site
    const riverInstId = state.players[1].hand[0].instanceId;
    const riverPlays = viableActions(state, PLAYER_2, 'play-hazard');
    const riverTargetingActions = riverPlays.filter(
      a => 'cardInstanceId' in a.action && a.action.cardInstanceId === riverInstId
        && 'targetSiteDefinitionId' in a.action,
    );
    expect(riverTargetingActions.length).toBeGreaterThan(0);

    // Playing it increments the hazard count by 1
    const riverAction = riverTargetingActions[0].action;
    const after = dispatch(state, riverAction);
    const mhAfter = after.phaseState as MovementHazardPhaseState;
    expect(mhAfter.hazardsPlayedThisCompany).toBe(1);
  });
});
