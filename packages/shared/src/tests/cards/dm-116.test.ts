/**
 * @module dm-116.test
 *
 * Card test: Armory (dm-116)
 * Type: hero-resource-event (permanent), non-unique
 *
 * Card text: "Only you and your companies can use Armory. You may place any
 * minor items from your hand under Armory during your organization phase. A
 * character at a Haven [{H}] can store a minor item under Armory instead of
 * to your marshalling point pile. When you otherwise would be allowed to
 * play a minor item from your hand at a Border-hold [{B}], Free-hold [{F}],
 * or Haven [{H}], you may play an item from under Armory instead. If you
 * have at least three minor items under Armory, gain 1 marshalling point."
 *
 * Effects (data):
 *   - item-cache-hand-store, subtypes: [minor]
 *   - item-cache-alt-storage, siteTypes: [haven], subtypes: [minor]
 *   - item-cache-play-source, siteTypes: [border-hold, free-hold, haven]
 *   - item-cache-count-bonus, count: 3, mp: 1
 *
 * Engine support:
 * | # | Rule                                                          | Status |
 * |---|----------------------------------------------------------------|--------|
 * | 1 | Only the controller (not the opponent) may use Armory          | OK     |
 * | 2 | Minor items may be moved from hand under Armory during org.    | OK     |
 * | 3 | Items placed under Armory score no individual marshalling pts  | OK     |
 * | 4 | A minor item may be stored under Armory instead of the MP pile | OK     |
 * |   | at a Haven (corruption check still runs)                       |        |
 * | 5 | No cache-storage offered where the base store-item rule        | OK     |
 * |   | wouldn't apply (non-Haven)                                     |        |
 * | 6 | Items under Armory playable as though in hand at a Border-hold,| OK     |
 * |   | Free-hold, or Haven                                            |        |
 * | 7 | NOT playable as though in hand at other site types (Moria)     | OK     |
 * | 8 | +1 marshalling point once 3+ minor items are under Armory      | OK     |
 * | 9 | No bonus with fewer than three items under Armory              | OK     |
 *
 * Player-index convention: PLAYER_1/RESOURCE_PLAYER owns Armory throughout.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  CRAM, SCROLL_OF_ISILDUR,
  RIVENDELL, LORIEN, MORIA,
  buildTestState, buildSitePhaseState, resetMint, makePlayDeck,
  viableActions, findHandCardId, findCharInstanceId,
  dispatch, recomputeDerived,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { CardStatus, Phase, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState,
  StoreItemAction, StoreItemInCacheAction, PlayHeroResourceAction,
} from '../../index.js';

const ARMORY = 'dm-116' as CardDefinitionId;
const RHOSGOBEL = 'tw-420' as CardDefinitionId; // hero free-hold, playableResources: [minor]

const ARMORY_INSTANCE = 'armory-inst' as CardInstanceId;

function armoryCardInPlay(): CardInPlay {
  return { instanceId: ARMORY_INSTANCE, definitionId: ARMORY, status: CardStatus.Untapped };
}

describe('Armory (dm-116)', () => {
  beforeEach(() => resetMint());

  // ── #1: only the controller may use Armory ──────────────────────────────

  test('the opponent cannot place items under your Armory from their own hand', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          cardsInPlay: [armoryCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CRAM], siteDeck: [MORIA] },
      ],
    });
    expect(viableActions(state, PLAYER_2, 'store-item-in-cache')).toHaveLength(0);
  });

  // ── #2/#3: place minor items from hand under Armory, no MP ──────────────

  test('minor items in hand may be placed under Armory during the organization phase; other subtypes may not', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [CRAM, SCROLL_OF_ISILDUR],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          cardsInPlay: [armoryCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const cramId = findHandCardId(state, RESOURCE_PLAYER, CRAM);
    const scrollId = findHandCardId(state, RESOURCE_PLAYER, SCROLL_OF_ISILDUR);
    const actions = viableActions(state, PLAYER_1, 'store-item-in-cache')
      .map(a => a.action as StoreItemInCacheAction);

    expect(actions.some(a => a.itemInstanceId === cramId && a.hostInstanceId === ARMORY_INSTANCE)).toBe(true);
    expect(actions.some(a => a.itemInstanceId === scrollId)).toBe(false);
  });

  test('a hand item offered via store-item-in-cache is not also reported as not-playable', () => {
    // Regression: the generic not-playable sweep in legal-actions/index.ts
    // keyed coverage off cardInstanceId/characterInstanceId/viaEventInstanceId
    // only, missing itemInstanceId — so a minor item whose sole action was
    // store-item-in-cache got a spurious "cannot be played" entry stacked
    // alongside the genuinely viable one, and clients that key off card
    // playability by instance ID (rather than by exact action) treated the
    // item as unplayable (bug report: game mtasepv8-2pzfv3, turn 12 org phase).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [CRAM],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          cardsInPlay: [armoryCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const cramId = findHandCardId(state, RESOURCE_PLAYER, CRAM);
    const allActions = computeLegalActions(state, PLAYER_1);
    const notPlayable = allActions.filter(
      a => a.action.type === 'not-playable' && (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === cramId,
    );
    expect(notPlayable).toHaveLength(0);
  });

  test('placing a minor item under Armory from hand moves it to the set-aside pile with no marshalling points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [CRAM],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          cardsInPlay: [armoryCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cramId = findHandCardId(state, RESOURCE_PLAYER, CRAM);

    const after = dispatch(state, { type: 'store-item-in-cache', player: PLAYER_1, itemInstanceId: cramId, hostInstanceId: ARMORY_INSTANCE });

    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cramId)).toBe(false);
    const setAsideEntry = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cramId);
    expect(setAsideEntry).toBeDefined();
    expect(setAsideEntry!.setAsideHost).toBe(ARMORY_INSTANCE);
    expect(setAsideEntry!.setAsideNoMp).toBe(true);
    const host = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === ARMORY_INSTANCE)!;
    expect(host.setAside).toEqual([cramId]);

    const recomputed = recomputeDerived(after);
    expect(recomputed.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);

    assertEveryInstanceReachable(after);
  });

  // ── #4/#5: alternate storage destination at a Haven ─────────────────────

  test('a character at a Haven may store a minor item under Armory instead of the marshalling-point pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [CRAM] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          cardsInPlay: [armoryCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'store-item').map(a => a.action as StoreItemAction);
    expect(actions.some(a => a.cacheHostInstanceId === undefined)).toBe(true);
    expect(actions.some(a => a.cacheHostInstanceId === ARMORY_INSTANCE)).toBe(true);
  });

  test('storing under Armory moves the item to its set-aside pile and still enqueues a corruption check', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [CRAM] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          cardsInPlay: [armoryCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const cramId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

    const after = dispatch(state, {
      type: 'store-item',
      player: PLAYER_1,
      itemInstanceId: cramId,
      characterId: aragornId,
      cacheHostInstanceId: ARMORY_INSTANCE,
    });

    expect(after.players[RESOURCE_PLAYER].characters[aragornId].items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === cramId)).toBe(false);
    const setAsideEntry = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cramId);
    expect(setAsideEntry?.setAsideHost).toBe(ARMORY_INSTANCE);
    expect(setAsideEntry?.setAsideNoMp).toBe(true);

    const pendingCheck = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && (r.kind as { characterId: CardInstanceId }).characterId === aragornId,
    );
    expect(pendingCheck).toBeDefined();

    assertEveryInstanceReachable(after);
  });

  test('control: no cache-storage destination is offered at a non-Haven site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [CRAM] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
          playDeck: makePlayDeck(),
          cardsInPlay: [armoryCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'store-item')).toHaveLength(0);
  });

  // ── #6/#7: play a cached item as though in hand at Border-hold/Free-hold/Haven ──

  test('an item stored under Armory is playable as though in hand at a Free-hold', () => {
    const itemId = 'cached-item' as CardInstanceId;
    const hostAndChild: CardInPlay[] = [
      { instanceId: ARMORY_INSTANCE, definitionId: ARMORY, status: CardStatus.Untapped, setAside: [itemId] },
      { instanceId: itemId, definitionId: CRAM, status: CardStatus.Untapped, setAsideHost: ARMORY_INSTANCE, setAsideNoMp: true },
    ];

    const base = buildSitePhaseState({ site: RHOSGOBEL, characters: [ARAGORN], hand: [] });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], cardsInPlay: hostAndChild },
        base.players[1],
      ] as typeof base.players,
    };

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(a => (a.action as PlayHeroResourceAction).cardInstanceId === itemId);
    expect(plays).toHaveLength(1);
    expect((plays[0].action as PlayHeroResourceAction).fromSetAside).toBe(true);

    const played = dispatch(state, plays[0].action);
    const aragornId = played.players[RESOURCE_PLAYER].companies[0].characters[0];
    expect(played.players[RESOURCE_PLAYER].characters[aragornId].items.some(i => i.instanceId === itemId)).toBe(true);

    // Pulled out of the set-aside slot: gone from cardsInPlay as a standalone entry, host's list empty.
    const host = played.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === ARMORY_INSTANCE)!;
    expect(host.setAside).toBeUndefined();

    assertEveryInstanceReachable(played);
  });

  test('control: an item stored under Armory is NOT offered as though in hand at Moria (shadow-hold)', () => {
    const itemId = 'cached-item' as CardInstanceId;
    const hostAndChild: CardInPlay[] = [
      { instanceId: ARMORY_INSTANCE, definitionId: ARMORY, status: CardStatus.Untapped, setAside: [itemId] },
      { instanceId: itemId, definitionId: CRAM, status: CardStatus.Untapped, setAsideHost: ARMORY_INSTANCE, setAsideNoMp: true },
    ];

    // Moria's own playableResources includes "minor" — so the site type gate,
    // not the resource-type gate, is what suppresses the offer here.
    const base = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [] });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], cardsInPlay: hostAndChild },
        base.players[1],
      ] as typeof base.players,
    };

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(a => (a.action as PlayHeroResourceAction).cardInstanceId === itemId);
    expect(plays).toHaveLength(0);
  });

  // ── #8/#9: +1 marshalling point once 3+ minor items are stored ──────────

  test('gains 1 marshalling point once at least three minor items are stored under Armory', () => {
    const itemIds = ['item-1', 'item-2', 'item-3'] as CardInstanceId[];
    const cardsInPlay: CardInPlay[] = [
      { instanceId: ARMORY_INSTANCE, definitionId: ARMORY, status: CardStatus.Untapped, setAside: itemIds },
      ...itemIds.map(id => ({ instanceId: id, definitionId: CRAM, status: CardStatus.Untapped, setAsideHost: ARMORY_INSTANCE, setAsideNoMp: true })),
    ];
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck(), cardsInPlay },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  test('no bonus with fewer than three items stored under Armory', () => {
    const itemIds = ['item-1', 'item-2'] as CardInstanceId[];
    const cardsInPlay: CardInPlay[] = [
      { instanceId: ARMORY_INSTANCE, definitionId: ARMORY, status: CardStatus.Untapped, setAside: itemIds },
      ...itemIds.map(id => ({ instanceId: id, definitionId: CRAM, status: CardStatus.Untapped, setAsideHost: ARMORY_INSTANCE, setAsideNoMp: true })),
    ];
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck(), cardsInPlay },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });
});
