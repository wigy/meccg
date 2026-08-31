/**
 * @module ba-31.test
 *
 * Card test: Rumours of Rings (ba-31)
 * Type: hero-resource-event (permanent), alignment wizard
 *
 * Text: "During your organization phase, you may take one ring special item
 * (except for The One Ring) from your sideboard or discard pile and place it
 * 'off to the side' with this card. This item gives no marshalling points.
 * A maximum of two items may be with this card at one time. You may play a
 * ring special item placed with this card as though it were in your hand.
 * You may start the game with this card in lieu of playing a minor item."
 *
 * Effects (data):
 *   - org-phase-fetch, from: [sideboard, discard-pile], to: "set-aside", maxCached: 2,
 *     filter: hero-resource-item, subtype special, keyword "ring", name != "The One Ring"
 *   - ring-cache-play-source
 *   - starting-company-placement
 *   - keywords: ["starting-item"]
 *
 * Engine support:
 * | # | Rule                                                            | Status |
 * |---|------------------------------------------------------------------|--------|
 * | 1 | Once-per-org-phase fetch of a ring special item from sideboard/  | OK     |
 * |   | discard pile, placed off to the side with this card              |        |
 * | 2 | The One Ring is excluded from fetch candidates                   | OK     |
 * | 3 | Non-ring items are excluded from fetch candidates                | OK     |
 * | 4 | Fetched item gives no marshalling points                         | OK     |
 * | 5 | Maximum of two items cached with this card at one time           | OK     |
 * | 6 | A cached ring may be played as though in hand at a ring-play-    | OK     |
 * |   | offer (Rule 9.21, after a gold-ring test)                        |        |
 * | 7 | May start the game with this card in lieu of a minor item        | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA,
  attachItemToChar, recomputeDerived,
  findCharInstanceId,
  viableActions, dispatch,
  enqueueGoldRingTest,
  assertEveryInstanceReachable,
  createGame, pool, draftInstId, runActions,
  PRECIOUS_GOLD_RING, DAGGER_OF_WESTERNESSE,
} from '../test-helpers.js';
import { Alignment, SetupStep, CardStatus, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameConfig,
  FetchFromPileAction, PlayRingAfterTestAction,
} from '../../index.js';

const RUMOURS_OF_RINGS = 'ba-31' as CardDefinitionId;
const LESSER_RING = 'tw-266' as CardDefinitionId; // hero-resource-item, subtype special, keywords [ring, lesser-ring]
const THE_ONE_RING = 'tw-347' as CardDefinitionId; // excluded by name from the fetch filter

const RUMOURS_INSTANCE = 'rumours-inst' as CardInstanceId;

function rumoursCardInPlay(setAside: readonly CardInstanceId[] = []): CardInPlay {
  return {
    instanceId: RUMOURS_INSTANCE,
    definitionId: RUMOURS_OF_RINGS,
    status: CardStatus.Untapped,
    ...(setAside.length > 0 ? { setAside } : {}),
  };
}

describe('Rumours of Rings (ba-31)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1/4: fetch a ring from sideboard/discard pile, off to the side, no MP ──

  test('fetching a ring special item from the sideboard places it off to the side with no marshalling points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [LESSER_RING],
          cardsInPlay: [rumoursCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const fetchActions = viableActions(state, PLAYER_1, 'activate-org-fetch');
    expect(fetchActions).toHaveLength(1);

    const activated = dispatch(state, fetchActions[0].action);
    const ringId = activated.players[RESOURCE_PLAYER].sideboard.find(c => c.definitionId === LESSER_RING)!.instanceId;

    const pick = viableActions(activated, PLAYER_1, 'fetch-from-pile')
      .find(a => (a.action as FetchFromPileAction).cardInstanceId === ringId);
    expect(pick).toBeDefined();
    expect((pick!.action as FetchFromPileAction).to).toBe('set-aside');

    const after = dispatch(activated, pick!.action);

    expect(after.players[RESOURCE_PLAYER].sideboard.some(c => c.instanceId === ringId)).toBe(false);
    const setAsideEntry = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === ringId);
    expect(setAsideEntry).toBeDefined();
    expect(setAsideEntry!.setAsideHost).toBe(RUMOURS_INSTANCE);
    expect(setAsideEntry!.setAsideNoMp).toBe(true);
    const host = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === RUMOURS_INSTANCE)!;
    expect(host.setAside).toEqual([ringId]);

    // Rumours of Rings itself stays in play (skipDiscard) — the fetch does not consume it.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === RUMOURS_INSTANCE)).toBe(true);

    const recomputed = recomputeDerived(after);
    expect(recomputed.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);

    assertEveryInstanceReachable(after);
  });

  test('also fetches a ring from the discard pile', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          discardPile: [LESSER_RING],
          cardsInPlay: [rumoursCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const ringId = state.players[RESOURCE_PLAYER].discardPile[0].instanceId;
    const activated = dispatch(state, viableActions(state, PLAYER_1, 'activate-org-fetch')[0].action);
    const pick = viableActions(activated, PLAYER_1, 'fetch-from-pile')
      .find(a => (a.action as FetchFromPileAction).cardInstanceId === ringId);
    expect(pick).toBeDefined();
    expect((pick!.action as FetchFromPileAction).source).toBe('discard-pile');

    const after = dispatch(activated, pick!.action);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === ringId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === ringId)?.setAsideHost).toBe(RUMOURS_INSTANCE);
  });

  // ── Rule 2: The One Ring is excluded ──

  test('The One Ring is not offered as a fetch candidate', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [THE_ONE_RING],
          cardsInPlay: [rumoursCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    // The only card in the sideboard is The One Ring, which the filter excludes —
    // so there is no eligible candidate and the activation itself is not offered.
    expect(viableActions(state, PLAYER_1, 'activate-org-fetch')).toHaveLength(0);
  });

  // ── Rule 3: non-ring items are excluded ──

  test('non-ring minor items are not offered as fetch candidates', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [DAGGER_OF_WESTERNESSE, LESSER_RING],
          cardsInPlay: [rumoursCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const activated = dispatch(state, viableActions(state, PLAYER_1, 'activate-org-fetch')[0].action);
    const candidateIds = viableActions(activated, PLAYER_1, 'fetch-from-pile')
      .map(a => (a.action as FetchFromPileAction).cardInstanceId);

    const daggerId = state.players[RESOURCE_PLAYER].sideboard.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!.instanceId;
    const ringId = state.players[RESOURCE_PLAYER].sideboard.find(c => c.definitionId === LESSER_RING)!.instanceId;
    expect(candidateIds).toContain(ringId);
    expect(candidateIds).not.toContain(daggerId);
  });

  // ── Rule 5: maximum of two items cached at one time ──

  test('the fetch is not offered once two items are already cached with this card', () => {
    const cachedIds = ['cached-1', 'cached-2'] as CardInstanceId[];
    const cardsInPlay: CardInPlay[] = [
      rumoursCardInPlay(cachedIds),
      ...cachedIds.map(id => ({
        instanceId: id, definitionId: LESSER_RING, status: CardStatus.Untapped,
        setAsideHost: RUMOURS_INSTANCE, setAsideNoMp: true,
      })),
    ];
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [LESSER_RING],
          cardsInPlay,
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'activate-org-fetch')).toHaveLength(0);
  });

  test('the fetch activation cannot be used again this organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [LESSER_RING, LESSER_RING],
          cardsInPlay: [rumoursCardInPlay()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const activated = dispatch(state, viableActions(state, PLAYER_1, 'activate-org-fetch')[0].action);
    const pick = viableActions(activated, PLAYER_1, 'fetch-from-pile')[0].action;
    const after = dispatch(activated, pick);

    // A second matching ring is still in the sideboard and the cache still has
    // room (1/2), but the once-per-organization-phase activation is spent.
    expect(viableActions(after, PLAYER_1, 'activate-org-fetch')).toHaveLength(0);
  });

  // ── Rule 6: a cached ring may be played as though in hand at a ring-play-offer ──

  test('a ring cached with Rumours of Rings is offered and playable at a ring-play-offer', () => {
    const cachedRingId = 'cached-ring' as CardInstanceId;
    const cardsInPlay: CardInPlay[] = [
      rumoursCardInPlay([cachedRingId]),
      { instanceId: cachedRingId, definitionId: LESSER_RING, status: CardStatus.Untapped, setAsideHost: RUMOURS_INSTANCE, setAsideNoMp: true },
    ];
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;

    // tw-306's test table: lesser-ring is eligible on any roll; a total of 7
    // excludes magic-ring (1-5) and dwarven-ring (8+), leaving only lesser-ring.
    const withPending = enqueueGoldRingTest(state, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 7 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const plays = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')
      .filter(a => (a.action as PlayRingAfterTestAction).ringInstanceId === cachedRingId);
    expect(plays).toHaveLength(1);
    expect((plays[0].action as PlayRingAfterTestAction).source).toBe('set-aside');

    const after = dispatch(afterRoll, plays[0].action);

    expect(after.players[RESOURCE_PLAYER].characters[aragornId].items.some(i => i.instanceId === cachedRingId)).toBe(true);
    // Pulled out of the cache: gone from cardsInPlay as a standalone entry, host's list empty.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cachedRingId)).toBe(false);
    const host = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === RUMOURS_INSTANCE)!;
    expect(host.setAside).toBeUndefined();

    assertEveryInstanceReachable(after);
  });

  // ── Rule 7: may start the game with this card in lieu of a minor item ──

  test('may be placed with a starting company during item-draft in lieu of a minor item', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN],
          playDeck: [RUMOURS_OF_RINGS],
          siteDeck: [RIVENDELL, MORIA],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [LEGOLAS],
          playDeck: [],
          siteDeck: [LORIEN, MORIA],
          sideboard: [],
        },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ARAGORN) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, LEGOLAS) },
    ]);

    expect(state.phaseState.phase).toBe('setup');
    if (state.phaseState.phase !== 'setup') return;
    expect(state.phaseState.setupStep.step).toBe(SetupStep.ItemDraft);

    const actions = computeLegalActions(state, PLAYER_1);
    const placeActions = actions.filter(a => a.viable && a.action.type === 'place-starting-company-event');
    expect(placeActions.length).toBeGreaterThanOrEqual(1);
    expect((placeActions[0].action as { cardDefId: CardDefinitionId }).cardDefId).toBe(RUMOURS_OF_RINGS);

    const placed = dispatch(state, placeActions[0].action);
    if (placed.phaseState.phase !== 'setup') throw new Error('expected setup phase');
    expect(
      placed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === RUMOURS_OF_RINGS),
    ).toBe(true);
    expect(
      placed.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === RUMOURS_OF_RINGS),
    ).toBe(false);
  });
});
