/**
 * @module tw-251.test
 *
 * Card test: Gwaihir (tw-251)
 * Type: hero-resource-ally
 * Effects: 1 (grant-action gwaihir-special-movement, cost: discard self)
 *
 * "Unique. Playable at Eagles' Eyrie. If his company's size is two or less,
 *  you may discard Gwaihir during the organization phase to allow his company
 *  to move to any site that is not in a Shadow-land, Dark-domain, or
 *  Under-deeps; only hazard creatures keyed to the site may be played on a
 *  company that moves in this fashion."
 *
 * Engine Support:
 * | # | Feature                            | Status      | Notes                                    |
 * |---|------------------------------------|-------------|------------------------------------------|
 * | 1 | Discard during org phase            | IMPLEMENTED | grant-action with cost: discard self      |
 * | 2 | Company size ≤ 2 check              | IMPLEMENTED | checked in grantedActionActivations       |
 * | 3 | Special movement (non-shadow/dark)  | IMPLEMENTED | planMovementActions filters by region     |
 * | 4 | Site-keyed-only hazard restriction  | IMPLEMENTED | empty resolvedSitePath in M/H phase       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  GWAIHIR,
  LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, EAGLES_EYRIE, BANDIT_LAIR,
  viableActions,
  charIdAt, dispatch, expectInDiscardPile, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { ActivateGrantedAction, PlanMovementAction } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Gwaihir (tw-251)', () => {
  beforeEach(() => resetMint());

  test('grant-action available when company size is 2 or less during organization', () => {
    // Aragorn alone at Eagles' Eyrie with Gwaihir as ally → company size = 1
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const actions = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('gwaihir-special-movement');
  });

  test('grant-action available when company size is exactly 2', () => {
    // Aragorn + Legolas at Eagles' Eyrie with Gwaihir → company size = 2
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const actions = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);
  });

  test('grant-action NOT available when company size exceeds 2', () => {
    // Aragorn + Legolas + Gimli at Eagles' Eyrie → company size = 3
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const actions = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(0);
  });

  test('activating discards Gwaihir and grants company special movement', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const actions = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const nextState = dispatch(withGwaihir, actions[0].action);

    // Gwaihir should be removed from character's allies
    const aragornId = charIdAt(nextState, RESOURCE_PLAYER);
    expect(nextState.players[0].characters[aragornId as string].allies).toHaveLength(0);

    // Gwaihir should be in player's own discard pile (ally is owned by resource player)
    expectInDiscardPile(nextState, RESOURCE_PLAYER, GWAIHIR);

    // Company should have special movement marker
    expect(nextState.players[0].companies[0].specialMovement).toBe('gwaihir');
  });

  test('special movement allows plan-movement to non-shadow/dark sites', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA, MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);

    // Activate Gwaihir's ability
    const grantActions = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    const afterActivation = dispatch(withGwaihir, grantActions[0].action);

    // Plan-movement should be available for Moria and Minas Tirith
    // (both are in non-shadow/dark regions)
    const moveActions = viableActions(afterActivation, PLAYER_1, 'plan-movement');
    const moveDefIds = moveActions.map(ea => {
      const destInstId = (ea.action as PlanMovementAction).destinationSite;
      const destCard = afterActivation.players[0].siteDeck.find(
        c => c.instanceId === destInstId,
      );
      return destCard?.definitionId;
    });

    expect(moveDefIds).toContain(MORIA);
    expect(moveDefIds).toContain(MINAS_TIRITH);
  });

  test('special movement excludes sites in Shadow-land regions', () => {
    // Bandit Lair is in Brown Lands (shadow region)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [BANDIT_LAIR, MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);

    // Activate Gwaihir's ability
    const grantActions = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    const afterActivation = dispatch(withGwaihir, grantActions[0].action);

    // Plan-movement should include Moria but NOT Bandit Lair (shadow region)
    const moveActions = viableActions(afterActivation, PLAYER_1, 'plan-movement');
    const moveDefIds = moveActions.map(ea => {
      const destInstId = (ea.action as PlanMovementAction).destinationSite;
      const destCard = afterActivation.players[0].siteDeck.find(
        c => c.instanceId === destInstId,
      );
      return destCard?.definitionId;
    });

    expect(moveDefIds).toContain(MORIA);
    expect(moveDefIds).not.toContain(BANDIT_LAIR);
  });

  test('special movement excludes sites in Dark-domain regions', () => {
    // Mount Doom is in Gorgoroth (dark region)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [MOUNT_DOOM, MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);

    // Activate Gwaihir's ability
    const grantActions = viableActions(withGwaihir, PLAYER_1, 'activate-granted-action');
    const afterActivation = dispatch(withGwaihir, grantActions[0].action);

    // Plan-movement should include Moria but NOT Mount Doom (dark region)
    const moveActions = viableActions(afterActivation, PLAYER_1, 'plan-movement');
    const moveDefIds = moveActions.map(ea => {
      const destInstId = (ea.action as PlanMovementAction).destinationSite;
      const destCard = afterActivation.players[0].siteDeck.find(
        c => c.instanceId === destInstId,
      );
      return destCard?.definitionId;
    });

    expect(moveDefIds).toContain(MORIA);
    expect(moveDefIds).not.toContain(MOUNT_DOOM);
  });

  test('cannot activate Gwaihir after company already has planned movement', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withGwaihir = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);

    // Plan regular movement first
    const moveActions = viableActions(withGwaihir, PLAYER_1, 'plan-movement');
    expect(moveActions.length).toBeGreaterThan(0);
    const afterMove = dispatch(withGwaihir, moveActions[0].action);

    // Gwaihir action should not be available (company already has destination)
    const grantActions = viableActions(afterMove, PLAYER_1, 'activate-granted-action');
    expect(grantActions.length).toBe(0);
  });
});
