/**
 * @module le-253.test
 *
 * Card test: Weigh All Things to a Nicety (le-253)
 * Type: minion-resource-event (short)
 * Effects: 1 (fetch-to-deck from sideboard/discard-pile)
 *
 * "Bring one resource or character (including a Ringwraith) from your
 *  sideboard or discard pile into your play deck and shuffle."
 *
 * Effects tested:
 * 1. move (fetch-to-deck): when played as a short event during the long-event
 *    phase, enqueues a fetch sub-flow that lets the active player choose one
 *    minion resource or character (including a Ringwraith) from their sideboard
 *    or discard pile and shuffle it into their play deck.
 *
 * Fixture alignment: minion (ringwraith), so tests use LE minion sites and
 * minion resource/character cards.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, Alignment,
  ORC_PATROL,
  buildTestState, resetMint,
  viableActions, dispatch,
  handCardId, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, FetchFromPileAction } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const WEIGH_ALL_THINGS = 'le-253' as CardDefinitionId;

// Minion sites
const DOL_GULDUR   = 'le-367' as CardDefinitionId;  // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven
const BARAD_DUR    = 'le-352' as CardDefinitionId;  // dark-hold

// Minion characters for fixtures
const THE_MOUTH    = 'le-24' as CardDefinitionId;   // minion-character
const OSTISEN      = 'le-36' as CardDefinitionId;   // minion-character

// Ringwraith character (the "(including a Ringwraith)" case)
const ADUNAPHEL    = 'le-50' as CardDefinitionId;   // minion-character, race: ringwraith

// Minion resource items for fetch tests
const BLACK_MACE   = 'le-299' as CardDefinitionId;  // minion-resource-item

describe('Weigh All Things to a Nicety (le-253)', () => {
  beforeEach(() => resetMint());

  test('appears as playable short event in long-event phase', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].action.type).toBe('play-short-event');
  });

  test('playing the card enters fetch sub-flow with fetch-to-deck effect', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          sideboard: [BLACK_MACE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });

    expect(next.players[0].hand).toHaveLength(0);
    expect(next.pendingEffects).toHaveLength(1);
    expect(next.pendingEffects[0].type).toBe('card-effect');
    expect(next.pendingEffects[0].effect.type).toBe('fetch-to-deck');
  });

  test('fetch sub-flow shows eligible minion resource from sideboard', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          sideboard: [BLACK_MACE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });

    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    const sideboardFetches = fetchActions.filter(
      ea => (ea.action as FetchFromPileAction).source === 'sideboard',
    );
    expect(sideboardFetches).toHaveLength(1);
  });

  test('fetch sub-flow shows eligible minion resource from discard pile', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          discardPile: [BLACK_MACE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });

    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    expect((fetchActions[0].action as FetchFromPileAction).source).toBe('discard-pile');
  });

  test('fetch sub-flow shows eligible Ringwraith character — the "(including a Ringwraith)" case', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          discardPile: [ADUNAPHEL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });

    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    const adunId = state.players[0].discardPile[0].instanceId;
    expect((fetchActions[0].action as FetchFromPileAction).cardInstanceId).toBe(adunId);
  });

  test('fetching a card from sideboard moves it to play deck and shuffles', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          sideboard: [BLACK_MACE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const blackMaceId = state.players[0].sideboard[0].instanceId;
    const deckBefore = state.players[0].playDeck.length;

    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: blackMaceId,
      source: 'sideboard',
    });

    expect(afterFetch.players[0].playDeck.length).toBe(deckBefore + 1);
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(blackMaceId);
    expect(afterFetch.players[0].sideboard).toHaveLength(0);
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });

  test('fetching a card from discard pile moves it to play deck', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          discardPile: [BLACK_MACE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const blackMaceId = state.players[0].discardPile[0].instanceId;
    const deckBefore = state.players[0].playDeck.length;

    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });
    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: blackMaceId,
      source: 'discard-pile',
    });

    expect(afterFetch.players[0].playDeck.length).toBe(deckBefore + 1);
    expect(afterFetch.players[0].playDeck.map(c => c.instanceId)).toContain(blackMaceId);
    expect(afterFetch.players[0].discardPile.map(c => c.instanceId)).not.toContain(blackMaceId);
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });

  test('hazard cards in sideboard/discard are not eligible for fetch', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          sideboard: [ORC_PATROL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });

    const fetchActions = viableActions(next, PLAYER_1, 'fetch-from-pile');
    expect(fetchActions).toHaveLength(0);

    const passActions = viableActions(next, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('pass during fetch sub-flow skips the fetch; card ends in discard', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          sideboard: [BLACK_MACE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);

    const afterPlay = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(afterPass.players[0].sideboard).toHaveLength(1);
    expect(afterPass.players[0].discardPile.map(c => c.instanceId)).toContain(cardId);
    expect(afterPass.phaseState.phase).toBe(Phase.LongEvent);
  });

  test('opponent has no actions during fetch sub-flow', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          hand: [WEIGH_ALL_THINGS],
          siteDeck: [BARAD_DUR],
          sideboard: [BLACK_MACE],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [BARAD_DUR],
        },
      ],
    });

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });

    const opponentActions = computeLegalActions(next, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });
});
