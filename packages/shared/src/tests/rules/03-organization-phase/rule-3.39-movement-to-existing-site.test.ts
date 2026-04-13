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
  buildTestState, resetMint, Phase, dispatch,
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

    const nextState = dispatch(state, toMoria!.action);

    // Site deck is unchanged — Moria was not drawn
    expect(nextState.players[0].siteDeck.length).toBe(1);
    expect(nextState.players[0].siteDeck[0].definitionId).toBe(MINAS_TIRITH);

    // Lorien company now has Moria as its destination
    const lorienCompany = nextState.players[0].companies[1];
    expect(lorienCompany.destinationSite?.instanceId).toBe(moriaInstanceId);

    // Moria company is untouched
    const moriaCompany = nextState.players[0].companies[0];
    expect(moriaCompany.currentSite?.instanceId).toBe(moriaInstanceId);
  });

  test('plan-movement may target a site already declared as a sibling destinationSite (rule 3.37)', () => {
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
          // Minas Tirith is in the deck; Moria and Lorien are not.
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [] },
      ],
    });

    const minasTirithInst = state.players[0].siteDeck[0].instanceId;
    const moriaCompanyId = state.players[0].companies[0].id;
    const lorienCompanyId = state.players[0].companies[1].id;

    // Step 1: the Moria company draws Minas Tirith from the deck.
    const firstPlan = viableActions(state, PLAYER_1, 'plan-movement').find(ea => {
      const a = ea.action as PlanMovementAction;
      return a.companyId === moriaCompanyId && a.destinationSite === minasTirithInst;
    })!;
    expect(firstPlan).toBeDefined();
    const afterFirst = dispatch(state, firstPlan.action);
    // Deck no longer contains Minas Tirith; it is now the Moria company's destinationSite.
    expect(afterFirst.players[0].siteDeck).toHaveLength(0);
    expect(afterFirst.players[0].companies[0].destinationSite?.instanceId).toBe(minasTirithInst);

    // Step 2: the Lorien company should now be able to target Minas Tirith via
    // the Moria company's pending destinationSite (rule 3.37 "already in play
    // as the destination site for a different company").
    const secondPlans = viableActions(afterFirst, PLAYER_1, 'plan-movement');
    const lorienToMT = secondPlans.find(ea => {
      const a = ea.action as PlanMovementAction;
      return a.companyId === lorienCompanyId && a.destinationSite === minasTirithInst;
    });
    expect(lorienToMT).toBeDefined();

    const afterSecond = dispatch(afterFirst, lorienToMT!.action);

    // Site deck is still empty — the second plan shared the instance, no draw.
    expect(afterSecond.players[0].siteDeck).toHaveLength(0);

    // Both companies now have the same destinationSite instance.
    expect(afterSecond.players[0].companies[0].destinationSite?.instanceId).toBe(minasTirithInst);
    expect(afterSecond.players[0].companies[1].destinationSite?.instanceId).toBe(minasTirithInst);
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
    const afterPlan = dispatch(state, toMoria.action);

    const cancel: CancelMovementAction = {
      type: 'cancel-movement',
      player: PLAYER_1,
      companyId: lorienCompanyId,
    };
    const afterCancel = dispatch(afterPlan, cancel);

    // Site deck must still be just Minas Tirith — Moria was never drawn, so it must not be pushed back.
    expect(afterCancel.players[0].siteDeck.length).toBe(1);
    expect(afterCancel.players[0].siteDeck[0].definitionId).toBe(MINAS_TIRITH);

    // Lorien company's movement is cleared; Moria company still at Moria.
    expect(afterCancel.players[0].companies[1].destinationSite).toBeNull();
    expect(afterCancel.players[0].companies[0].currentSite?.instanceId).toBe(moriaInstanceId);
  });
});
