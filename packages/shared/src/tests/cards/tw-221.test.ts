/**
 * @module tw-221.test
 *
 * Card test: Earth of Galadriel's Orchard (tw-221)
 * Type: hero-resource-item (special)
 * Effects: 2 (item-play-site, storable-at)
 *
 * "Unique. Only playable at Lórien. 2 marshalling points if stored at
 *  Bag End."
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                       |
 * |---|-----------------------------------------|-------------|----------------------------------------------|
 * | 1 | Playable only at Lórien                | IMPLEMENTED | item-play-site restricts to the site by name |
 * | 2 | Storable at Bag End                    | IMPLEMENTED | storable-at sites match site.name            |
 * | 3 | 2 MP override when stored at Bag End   | IMPLEMENTED | storable-at marshallingPoints override        |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, RIVENDELL,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, StoreItemAction } from '../../index.js';
import { computeLegalActions, BAG_END } from '../../index.js';

const EARTH_OF_GALADRIELS_ORCHARD = 'tw-221' as CardDefinitionId;

describe("Earth of Galadriel's Orchard (tw-221)", () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: item-play-site (only playable at Lórien) ─────────────────

  test('playable at Lórien during site phase', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [EARTH_OF_GALADRIELS_ORCHARD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('playing the card attaches it to a character at Lórien', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [ARAGORN],
      hand: [EARTH_OF_GALADRIELS_ORCHARD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const next = dispatch(state, plays[0].action);
    const aragorn = Object.values(next.players[0].characters)[0];
    expect(aragorn.items.some(i => i.definitionId === EARTH_OF_GALADRIELS_ORCHARD)).toBe(true);
  });

  test('NOT playable at Bag End (free-hold, not Lórien)', () => {
    const state = buildSitePhaseState({
      site: BAG_END,
      characters: [ARAGORN],
      hand: [EARTH_OF_GALADRIELS_ORCHARD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Minas Tirith (free-hold, not Lórien)', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ARAGORN],
      hand: [EARTH_OF_GALADRIELS_ORCHARD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Moria (shadow-hold, not Lórien)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [EARTH_OF_GALADRIELS_ORCHARD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Rivendell (haven, not Lórien)', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      characters: [ARAGORN],
      hand: [EARTH_OF_GALADRIELS_ORCHARD],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Effect 2: storable-at Bag End, 2 MP override ────────────────────────

  test('store-item action is viable when the bearer is at Bag End', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: ARAGORN, items: [EARTH_OF_GALADRIELS_ORCHARD] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const store = storeActions[0].action as StoreItemAction;
    expect(store.itemInstanceId).toBeDefined();
  });

  test('store-item action is NOT viable at Rivendell (a Haven, but not Bag End)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [EARTH_OF_GALADRIELS_ORCHARD] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const storeActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('store-item action is NOT viable at Lórien (playable site, but not storable there)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [EARTH_OF_GALADRIELS_ORCHARD] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const storeActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('stored Earth of Galadriel’s Orchard earns 2 MP (override from storable-at effect)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: ARAGORN, items: [EARTH_OF_GALADRIELS_ORCHARD] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });

    // Before storing: base MP (0) from item on character
    expect(base.players[0].marshallingPoints.item).toBe(0);

    const storeActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    const afterStore = dispatch(base, storeActions[0]);

    // After storing at Bag End: 2 MP (override)
    expect(afterStore.players[0].marshallingPoints.item).toBe(2);
  });

  test('on character (not stored) earns base 0 MP', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: ARAGORN, items: [EARTH_OF_GALADRIELS_ORCHARD] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
      recompute: true,
    });

    expect(base.players[0].marshallingPoints.item).toBe(0);
  });
});
