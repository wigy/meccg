/**
 * @module as-101.test
 *
 * Card test: Tokens to Show (as-101)
 * Type: minion-resource-event (permanent)
 *
 * "Minion characters may store resources (items and events) during the
 *  end-of-turn phase as though it were their organization phase.
 *  Cannot be duplicated. Discard when any play deck is exhausted."
 *
 * Effects tested:
 * 1. play-flag allow-store-eot: store-item actions appear during EOT discard
 *    and signal-end steps when this event is in the active player's cardsInPlay.
 * 2. play-flag allow-store-eot: store-item actions are absent during EOT when
 *    this event is NOT in cardsInPlay.
 * 3. on-event play-deck-exhausted: card moves to discard pile when a play
 *    deck exhaust completes (during EOT reset-hand).
 * 4. duplication-limit scope:game max:1: cannot be played while a copy is
 *    already in cardsInPlay.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  addCardInPlay, attachItemToChar,
  dispatch,
  RESOURCE_PLAYER,
  expectInDiscardPile, expectInPile,
} from '../test-helpers.js';
import type { CardDefinitionId, StoreItemAction, EndOfTurnPhaseState } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const TOKENS_TO_SHOW = 'as-101' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const WULUAG = 'as-6' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const CARN_DUM_MINION = 'le-359' as CardDefinitionId;
const SABLE_SHIELD = 'le-341' as CardDefinitionId;
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;

describe('Tokens to Show (as-101)', () => {
  beforeEach(() => resetMint());

  test('store-item action offered during EOT discard step when card is in play', () => {
    // Perchen at Dol Guldur (minion haven) holds Sable Shield (major item, storable at havens).
    // Tokens to Show is in cardsInPlay. The store-item action must appear.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [CARN_DUM_MINION] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, PERCHEN, SABLE_SHIELD);
    const withEvent = addCardInPlay(withItem, RESOURCE_PLAYER, TOKENS_TO_SHOW);

    const actions = computeLegalActions(withEvent, PLAYER_1);
    const storeActions = actions
      .filter(a => a.viable && a.action.type === 'store-item')
      .map(a => a.action as StoreItemAction);

    expect(storeActions.length).toBeGreaterThan(0);
  });

  test('store-item action not offered during EOT when card is NOT in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [CARN_DUM_MINION] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, PERCHEN, SABLE_SHIELD);

    const actions = computeLegalActions(withItem, PLAYER_1);
    const storeActions = actions.filter(a => a.viable && a.action.type === 'store-item');

    expect(storeActions).toHaveLength(0);
  });

  test('store-item action offered during EOT signal-end step when card is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [CARN_DUM_MINION] },
      ],
    });
    const withSignalEnd = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'signal-end' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withItem = attachItemToChar(withSignalEnd, RESOURCE_PLAYER, PERCHEN, SABLE_SHIELD);
    const withEvent = addCardInPlay(withItem, RESOURCE_PLAYER, TOKENS_TO_SHOW);

    const actions = computeLegalActions(withEvent, PLAYER_1);
    const storeActions = actions.filter(a => a.viable && a.action.type === 'store-item');

    expect(storeActions.length).toBeGreaterThan(0);
  });

  test('store-item executes correctly during EOT — item moves to MP pile', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [CARN_DUM_MINION] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, PERCHEN, SABLE_SHIELD);
    const withEvent = addCardInPlay(withItem, RESOURCE_PLAYER, TOKENS_TO_SHOW);

    const storeAction = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'store-item')[0];
    expect(storeAction).toBeDefined();

    const afterStore = dispatch(withEvent, storeAction.action);

    const perchenChar = Object.values(afterStore.players[RESOURCE_PLAYER].characters)
      .find(c => c.definitionId === PERCHEN);
    expect(perchenChar).toBeDefined();
    expect(perchenChar!.items.some(i => i.definitionId === SABLE_SHIELD)).toBe(false);
    expect(afterStore.players[RESOURCE_PLAYER].killPile.some(
      i => i.definitionId === SABLE_SHIELD,
    )).toBe(true);
  });

  test('card discards when active player deck exhaust completes during EOT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [CARN_DUM_MINION],
          playDeck: [],
          discardPile: [STRANGE_RATIONS],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }],
          hand: [],
          siteDeck: [CARN_DUM_MINION],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, TOKENS_TO_SHOW);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].deckExhaustPending).toBe(true);
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === TOKENS_TO_SHOW,
    )).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    // Tokens to Show discards, but since it's P1's own deck exhausting,
    // CRF 22 "Exhausted" shuffles it into the new play deck along with the
    // rest of the discard pile rather than leaving it in discardPile.
    expectInPile(afterPass, RESOURCE_PLAYER, 'playDeck', TOKENS_TO_SHOW);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === TOKENS_TO_SHOW,
    )).toBe(false);
  });

  test('card discards when opponent deck exhaust completes during EOT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [CARN_DUM_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }],
          hand: [],
          siteDeck: [CARN_DUM_MINION],
          playDeck: [],
          discardPile: [STRANGE_RATIONS],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, TOKENS_TO_SHOW);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });

    expectInDiscardPile(afterPass, RESOURCE_PLAYER, TOKENS_TO_SHOW);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === TOKENS_TO_SHOW,
    )).toBe(false);
  });

  test('cannot be duplicated — not playable when copy already in cardsInPlay', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }],
          hand: [TOKENS_TO_SHOW],
          siteDeck: [CARN_DUM_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }],
          hand: [],
          siteDeck: [CARN_DUM_MINION],
        },
      ],
    });
    const withEvent = addCardInPlay(base, RESOURCE_PLAYER, TOKENS_TO_SHOW);

    const playActions = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.action.type === 'play-permanent-event');

    expect(playActions.every(a => !a.viable)).toBe(true);
  });

  test('can be played normally when no copy is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }],
          hand: [TOKENS_TO_SHOW],
          siteDeck: [CARN_DUM_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }],
          hand: [],
          siteDeck: [CARN_DUM_MINION],
        },
      ],
    });

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event');

    expect(playActions.length).toBeGreaterThan(0);
  });
});
