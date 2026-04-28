/**
 * @module rule-3.35-transferring-items
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.35: Transferring Items
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Transferring Items - During the organization phase either before or after organizing, the resource player may attempt to transfer control of an item between two characters at the same site (though not necessarily in the same company) by making a corruption check for the item's initial bearer. If the corruption check is successful, the item is successfully transferred.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { TransferItemAction } from '../../../types/actions-organization.js';

describe('Rule 3.35 — Transferring Items', () => {
  beforeEach(() => resetMint());

  test('During org phase, may transfer item between characters at same site by passing corruption check', () => {
    // Aragorn carries a Dagger at Rivendell; Bilbo is also at Rivendell.
    // The engine must offer a transfer-item action from Aragorn to Bilbo.
    // Both are in the same company here, but the rule allows cross-company
    // transfers at the same site as well.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }, BILBO] }],
          hand: [],
          siteDeck: [MORIA],
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
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const daggerInstId = state.players[RESOURCE_PLAYER].characters[aragornId as string].items[0].instanceId;

    const transfers = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'transfer-item') as { action: TransferItemAction }[];

    expect(transfers.some(a =>
      a.action.itemInstanceId === daggerInstId &&
      a.action.fromCharacterId === aragornId &&
      a.action.toCharacterId === bilboId,
    )).toBe(true);
  });

  test('Characters at different sites cannot transfer items', () => {
    // Aragorn is at Rivendell with a Dagger; Bilbo is at Moria. Since
    // they are at different sites, no transfer action must be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }] },
            { site: MORIA, characters: [BILBO] },
          ],
          hand: [],
          siteDeck: [],
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

    const transfers = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'transfer-item');

    expect(transfers).toHaveLength(0);
  });
});
