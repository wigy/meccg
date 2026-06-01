/**
 * @module le-339.test
 *
 * Card test: Red Book of Westmarch (le-339)
 * Type: minion-resource-item (special, unique)
 * MP: 2 held, 5 stored; Corruption: 2
 *
 * "Unique. Playable at Bag End. May be stored at Barad-dûr for 5 marshalling points."
 *
 * Engine Support:
 * | # | Feature                                       | Status      | Notes                                              |
 * |---|-----------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Playable only at Bag End                      | IMPLEMENTED | item-play-site restricts to the site by name       |
 * | 2 | Storable at Barad-dûr                         | IMPLEMENTED | storable-at sites match by site name               |
 * | 3 | 5 MP override when stored at Barad-dûr        | IMPLEMENTED | storable-at marshallingPoints override             |
 *
 * Fixture alignment: minion-resource-item (ringwraith), tests use minion
 * characters (LE) and minion sites.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { BAG_END_LE, BARAD_DUR_MINION, Alignment } from '../../index.js';
import type { CardDefinitionId, StoreItemAction } from '../../index.js';

const RED_BOOK = 'le-339' as CardDefinitionId;

// Minion fixtures — declared locally per card-ids.ts constants policy.
const GORBAG = 'le-11' as CardDefinitionId;              // orc, prowess 6
const GRISHNAKH = 'le-12' as CardDefinitionId;           // orc, prowess 4
const MINAS_MORGUL = 'le-390' as CardDefinitionId;       // minion darkhaven
const MORIA_MINION = 'le-392' as CardDefinitionId;       // minion shadow-hold

describe('Red Book of Westmarch (le-339)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: item-play-site (only playable at Bag End) ────────────────

  test('playable at Bag End (le-350) during site phase', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('NOT playable at Minas Morgul (darkhaven, not Bag End)', () => {
    const state = buildSitePhaseState({
      site: MINAS_MORGUL,
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Moria (shadow-hold, not Bag End)', () => {
    const state = buildSitePhaseState({
      site: MORIA_MINION,
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Barad-dûr (dark-hold, not Bag End)', () => {
    const state = buildSitePhaseState({
      site: BARAD_DUR_MINION,
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('unique: a second copy cannot be played while one is already attached', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      characters: [{ defId: GORBAG, items: [RED_BOOK] }],
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Effects 2 & 3: storable-at Barad-dûr for 5 MP ─────────────────────

  test('store-item action is viable when bearer is at Barad-dûr', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR_MINION, characters: [{ defId: GORBAG, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const store = storeActions[0].action as StoreItemAction;
    expect(store.itemInstanceId).toBeDefined();
  });

  test('store-item NOT viable at Minas Morgul (darkhaven, not Barad-dûr)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [{ defId: GORBAG, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GRISHNAKH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('store-item NOT viable at Moria (shadow-hold, not Barad-dûr)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [{ defId: GORBAG, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('dispatching store-item moves Red Book to out-of-play pile and triggers corruption check', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR_MINION, characters: [{ defId: GORBAG, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const storeActions = viableActions(base, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const afterStore = dispatch(base, storeActions[0].action);

    // Item removed from bearer
    const gorbag = Object.values(afterStore.players[RESOURCE_PLAYER].characters)[0];
    expect(gorbag.items).toHaveLength(0);

    // Item added to out-of-play pile
    expect(afterStore.players[RESOURCE_PLAYER].outOfPlayPile).toHaveLength(1);
    expect(afterStore.players[RESOURCE_PLAYER].outOfPlayPile[0].definitionId).toBe(RED_BOOK);

    // Storing enqueues a corruption check on the bearer
    const cc = afterStore.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
  });

  test('stored Red Book earns 5 MP at Barad-dûr (storable-at MP override)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR_MINION, characters: [{ defId: GORBAG, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    // Before storing: 2 MP from item held on character
    expect(base.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);

    const storeActions = viableActions(base, PLAYER_1, 'store-item');
    const afterStore = dispatch(base, storeActions[0].action);

    // After storing: 5 MP from stored item (override)
    expect(afterStore.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(5);
  });

  test('Red Book held on character earns base 2 MP', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END_LE, characters: [{ defId: GORBAG, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });
});
