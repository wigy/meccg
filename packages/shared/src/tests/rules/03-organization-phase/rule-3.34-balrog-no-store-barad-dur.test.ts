/**
 * @module rule-3.34-balrog-no-store-barad-dur
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.34: Balrog Cannot Store at Barad-dûr
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player cannot store anything at Barad-dûr.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../test-helpers.js';
import {
  buildTestState, resetMint, findCharInstanceId, viableFor, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, RIVENDELL,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';

// Crook-legged Orc (ba-6) carrying Elven Rope (ba-34), a minor item storable
// at any haven with no `storable-at` restriction. Single-test use → inline.
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
const ELVEN_ROPE = 'ba-34' as CardDefinitionId;
const BARAD_DUR = 'ba-84' as CardDefinitionId;
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;

describe('Rule 3.34 — Balrog Cannot Store at Barad-dûr', () => {
  beforeEach(() => resetMint());

  test('[BALROG] Cannot store an item at Barad-dûr', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: BARAD_DUR, characters: [{ defId: CROOK_LEGGED_ORC, items: [ELVEN_ROPE] }] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
      recompute: true,
    });

    const stores = viableFor(state, PLAYER_1).filter(a => a.action.type === 'store-item');
    expect(stores).toHaveLength(0);
  });

  test('[BALROG] Can store the same item at another Balrog haven (The Under-gates)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_GATES, characters: [{ defId: CROOK_LEGGED_ORC, items: [ELVEN_ROPE] }] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
      recompute: true,
    });

    const orcId = findCharInstanceId(state, RESOURCE_PLAYER, CROOK_LEGGED_ORC);
    const ropeInstId = state.players[RESOURCE_PLAYER].characters[orcId].items[0].instanceId;

    const stores = viableFor(state, PLAYER_1).filter(a => a.action.type === 'store-item');
    expect(stores.some(a => (a.action as { itemInstanceId: unknown }).itemInstanceId === ropeInstId)).toBe(true);
  });
});
