/**
 * @module as-54.test
 *
 * Card test: Safe from the Shadow (as-54)
 * Type: hero-resource-event (permanent)
 *
 * "Hero characters may store resources (items and events) during the
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
 * 5. play-flag allow-store-eot: the non-active player's own storing window is
 *    not restricted to their own turn — it appears during the opponent's
 *    end-of-turn phase too (discard and signal-end steps), since the card's
 *    text grants the window "during the end-of-turn phase" generally, not
 *    only during one's own organization phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  eotState, addCardInPlay, attachItemToChar,
  dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectInDiscardPile,
  SAPLING_OF_THE_WHITE_TREE,
} from '../test-helpers.js';
import type { CardDefinitionId, StoreItemAction, EndOfTurnPhaseState } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const SAFE_FROM_THE_SHADOW = 'as-54' as CardDefinitionId;
const RED_BOOK_OF_WESTMARCH = 'tw-313' as CardDefinitionId;

describe('Safe from the Shadow (as-54)', () => {
  beforeEach(() => resetMint());

  test('store-item action offered during EOT discard step when card is in play', () => {
    // Aragorn at Rivendell (haven) holds Red Book of Westmarch (storable at havens).
    // Safe from the Shadow is in cardsInPlay. The store-item action must appear.
    const base = eotState();
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK_OF_WESTMARCH);
    const withEvent = addCardInPlay(withItem, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);

    const actions = computeLegalActions(withEvent, PLAYER_1);
    const storeActions = actions
      .filter(a => a.viable && a.action.type === 'store-item')
      .map(a => a.action as StoreItemAction);

    expect(storeActions.length).toBeGreaterThan(0);
  });

  test('store-item action not offered during EOT when card is NOT in play', () => {
    // Same setup but without Safe from the Shadow in cardsInPlay.
    const base = eotState();
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK_OF_WESTMARCH);

    const actions = computeLegalActions(withItem, PLAYER_1);
    const storeActions = actions.filter(a => a.viable && a.action.type === 'store-item');

    expect(storeActions).toHaveLength(0);
  });

  test('store-item action offered during EOT signal-end step when card is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    // Advance to signal-end step
    const withSignalEnd = {
      ...base,
      phaseState: { ...(base.phaseState as EndOfTurnPhaseState), step: 'signal-end' as const, discardDone: [true, true] as [boolean, boolean], resetHandDone: [true, true] as [boolean, boolean] } as EndOfTurnPhaseState,
    };
    const withItem = attachItemToChar(withSignalEnd, RESOURCE_PLAYER, ARAGORN, RED_BOOK_OF_WESTMARCH);
    const withEvent = addCardInPlay(withItem, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);

    const actions = computeLegalActions(withEvent, PLAYER_1);
    const storeActions = actions.filter(a => a.viable && a.action.type === 'store-item');

    expect(storeActions.length).toBeGreaterThan(0);
  });

  test('store-item executes correctly during EOT — item moves to out-of-play', () => {
    const base = eotState();
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK_OF_WESTMARCH);
    const withEvent = addCardInPlay(withItem, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);

    const storeAction = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'store-item')[0];
    expect(storeAction).toBeDefined();

    const afterStore = dispatch(withEvent, storeAction.action);

    // The Red Book should now be in the out-of-play pile (stored items)
    const aragornChar = afterStore.players[RESOURCE_PLAYER].characters;
    const aragornEntry = Object.values(aragornChar).find(c => c.definitionId === ARAGORN);
    expect(aragornEntry).toBeDefined();
    expect(aragornEntry!.items.some(i => i.definitionId === RED_BOOK_OF_WESTMARCH)).toBe(false);
    expect(afterStore.players[RESOURCE_PLAYER].killPile.some(
      i => i.definitionId === RED_BOOK_OF_WESTMARCH,
    )).toBe(true);
  });

  test('card discards when active player deck exhaust completes during EOT', () => {
    // Player 1 in EOT reset-hand: deck empty, 1 card in discard pile. Triggers deck-exhaust.
    // Safe from the Shadow is in cardsInPlay; it must be discarded after completeDeckExhaust.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    // Advance to reset-hand step with P2 already done
    const resetHandState = {
      ...base,
      phaseState: { ...(base.phaseState as EndOfTurnPhaseState), step: 'reset-hand' as const, discardDone: [true, true] as [boolean, boolean], resetHandDone: [false, true] as [boolean, boolean] } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);

    // Player 1 exhausts deck
    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].deckExhaustPending).toBe(true);
    // Safe from the Shadow still in play at this point
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === SAFE_FROM_THE_SHADOW,
    )).toBe(true);

    // Player 1 passes to complete the exhaust
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    // Safe from the Shadow must now be in P1's discard pile
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === SAFE_FROM_THE_SHADOW,
    )).toBe(false);
  });

  test('card discards when opponent deck exhaust completes during EOT', () => {
    // Player 2's deck exhausts — Safe from the Shadow (in P1 cardsInPlay) must still discard.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [],
          discardPile: [SAPLING_OF_THE_WHITE_TREE],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: { ...(base.phaseState as EndOfTurnPhaseState), step: 'reset-hand' as const, discardDone: [true, true] as [boolean, boolean], resetHandDone: [true, false] as [boolean, boolean] } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });

    expectInDiscardPile(afterPass, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === SAFE_FROM_THE_SHADOW,
    )).toBe(false);
  });

  test('cannot be duplicated — not playable when copy already in cardsInPlay', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [SAFE_FROM_THE_SHADOW],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withEvent = addCardInPlay(base, RESOURCE_PLAYER, SAFE_FROM_THE_SHADOW);

    const playActions = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.action.type === 'play-permanent-event');

    // Should be offered as not-viable (cannot be duplicated)
    expect(playActions.every(a => !a.viable)).toBe(true);
  });

  test('can be played normally when no copy is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [SAFE_FROM_THE_SHADOW],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event');

    expect(playActions.length).toBeGreaterThan(0);
  });

  test('store-item action offered to the non-active player during the opponent\'s EOT discard step', () => {
    // P1 is the active (resource) player for this turn; P2 (hazard/non-active)
    // holds Safe from the Shadow and an item at their own Haven. Bug report:
    // the non-active player never got a store-item option during the other
    // player's end-of-turn phase, even with the card in play.
    const base = eotState();
    const withItem = attachItemToChar(base, HAZARD_PLAYER, LEGOLAS, RED_BOOK_OF_WESTMARCH);
    const withEvent = addCardInPlay(withItem, HAZARD_PLAYER, SAFE_FROM_THE_SHADOW);

    const actions = computeLegalActions(withEvent, PLAYER_2);
    const storeActions = actions
      .filter(a => a.viable && a.action.type === 'store-item')
      .map(a => a.action as StoreItemAction);

    expect(storeActions.length).toBeGreaterThan(0);
  });

  test('store-item action offered to the non-active player during the opponent\'s EOT signal-end step', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withSignalEnd = {
      ...base,
      phaseState: { ...(base.phaseState as EndOfTurnPhaseState), step: 'signal-end' as const, discardDone: [true, true] as [boolean, boolean], resetHandDone: [true, true] as [boolean, boolean] } as EndOfTurnPhaseState,
    };
    const withItem = attachItemToChar(withSignalEnd, HAZARD_PLAYER, LEGOLAS, RED_BOOK_OF_WESTMARCH);
    const withEvent = addCardInPlay(withItem, HAZARD_PLAYER, SAFE_FROM_THE_SHADOW);

    const actions = computeLegalActions(withEvent, PLAYER_2);
    const storeActions = actions.filter(a => a.viable && a.action.type === 'store-item');

    expect(storeActions.length).toBeGreaterThan(0);
  });

  test('non-active player may decline to store during EOT signal-end — pass is offered and is a no-op', () => {
    // Bug report: with two low-value items (0 marshalling points), the AI
    // was forced to store both because 'pass' was never offered to the
    // non-active player alongside the store-item options at signal-end.
    // Storing is optional (CoE 2.II.4: "may attempt to store"), so a pass
    // option must be present, and choosing it must not end the turn — only
    // the active player's pass at this step ends the turn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withSignalEnd = {
      ...base,
      phaseState: { ...(base.phaseState as EndOfTurnPhaseState), step: 'signal-end' as const, discardDone: [true, true] as [boolean, boolean], resetHandDone: [true, true] as [boolean, boolean] } as EndOfTurnPhaseState,
    };
    const withItem = attachItemToChar(withSignalEnd, HAZARD_PLAYER, LEGOLAS, RED_BOOK_OF_WESTMARCH);
    const withEvent = addCardInPlay(withItem, HAZARD_PLAYER, SAFE_FROM_THE_SHADOW);

    const actions = computeLegalActions(withEvent, PLAYER_2);
    const passAction = actions.find(a => a.viable && a.action.type === 'pass');
    expect(passAction).toBeDefined();

    const afterPass = dispatch(withEvent, passAction!.action);

    // Turn must not have ended — still P1's turn, still end-of-turn signal-end.
    expect(afterPass.activePlayer).toBe(PLAYER_1);
    expect(afterPass.phaseState.phase).toBe(Phase.EndOfTurn);
    expect((afterPass.phaseState as EndOfTurnPhaseState).step).toBe('signal-end');
    // The item is still borne by Legolas — nothing was forced into storage.
    const legolasEntry = Object.values(afterPass.players[HAZARD_PLAYER].characters)
      .find(c => c.definitionId === LEGOLAS);
    expect(legolasEntry!.items.some(i => i.definitionId === RED_BOOK_OF_WESTMARCH)).toBe(true);
  });
});
