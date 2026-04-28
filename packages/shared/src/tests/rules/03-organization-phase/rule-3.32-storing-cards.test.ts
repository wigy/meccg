/**
 * @module rule-3.32-storing-cards
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.32: Storing Cards
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Storing Cards - During the organization phase either before or after organizing, the resource player may attempt to store an item controlled by one of their characters at a haven.
 * In order to store an item, the item's player makes a corruption check for the item's bearer. If the corruption check is successful, the item is successfully stored and is placed in its player's marshalling point pile.
 * Stored cards are no longer borne by a character (and thus get no bonuses based on who bears them).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, viableFor, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  BILBO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { StoreItemAction } from '../../../types/actions-organization.js';

// Red Book of Westmarch (tw-313): storable at any haven for 1 MP.
// Only used in this file.
const RED_BOOK_OF_WESTMARCH = 'tw-313' as CardDefinitionId;

describe('Rule 3.32 — Storing Cards', () => {
  beforeEach(() => resetMint());

  test('During org phase, may store item at haven by passing corruption check; stored cards lose bearer bonuses', () => {
    // Bilbo at Rivendell (a haven) carries Red Book of Westmarch, which is
    // storable at any haven. The engine must offer a store-item action.
    const atHaven = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [RED_BOOK_OF_WESTMARCH] }] }],
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

    const bilboId = findCharInstanceId(atHaven, RESOURCE_PLAYER, BILBO);
    const bookInstId = atHaven.players[RESOURCE_PLAYER].characters[bilboId as string].items[0].instanceId;

    const stores = viableFor(atHaven, PLAYER_1)
      .filter(a => a.action.type === 'store-item') as { action: StoreItemAction }[];

    expect(stores.some(a =>
      a.action.itemInstanceId === bookInstId &&
      a.action.characterId === bilboId,
    )).toBe(true);

    // At a non-haven (Moria), Red Book of Westmarch is not storable.
    const atNonHaven = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: BILBO, items: [RED_BOOK_OF_WESTMARCH] }] }],
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
      recompute: true,
    });
    const nonHavenStores = viableFor(atNonHaven, PLAYER_1)
      .filter(a => a.action.type === 'store-item');
    expect(nonHavenStores).toHaveLength(0);
  });
});
