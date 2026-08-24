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
  BILBO, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  SCROLL_OF_ISILDUR,
  RESOURCE_PLAYER,
  dispatch,
} from '../../test-helpers.js';
import type { StoreItemAction } from '../../../types/actions-organization.js';
import type { CorruptionCheckAction } from '../../../types/actions-universal.js';

// Red Book of Westmarch (tw-313): storable at any haven for 1 MP.
// Only used in this file.
const RED_BOOK_OF_WESTMARCH = 'tw-313' as CardDefinitionId;
// Dwarven Ring of Durin's Tribe (tw-216): 3 corruption points printed, 5 on a
// Dwarf bearer (a `stat-modifier` on the item's own effects, conditioned on
// `bearer.race === 'dwarf'`). Only used in this file.
const DWARVEN_RING = 'tw-216' as CardDefinitionId;

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
    const bookInstId = atHaven.players[RESOURCE_PLAYER].characters[bilboId].items[0].instanceId;

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

  test('Regular greater item (no storable-at effect) is storable at Haven', () => {
    // Scroll of Isildur is a greater item with no explicit storable-at effect.
    // Per CoE rule 2.II.4, any item may be stored at a Haven.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [SCROLL_OF_ISILDUR] }] }],
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

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const scrollInstId = state.players[RESOURCE_PLAYER].characters[bilboId].items[0].instanceId;

    const stores = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'store-item') as { action: StoreItemAction }[];

    expect(stores.some(a =>
      a.action.itemInstanceId === scrollInstId &&
      a.action.characterId === bilboId,
    )).toBe(true);

    // At a non-haven (Moria), the Scroll of Isildur is not storable.
    const atMoria = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: BILBO, items: [SCROLL_OF_ISILDUR] }] }],
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
    const moriaStores = viableFor(atMoria, PLAYER_1)
      .filter(a => a.action.type === 'store-item');
    expect(moriaStores).toHaveLength(0);
  });

  test('Stored item is placed in the marshalling point pile (killPile), not eliminated pile', () => {
    // CoE rule 2.II.4.1: "the item is successfully stored and is placed in its
    // player's marshalling point pile." The MP pile in the engine is killPile
    // (labeled "MP Pile" in the UI), NOT outOfPlayPile ("Eliminated").
    const state = buildTestState({
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

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const bookInstId = state.players[RESOURCE_PLAYER].characters[bilboId].items[0].instanceId;

    const storeAction = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'store-item')
      .find(a => (a.action as StoreItemAction).itemInstanceId === bookInstId);
    expect(storeAction).toBeDefined();

    const afterStore = dispatch(state, storeAction!.action);

    expect(afterStore.players[RESOURCE_PLAYER].killPile.some(
      c => c.instanceId === bookInstId,
    )).toBe(true);
    expect(afterStore.players[RESOURCE_PLAYER].outOfPlayPile.some(
      c => c.instanceId === bookInstId,
    )).toBe(false);
  });

  test('Stored regular item (no storable-at effect) keeps earning its marshalling points', () => {
    // CoE rule 2.II.4.1: a stored item "is placed in its player's marshalling
    // point pile" and so continues to count for scoring. Scroll of Isildur
    // has no storable-at effect (it relies on the generic any-Haven rule),
    // so its 4 item MPs must not disappear once stored.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [SCROLL_OF_ISILDUR] }] }],
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

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(4);

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const scrollInstId = state.players[RESOURCE_PLAYER].characters[bilboId].items[0].instanceId;

    const storeAction = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'store-item')
      .find(a => (a.action as StoreItemAction).itemInstanceId === scrollInstId);
    expect(storeAction).toBeDefined();

    const afterStore = dispatch(state, storeAction!.action);

    expect(afterStore.players[RESOURCE_PLAYER].killPile.some(
      c => c.instanceId === scrollInstId,
    )).toBe(true);
    expect(afterStore.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(4);
  });

  test('Corruption check for storing an item counts the stored item\'s own corruption points', () => {
    // CoE rule 2.II.4.1: "the item's player makes a corruption check for the
    // item's bearer" — the check determines whether the store succeeds, so
    // it must count the item being stored even though it has already moved
    // to the marshalling point pile by the time the check resolves. Scroll
    // of Isildur is worth 3 corruption points; Bilbo bears none of his own,
    // so the pending check must be against CP 3, not CP 0.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [SCROLL_OF_ISILDUR] }] }],
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

    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const scrollInstId = state.players[RESOURCE_PLAYER].characters[bilboId].items[0].instanceId;

    const storeAction = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'store-item')
      .find(a => (a.action as StoreItemAction).itemInstanceId === scrollInstId);
    expect(storeAction).toBeDefined();

    const afterStore = dispatch(state, storeAction!.action);

    const corruptionChecks = viableFor(afterStore, PLAYER_1)
      .filter(a => a.action.type === 'corruption-check') as { action: CorruptionCheckAction }[];

    expect(corruptionChecks.some(a =>
      a.action.characterId === bilboId && a.action.corruptionPoints === 3,
    )).toBe(true);
  });

  test('Corruption check for storing an item counts a bearer-conditional CP bonus declared on the item', () => {
    // Bug report (game mt2260ne-7k9i02, seq 1712): storing the Dwarven Ring
    // of Durin's Tribe from Thráin II (a Dwarf) computed the check against
    // CP 3 (the printed value) instead of CP 5 — the ring's own +2
    // corruption-points stat-modifier for a Dwarf bearer was dropped once
    // the item left `char.items` and the character's derived stats were
    // recomputed without it. Gimli (a Dwarf) storing the ring must be
    // checked against CP 5, not CP 3.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GIMLI, items: [DWARVEN_RING] }] }],
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

    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const ringInstId = state.players[RESOURCE_PLAYER].characters[gimliId].items[0].instanceId;

    const storeAction = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'store-item')
      .find(a => (a.action as StoreItemAction).itemInstanceId === ringInstId);
    expect(storeAction).toBeDefined();

    const afterStore = dispatch(state, storeAction!.action);

    const corruptionChecks = viableFor(afterStore, PLAYER_1)
      .filter(a => a.action.type === 'corruption-check') as { action: CorruptionCheckAction }[];

    expect(corruptionChecks.some(a =>
      a.action.characterId === gimliId && a.action.corruptionPoints === 5,
    )).toBe(true);
  });
});
