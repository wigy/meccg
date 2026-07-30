/**
 * @module rule-3.36-avatar-sideboard-access
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.36: Avatar Sideboard Access
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Using Avatar to Access Sideboard - During the organization phase either before or after organizing, the resource player may tap their avatar character to either:
 * • bring up to five resources and/or characters from their sideboard to their discard pile.
 * • if the resource player's play deck has at least five cards, bring one resource or character from their sideboard directly into their play deck and then shuffle.
 * The types of the cards must be revealed to confirm that they are resources and/or characters, but the actual card names don't need to be revealed.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF, LEGOLAS,
  SCROLL_OF_ISILDUR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
} from '../../test-helpers.js';
import type { StartSideboardToDeckAction, CancelSideboardAccessAction } from '../../../index.js';

describe('Rule 3.36 — Avatar Sideboard Access', () => {
  beforeEach(() => resetMint());

  test('During org phase, tap avatar to access sideboard (5 to discard or 1 to deck)', () => {
    // Gandalf (wizard avatar) is untapped, the sideboard contains a resource,
    // and the play deck has ≥5 cards. Both start-sideboard-to-discard and
    // start-sideboard-to-deck must be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [SCROLL_OF_ISILDUR],
          playDeck: [ARAGORN, ARAGORN, ARAGORN, ARAGORN, ARAGORN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const sideboardActions = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'start-sideboard-to-discard' || a.action.type === 'start-sideboard-to-deck');

    expect(sideboardActions.some(a => a.action.type === 'start-sideboard-to-discard')).toBe(true);
    expect(sideboardActions.some(a => a.action.type === 'start-sideboard-to-deck')).toBe(true);

    // When the avatar is tapped, sideboard access must not be offered
    const tappedState = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF, status: CardStatus.Tapped }, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [SCROLL_OF_ISILDUR],
          playDeck: [ARAGORN, ARAGORN, ARAGORN, ARAGORN, ARAGORN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const tappedSideboardActions = viableFor(tappedState, PLAYER_1)
      .filter(a => a.action.type === 'start-sideboard-to-discard' || a.action.type === 'start-sideboard-to-deck');
    expect(tappedSideboardActions).toHaveLength(0);
  });

  test('canceling sideboard access before fetching untaps the avatar again', () => {
    // Gandalf taps to start a sideboard-to-deck sub-flow. Before picking a
    // card, the player backs out via cancel-sideboard-access — the avatar
    // must become untapped again and sideboard access must be re-offerable,
    // rather than being stuck tapped with no way to exit the sub-flow.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [SCROLL_OF_ISILDUR],
          playDeck: [ARAGORN, ARAGORN, ARAGORN, ARAGORN, ARAGORN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const avatarInstanceId = state.players[0].companies[0].characters[0];

    const startAction = viableFor(state, PLAYER_1)
      .find(a => a.action.type === 'start-sideboard-to-deck')!.action as StartSideboardToDeckAction;
    expect(startAction).toBeDefined();
    const afterStart = dispatch(state, startAction);

    // Avatar is now tapped, and canceling must be offered since nothing has been fetched yet.
    expect(afterStart.players[0].characters[avatarInstanceId].status).toBe(CardStatus.Tapped);
    const cancelAction = viableFor(afterStart, PLAYER_1)
      .find(a => a.action.type === 'cancel-sideboard-access')?.action as CancelSideboardAccessAction | undefined;
    expect(cancelAction).toBeDefined();

    const afterCancel = dispatch(afterStart, cancelAction!);

    // Avatar is untapped again, sideboard is untouched, and sideboard access can be re-declared.
    expect(afterCancel.players[0].characters[avatarInstanceId].status).toBe(CardStatus.Untapped);
    expect(afterCancel.players[0].sideboard).toHaveLength(1);
    const reOfferedActions = viableFor(afterCancel, PLAYER_1)
      .filter(a => a.action.type === 'start-sideboard-to-discard' || a.action.type === 'start-sideboard-to-deck');
    expect(reOfferedActions.length).toBeGreaterThan(0);
  });
});
