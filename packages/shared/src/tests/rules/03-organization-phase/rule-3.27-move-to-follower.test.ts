/**
 * @module rule-3.27-move-to-follower
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.27: Move Character to Follower
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may move a non-avatar character without followers to the control of a non-follower character in the same company while organizing during the organization phase. This action can only be taken if the controlled character's mind is less than or equal to the controlling character's available direct influence, before any modifications are applied to the controlled character's mind as a result of being a follower.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, ADRAZAR, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { MoveToInfluenceAction } from '../../../types/actions-organization.js';

describe('Rule 3.27 — Move Character to Follower', () => {
  beforeEach(() => resetMint());

  test('May move non-avatar non-follower character to control of non-follower character in same company if mind <= available DI', () => {
    // Aragorn (DI 3) and Adrazar (mind 3) are both under GI in the same
    // company. Adrazar's mind (3) fits within Aragorn's available DI (3),
    // so the engine must offer a move-to-influence action assigning Adrazar
    // as Aragorn's follower. The reverse — Aragorn (mind 9) under Adrazar
    // (DI 1) — must not be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, ADRAZAR] }],
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

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const adrId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);
    const moves = viableActions(state, PLAYER_1, 'move-to-influence') as { action: MoveToInfluenceAction }[];

    // Adrazar (mind 3) ≤ Aragorn available DI (3) → valid follower assignment
    expect(moves.some(a =>
      a.action.characterInstanceId === adrId &&
      a.action.controlledBy === aragornId,
    )).toBe(true);

    // Aragorn (mind 9) > Adrazar available DI (1) → not offered
    expect(moves.some(a =>
      a.action.characterInstanceId === aragornId &&
      a.action.controlledBy === adrId,
    )).toBe(false);
  });
});
