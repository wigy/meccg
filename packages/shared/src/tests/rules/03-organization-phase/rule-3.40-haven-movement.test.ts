/**
 * @module rule-3.40-haven-movement
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.40: Haven Movement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company may move to an untapped copy of a haven card from its player's location deck even if that player already has a company at the same haven.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  RIVENDELL, BREE, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { PlanMovementAction } from '../../../types/actions-organization.js';

describe('Rule 3.40 — Haven Movement', () => {
  beforeEach(() => resetMint());

  test('Company may move to untapped haven copy from location deck even if already at that haven', () => {
    // Company A is already at Rivendell. Company B is at Bree (nearestHaven =
    // Rivendell). The player's site deck contains a second untapped copy of
    // Rivendell. Company B must be offered plan-movement to that deck copy even
    // though another company already occupies the same haven.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: BREE, characters: [BILBO] },
          ],
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

    const rivendellInDeck = state.players[0].siteDeck.find(
      s => s.definitionId === RIVENDELL,
    )!.instanceId;

    const movements = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];

    expect(movements.some(a => a.action.destinationSite === rivendellInDeck)).toBe(true);
  });
});
