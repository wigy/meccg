/**
 * @module rule-3.43-starter-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.43: Starter Movement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * STARTER MOVEMENT - To use Starter Movement, one of the following must be true:
 * • The company's current site is a haven and is listed as the nearest haven on the company's new site card;
 * • the company's new site is a haven and is listed as the nearest haven on the company's current site card; OR
 * • the company's current site and new site are both havens, with each site card listing a site path to the other site.
 * [HERO] A Wizard player cannot use Starter Movement to or from sites in Gorgoroth.
 * [FALLEN-WIZARD] A Fallen-wizard player cannot use Starter Movement.
 * [BALROG] A Balrog player cannot use Starter Movement.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, BREE, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { PlanMovementAction } from '../../../types/actions-organization.js';

describe('Rule 3.43 — Starter Movement', () => {
  beforeEach(() => resetMint());

  test('Starter movement requires haven connection between current and new site', () => {
    // From a haven (Rivendell), Bree is reachable via starter movement because
    // Bree's nearestHaven is Rivendell. Minas Tirith's nearestHaven is Lórien
    // and its region is too far for region movement (distance 6 > 4), so it
    // is unreachable entirely from Rivendell.
    const fromHaven = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [BREE, MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const breeSiteInstId = fromHaven.players[0].siteDeck.find(
      s => s.definitionId === BREE,
    )!.instanceId;
    const minasTirithSiteInstId = fromHaven.players[0].siteDeck.find(
      s => s.definitionId === MINAS_TIRITH,
    )!.instanceId;

    const movements = viableFor(fromHaven, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    // Bree (nearestHaven = Rivendell) is reachable via starter movement
    expect(movements.some(a => a.action.destinationSite === breeSiteInstId)).toBe(true);
    // Minas Tirith (nearestHaven = Lórien, region distance > 4) is not reachable
    expect(movements.some(a => a.action.destinationSite === minasTirithSiteInstId)).toBe(false);

    // From a non-haven (Bree, nearestHaven = Rivendell), moving back to Rivendell
    // is valid starter movement (non-haven → its nearest haven).
    const fromNonHaven = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const rivendellSiteInstId = fromNonHaven.players[0].siteDeck.find(
      s => s.definitionId === RIVENDELL,
    )!.instanceId;

    const movements2 = viableFor(fromNonHaven, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    expect(movements2.some(a => a.action.destinationSite === rivendellSiteInstId)).toBe(true);
  });
});
