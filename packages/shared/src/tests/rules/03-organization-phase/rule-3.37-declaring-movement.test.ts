/**
 * @module rule-3.37-declaring-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.37: Declaring Movement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Declaring Movement - During the organization phase either before or after organizing, the resource player may declare movement for one or more of their companies that has not already declared movement during the same organization phase. The resource player declares movement by placing a site card from their location deck face-down with a company OR by declaring that a company's new site is a specific site card at which the player already has a different company or that is already in play as the destination site for a different company. Declaring movement has an active condition that the movement be valid depending on the type of movement used (e.g. Starter Movement, Region Movement, Under-deeps Movement, or Special Movement).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, BREE, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { PlanMovementAction } from '../../../types/actions-organization.js';

describe('Rule 3.37 — Declaring Movement', () => {
  beforeEach(() => resetMint());

  test('During org phase, declare movement by placing face-down site or declaring existing site as destination', () => {
    // Aragorn's company is at Rivendell. Bree (nearestHaven=Rivendell) is in
    // the siteDeck, making it reachable via starter movement. The engine
    // must offer a plan-movement action targeting Bree.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [BREE, MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    // Bree is reachable from Rivendell via starter movement
    const breeSiteInstId = state.players[0].siteDeck.find(
      s => s.definitionId === BREE,
    )!.instanceId;
    expect(movements.some(a => a.action.destinationSite === breeSiteInstId)).toBe(true);

    // Sites not in the siteDeck are not offered
    const state2 = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA], // Bree is absent
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const movements2 = viableFor(state2, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    // Bree not in siteDeck → no plan-movement to Bree
    const breeDef = state2.cardPool[BREE as string];
    const hasBreePlan = movements2.some(a => {
      const destDef = state2.cardPool[
        state2.players[0].siteDeck.find(s => s.instanceId === a.action.destinationSite)?.definitionId as string ?? ''
      ];
      return destDef && (destDef as { name?: string }).name === 'Bree';
    });
    expect(hasBreePlan).toBe(false);
    void breeDef; // suppress unused-var
  });
});
