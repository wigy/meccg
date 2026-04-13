/**
 * @module rule-3.39-movement-to-existing-site
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.39: Movement to Existing Site
 *
 * Source: docs/coe-rules.txt
 *
 * RULING:
 * If the resource player declares during the organization phase that a
 * company is moving to a site card that the player already has in play,
 * that site card must remain in play until the end of that company's
 * movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  viableActions,
} from '../../test-helpers.js';
import type { PlanMovementAction, CancelMovementAction } from '../../../index.js';

describe('Rule 3.39 — Movement to Existing Site', () => {
  beforeEach(() => resetMint());

  test('plan-movement to a sibling company currentSite is offered and does not touch siteDeck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: LORIEN, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const moriaInstanceId = state.players[0].companies[0].currentSite!.instanceId;
    const lorienCompanyId = state.players[0].companies[1].id;

    const planActions = viableActions(state, PLAYER_1, 'plan-movement');
    const toMoria = planActions.find(ea => {
      const a = ea.action as PlanMovementAction;
      return a.companyId === lorienCompanyId && a.destinationSite === moriaInstanceId;
    });
    expect(toMoria).toBeDefined();

    const result = reduce(state, toMoria!.action);
    expect(result.error).toBeUndefined();

    // Site deck is unchanged — Moria was not drawn
    expect(result.state.players[0].siteDeck.length).toBe(1);
    expect(result.state.players[0].siteDeck[0].definitionId).toBe(MINAS_TIRITH);

    // Lorien company now has Moria as its destination
    const lorienCompany = result.state.players[0].companies[1];
    expect(lorienCompany.destinationSite?.instanceId).toBe(moriaInstanceId);

    // Moria company is untouched
    const moriaCompany = result.state.players[0].companies[0];
    expect(moriaCompany.currentSite?.instanceId).toBe(moriaInstanceId);
  });

  test('cancel-movement does not re-add a shared in-play destination to the site deck', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: LORIEN, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const moriaInstanceId = state.players[0].companies[0].currentSite!.instanceId;
    const lorienCompanyId = state.players[0].companies[1].id;

    const planActions = viableActions(state, PLAYER_1, 'plan-movement');
    const toMoria = planActions.find(ea => {
      const a = ea.action as PlanMovementAction;
      return a.companyId === lorienCompanyId && a.destinationSite === moriaInstanceId;
    })!;
    const afterPlan = reduce(state, toMoria.action);
    expect(afterPlan.error).toBeUndefined();

    const cancel: CancelMovementAction = {
      type: 'cancel-movement',
      player: PLAYER_1,
      companyId: lorienCompanyId,
    };
    const afterCancel = reduce(afterPlan.state, cancel);
    expect(afterCancel.error).toBeUndefined();

    // Site deck must still be just Minas Tirith — Moria was never drawn, so it must not be pushed back.
    expect(afterCancel.state.players[0].siteDeck.length).toBe(1);
    expect(afterCancel.state.players[0].siteDeck[0].definitionId).toBe(MINAS_TIRITH);

    // Lorien company's movement is cleared; Moria company still at Moria.
    expect(afterCancel.state.players[0].companies[1].destinationSite).toBeNull();
    expect(afterCancel.state.players[0].companies[0].currentSite?.instanceId).toBe(moriaInstanceId);
  });
});
