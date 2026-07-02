/**
 * @module rule-3.46-special-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.46: Special Movement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * SPECIAL MOVEMENT - Special Movement encompasses effects that allow a player to circumvent the normal rules for movement. Unless otherwise noted, an effect that permits Special Movement enables that movement during the movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import { MovementType } from '../../../types/common.js';
import type { DeclarePathAction, MovementHazardPhaseState, PlanMovementAction } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableActions, attachAllyToChar, makeMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GWAIHIR,
  EAGLES_EYRIE, LOND_GALEN, LORIEN, MORIA,
} from '../../test-helpers.js';

describe('Rule 3.46 — Special Movement', () => {
  beforeEach(() => resetMint());

  test('special movement circumvents the normal movement rules (destination unreachable by normal movement)', () => {
    // Lond Galen is beyond normal movement range from Eagles' Eyrie (more
    // than the maximum number of regions away, and no starter path). Without
    // a special-movement effect, plan-movement must not offer it; with
    // Gwaihir's special movement active, it becomes a legal destination.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [LOND_GALEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const londGalenId = base.players[RESOURCE_PLAYER].siteDeck
      .find(c => c.definitionId === LOND_GALEN)!.instanceId;

    // Normal movement: Lond Galen is not offered as a destination.
    const normalMoves = viableActions(base, PLAYER_1, 'plan-movement');
    const normalDests = normalMoves.map(ea => (ea.action as PlanMovementAction).destinationSite);
    expect(normalDests).not.toContain(londGalenId);

    // Activate Gwaihir's special-movement grant.
    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const [grant] = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    expect(grant).toBeDefined();
    const activated = dispatch(withGwaihir, grant.action);

    // Special movement: Lond Galen is now a legal destination.
    const specialMoves = viableActions(activated, PLAYER_1, 'plan-movement');
    const specialDests = specialMoves.map(ea => (ea.action as PlanMovementAction).destinationSite);
    expect(specialDests).toContain(londGalenId);
  });

  test('special movement is executed during the movement/hazard phase', () => {
    // After the organization-phase activation and movement declaration, the
    // movement itself happens in the M/H phase: the reveal-new-site step
    // offers exactly one declare-path action of type Special (the normal
    // starter/region path computations are bypassed entirely), and
    // dispatching it reveals the new site with no region site path.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [LOND_GALEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const londGalenId = base.players[RESOURCE_PLAYER].siteDeck
      .find(c => c.definitionId === LOND_GALEN)!.instanceId;

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const [grant] = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    const activated = dispatch(withGwaihir, grant.action);
    const planAction = viableActions(activated, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as PlanMovementAction)
      .find(a => a.destinationSite === londGalenId);
    expect(planAction).toBeDefined();
    const planned = dispatch(activated, planAction!);
    expect(planned.players[RESOURCE_PLAYER].companies[0].specialMovement).toBe('gwaihir');

    // Enter the M/H phase at the reveal-new-site step.
    const mh = { ...planned, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const pathActions = viableActions(mh, PLAYER_1, 'declare-path');
    expect(pathActions).toHaveLength(1);
    expect((pathActions[0].action as DeclarePathAction).movementType).toBe(MovementType.Special);

    // Dispatching the special path performs the movement with no site path.
    const revealed = dispatch(mh, pathActions[0].action);
    const mhState = revealed.phaseState as MovementHazardPhaseState;
    expect(mhState.resolvedSitePath).toEqual([]);
    expect(mhState.resolvedSitePathNames).toEqual([]);
  });
});
