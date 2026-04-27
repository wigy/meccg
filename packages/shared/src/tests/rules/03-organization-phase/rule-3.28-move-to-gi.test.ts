/**
 * @module rule-3.28-move-to-gi
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.28: Move Character to General Influence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may move a character to the control of general influence while organizing during the organization phase, if doing so would not put the total mind of a player's non-follower characters above the player's maximum general influence.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, ADRAZAR, BILBO, FARAMIR, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { MoveToInfluenceAction } from '../../../types/actions-organization.js';

describe('Rule 3.28 — Move Character to General Influence', () => {
  beforeEach(() => resetMint());

  test('May move character to GI control if it would not exceed max GI', () => {
    // Adrazar (mind 3) is Aragorn's follower. Moving Adrazar to GI brings
    // the total non-follower mind to 9 + 3 = 12, well under the 20-point
    // cap, so the engine must offer a move-to-influence to 'general'.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: ADRAZAR, followerOf: 0 }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const adrId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);
    const moves = viableActions(state, PLAYER_1, 'move-to-influence') as { action: MoveToInfluenceAction }[];

    expect(moves.some(a =>
      a.action.characterInstanceId === adrId &&
      a.action.controlledBy === 'general',
    )).toBe(true);
  });

  test('Cannot move character to GI if doing so would exceed max general influence', () => {
    // Aragorn (9) + Bilbo (5) + Faramir (5) = 19 points of GI already used,
    // leaving only 1 point free. Adrazar has mind 3, which exceeds the
    // remaining 1, so moving Adrazar to GI must not be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [ARAGORN, BILBO, FARAMIR, { defId: ADRAZAR, followerOf: 0 }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
      recompute: true,
    });

    const adrId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);
    const moves = viableActions(state, PLAYER_1, 'move-to-influence') as { action: MoveToInfluenceAction }[];

    expect(moves.some(a =>
      a.action.characterInstanceId === adrId &&
      a.action.controlledBy === 'general',
    )).toBe(false);
  });
});
