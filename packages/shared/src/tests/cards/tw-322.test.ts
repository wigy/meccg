/**
 * @module tw-322.test
 *
 * Card test: Sapling of the White Tree (tw-322)
 * Type: hero-resource-item (major)
 * Effects: 1 (storable-at Minas Tirith with 2 MP override)
 *
 * "Not playable in a Shadow-hold or Dark-hold. May be stored at Minas
 *  Tirith. 2 marshalling points if stored at Minas Tirith."
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                  |
 * |---|-------------------------------------------|-------------|----------------------------------------|
 * | 1 | Not playable in Shadow-hold / Dark-hold    | IMPLEMENTED | playableAt restricts to ruins-and-lairs |
 * | 2 | Storable at Minas Tirith                   | IMPLEMENTED | storable-at effect + store-item action  |
 * | 3 | 2 MP if stored at Minas Tirith             | IMPLEMENTED | storable-at marshallingPoints override  |
 *
 * Certified: 2026-04-13
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase,
  ARAGORN, LEGOLAS,
  SAPLING_OF_THE_WHITE_TREE,
  MINAS_TIRITH, LORIEN, MORIA, RIVENDELL,
  buildTestState, resetMint,
  dispatch,
} from '../test-helpers.js';
import type { StoreItemAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

describe('Sapling of the White Tree (tw-322)', () => {
  beforeEach(() => resetMint());

  // ── Card definition ──


  // ── Playability restrictions ──

  test('not playable at shadow-hold (Moria) — playableAt restricts to ruins-and-lairs only', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [SAPLING_OF_THE_WHITE_TREE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const allActions = computeLegalActions(state, PLAYER_1);
    const saplingPlays = allActions
      .filter(ea => ea.viable && (ea.action.type === 'play-hero-resource' || ea.action.type === 'play-minor-item'))
      .filter(ea => {
        const a = ea.action as { cardInstanceId?: string };
        const card = state.players[0].hand.find(c => c.instanceId === a.cardInstanceId);
        return card?.definitionId === SAPLING_OF_THE_WHITE_TREE;
      });
    expect(saplingPlays).toHaveLength(0);
  });

  test('not playable at a free-hold (Minas Tirith) — playableAt restricts to ruins-and-lairs only', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [SAPLING_OF_THE_WHITE_TREE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const allActions = computeLegalActions(state, PLAYER_1);
    const saplingPlays = allActions
      .filter(ea => ea.viable && (ea.action.type === 'play-hero-resource' || ea.action.type === 'play-minor-item'))
      .filter(ea => {
        const a = ea.action as { cardInstanceId?: string };
        const card = state.players[0].hand.find(c => c.instanceId === a.cardInstanceId);
        return card?.definitionId === SAPLING_OF_THE_WHITE_TREE;
      });
    expect(saplingPlays).toHaveLength(0);
  });

  // ── Storage at Minas Tirith ──

  test('store-item action is available when character with Sapling is at Minas Tirith', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const storeActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    expect(storeActions).toHaveLength(1);
    expect(storeActions[0].player).toBe(PLAYER_1);
  });

  test('store-item action is NOT available when character is at a different site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const storeActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('dispatching store-item removes item from character and adds to outOfPlayPile', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const storeActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    expect(storeActions).toHaveLength(1);

    const afterStore = dispatch(base, storeActions[0]);
    const player = afterStore.players[0];

    // Item removed from character
    const aragornChar = Object.values(player.characters)[0];
    expect(aragornChar.items).toHaveLength(0);

    // Item added to out-of-play pile
    expect(player.outOfPlayPile).toHaveLength(1);
    expect(player.outOfPlayPile[0].definitionId).toBe(SAPLING_OF_THE_WHITE_TREE);
  });

  test('storing triggers a corruption check on the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const storeActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    const afterStore = dispatch(base, storeActions[0]);

    expect(afterStore.pendingResolutions.length).toBeGreaterThanOrEqual(1);
    const ccResolution = afterStore.pendingResolutions.find(
      r => r.kind.type === 'corruption-check',
    );
    expect(ccResolution).toBeDefined();
  });

  // ── Marshalling Points ──

  test('stored Sapling earns 2 MP (override from storable-at effect)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
      recompute: true,
    });

    // Before storing: 1 MP from item on character
    expect(base.players[0].marshallingPoints.item).toBe(1);

    // Dispatch store-item
    const storeActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    const afterStore = dispatch(base, storeActions[0]);

    // After storing: 2 MP from stored item (override)
    expect(afterStore.players[0].marshallingPoints.item).toBe(2);
  });

  test('Sapling on character earns base 1 MP', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [SAPLING_OF_THE_WHITE_TREE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });

    expect(base.players[0].marshallingPoints.item).toBe(1);
  });
});
