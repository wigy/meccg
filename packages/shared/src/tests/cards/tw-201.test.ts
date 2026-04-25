/**
 * @module tw-201.test
 *
 * Card test: Book of Mazarbul (tw-201)
 * Type: hero-resource-item (special)
 * Corruption: 2
 * Effects: 3
 *
 * "Unique. Only playable at Moria. May be stored at a Dwarf-hold for
 *  5 marshalling points. If its bearer is a sage, tap Book of Mazarbul
 *  during your organization phase to increase your hand size by 1 until
 *  your next untap phase."
 *
 * Engine support:
 * | # | Feature                                  | Status      | Notes                                         |
 * |---|------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Only playable at Moria                   | IMPLEMENTED | item-play-site bypasses playableAt check      |
 * | 2 | Storable at Dwarf-holds for 5 MP         | IMPLEMENTED | storable-at with named sites list             |
 * | 3 | Sage bearer taps to +1 hand size (turn)  | IMPLEMENTED | grant-action adds hand-size-modifier constraint|
 * | 4 | 2 corruption points                      | IMPLEMENTED | corruptionPoints field                        |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  GANDALF, ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, dispatch, attachItemToChar, charIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  ActivateGrantedAction,
  StoreItemAction,
} from '../../index.js';
import { computeLegalActions, HAND_SIZE } from '../../index.js';
import { resolveHandSize } from '../../engine/effects/index.js';

const BOOK_OF_MAZARBUL = 'tw-201' as CardDefinitionId;
const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

describe('Book of Mazarbul (tw-201)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: item-play-site (only playable at Moria) ──────────────────

  test('playable at Moria during site phase', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [BOOK_OF_MAZARBUL],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('NOT playable at Rivendell (haven, not Moria)', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      characters: [GANDALF],
      hand: [BOOK_OF_MAZARBUL],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Minas Tirith (free-hold, not Moria)', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [GANDALF],
      hand: [BOOK_OF_MAZARBUL],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Effect 2: storable-at Dwarf-holds for 5 MP ─────────────────────────

  test('store-item action available at Blue Mountain Dwarf-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: GANDALF, items: [BOOK_OF_MAZARBUL] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
  });

  test('store-item action available at Iron Hill Dwarf-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: IRON_HILL_DWARF_HOLD, characters: [{ defId: GANDALF, items: [BOOK_OF_MAZARBUL] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
  });

  test('store-item action available at Moria (itself a Dwarf-hold)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: GANDALF, items: [BOOK_OF_MAZARBUL] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
  });

  test('store-item action available at The Lonely Mountain', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LONELY_MOUNTAIN, characters: [{ defId: GANDALF, items: [BOOK_OF_MAZARBUL] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
  });

  test('store-item NOT available at Rivendell (not a Dwarf-hold)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF, items: [BOOK_OF_MAZARBUL] }] }],
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

  test('stored Book earns 5 MP at a Dwarf-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: ARAGORN, items: [BOOK_OF_MAZARBUL] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // 1 MP while on character (base)
    expect(state.players[0].marshallingPoints.item).toBe(1);

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    const afterStore = dispatch(state, storeActions[0].action);

    // 5 MP after storing (storable-at override)
    expect(afterStore.players[0].marshallingPoints.item).toBe(5);
  });

  test('dispatching store-item moves Book to out-of-play pile', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BLUE_MOUNTAIN_DWARF_HOLD, characters: [{ defId: GANDALF, items: [BOOK_OF_MAZARBUL] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const storeActions = viableActions(base, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const afterStore = dispatch(base, (storeActions[0].action as StoreItemAction));

    const gandalf = Object.values(afterStore.players[0].characters)[0];
    expect(gandalf.items).toHaveLength(0);
    expect(afterStore.players[0].outOfPlayPile).toHaveLength(1);
    expect(afterStore.players[0].outOfPlayPile[0].definitionId).toBe(BOOK_OF_MAZARBUL);
  });

  // ─── Effect 3: sage bearer taps for +1 hand size until next untap ────────

  test('grant-action available during org phase when bearer is a sage (Gandalf)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withBook = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, BOOK_OF_MAZARBUL);

    const actions = viableActions(withBook, PLAYER_1, 'activate-granted-action');
    const bookActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'book-of-mazarbul-hand-boost',
    );
    expect(bookActions).toHaveLength(1);
  });

  test('grant-action NOT available when bearer is not a sage (Aragorn)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withBook = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, BOOK_OF_MAZARBUL);

    const actions = viableActions(withBook, PLAYER_1, 'activate-granted-action');
    const bookActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'book-of-mazarbul-hand-boost',
    );
    expect(bookActions).toHaveLength(0);
  });

  test('tapping the Book adds a turn-scoped hand-size-modifier constraint and taps the item', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withBook = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, BOOK_OF_MAZARBUL);

    const gandalfId = charIdAt(withBook, RESOURCE_PLAYER, 0, 0);
    const gandalfChar = withBook.players[RESOURCE_PLAYER].characters[gandalfId as string];
    const bookInstId = gandalfChar.items[0].instanceId;

    const actions = viableActions(withBook, PLAYER_1, 'activate-granted-action');
    const bookAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'book-of-mazarbul-hand-boost',
    )!;
    expect(bookAction).toBeDefined();

    const after = dispatch(withBook, bookAction.action);

    // Item is tapped; bearer (Gandalf) remains untapped
    const gandalfAfter = after.players[RESOURCE_PLAYER].characters[gandalfId as string];
    const bookAfter = gandalfAfter.items.find(i => i.instanceId === bookInstId)!;
    expect(bookAfter.status).toBe(CardStatus.Tapped);

    // Constraint placed on the player, scoped to the rest of the turn
    expect(after.activeConstraints).toHaveLength(1);
    const constraint = after.activeConstraints[0];
    expect(constraint.kind.type).toBe('hand-size-modifier');
    if (constraint.kind.type === 'hand-size-modifier') {
      expect(constraint.kind.value).toBe(1);
    }
    expect(constraint.target.kind).toBe('player');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.source).toBe(bookInstId);
  });

  test('hand size is HAND_SIZE + 1 after tapping the Book (sage bearer)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withBook = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, BOOK_OF_MAZARBUL);

    expect(resolveHandSize(withBook, RESOURCE_PLAYER)).toBe(HAND_SIZE);

    const bookActions = viableActions(withBook, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'book-of-mazarbul-hand-boost',
    );
    const after = dispatch(withBook, bookActions[0].action);

    expect(resolveHandSize(after, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // Opponent's hand size is unaffected
    expect(resolveHandSize(after, 1)).toBe(HAND_SIZE);
  });

  test('tapped Book cannot be activated again', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withBook = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, BOOK_OF_MAZARBUL);
    const bookActions = viableActions(withBook, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'book-of-mazarbul-hand-boost',
    );
    const after = dispatch(withBook, bookActions[0].action);

    // After tapping, action should no longer be available
    const actionsAfter = viableActions(after, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'book-of-mazarbul-hand-boost',
    );
    expect(actionsAfter).toHaveLength(0);
  });

  test('grant-action works with any sage bearer (Bilbo)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withBook = attachItemToChar(base, RESOURCE_PLAYER, BILBO, BOOK_OF_MAZARBUL);

    const actions = viableActions(withBook, PLAYER_1, 'activate-granted-action');
    const bookActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'book-of-mazarbul-hand-boost',
    );
    expect(bookActions).toHaveLength(1);
  });
});
