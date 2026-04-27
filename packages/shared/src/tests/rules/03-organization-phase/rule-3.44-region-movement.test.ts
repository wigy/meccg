/**
 * @module rule-3.44-region-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.44: Region Movement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * REGION MOVEMENT - To use Region Movement, the company's new site must be located within four consecutive regions (or a maximum of six consecutive regions if using an effect that allows movement through more than four regions) from the company's current site, without repeating regions and including both the region of the current site and of the new site.
 * [HERO] A Wizard player's company that is using Region Movement to or from sites in Gorgoroth cannot move through Imlad Morgul without starting or stopping there.
 * [MINION] A Ringwraith player's companies may move as if Dagorlad and Ûdun are adjacent.
 * [FALLEN-WIZARD] A Fallen-wizard player's company that is using Region Movement to or from sites in Gorgoroth cannot move through Imlad Morgul without starting or stopping there.
 * [BALROG] A Balrog player's companies may move as if Dagorlad and Ûdun are adjacent.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { PlanMovementAction } from '../../../types/actions-organization.js';

describe('Rule 3.44 — Region Movement', () => {
  beforeEach(() => resetMint());

  test('Region movement: new site within 4 consecutive regions, not reachable beyond 4', () => {
    // From Rivendell (region: Rhudaur):
    //   • Moria (region: Redhorn Gate) is reachable via region movement:
    //     Rhudaur → Hollin → Redhorn Gate (3 regions ≤ 4).
    //     Moria's nearestHaven is Lórien (not Rivendell), so this access is
    //     region movement only — starter movement does not apply.
    //   • Minas Tirith (region: Anórien) is NOT reachable: shortest path is
    //     6 regions (Rhudaur → Cardolan → Enedhwaith → Gap of Isen → Rohan →
    //     Anórien), which exceeds the 4-region limit.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA, MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const moriaSiteInstId = state.players[0].siteDeck.find(
      s => s.definitionId === MORIA,
    )!.instanceId;
    const minasTirithSiteInstId = state.players[0].siteDeck.find(
      s => s.definitionId === MINAS_TIRITH,
    )!.instanceId;

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    // Moria (3-region path from Rivendell) is reachable via region movement
    expect(movements.some(a => a.action.destinationSite === moriaSiteInstId)).toBe(true);
    // Minas Tirith (6-region path from Rivendell) exceeds the 4-region limit
    expect(movements.some(a => a.action.destinationSite === minasTirithSiteInstId)).toBe(false);
  });
});
