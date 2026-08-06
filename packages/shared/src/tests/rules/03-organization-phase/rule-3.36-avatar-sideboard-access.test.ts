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
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, viableFor, viableActions, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF, LEGOLAS,
  SCROLL_OF_ISILDUR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  attachHazardToChar, findCharInstanceId, grantedActionsFor,
  RESOURCE_PLAYER,
} from '../../test-helpers.js';

const DESPAIR_OF_THE_HEART = 'tw-27' as CardDefinitionId;

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

  // Bug report: an avatar (Gandalf) taps itself to start a sideboard-to-discard
  // sub-flow and, mid-flow, is now tapped. Rule 2.II.6 (sideboard access) carries
  // no "no other actions" clause — unlike 2.II.1 ("organizing") — so a corruption
  // card attached to that same avatar must still offer its no-tap −3 removal
  // variant (rule 7.3) while the sideboard sub-flow is open.
  test('corruption-card no-tap removal remains available while a sideboard fetch sub-flow is active', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
          sideboard: [SCROLL_OF_ISILDUR],
          playDeck: [ARAGORN, ARAGORN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withHazard = attachHazardToChar(state, RESOURCE_PLAYER, GANDALF, DESPAIR_OF_THE_HEART);
    const gandalfId = findCharInstanceId(withHazard, RESOURCE_PLAYER, GANDALF);

    const startAction = viableActions(withHazard, PLAYER_1, 'start-sideboard-to-discard')[0].action;
    const midFlow = dispatch(withHazard, startAction);

    // The sub-flow is active and Gandalf (the avatar) is now tapped from
    // declaring it — the standard tap-and-roll variant is unavailable, but
    // the no-tap variant must still be offered.
    const grants = grantedActionsFor(midFlow, gandalfId, 'remove-self-on-roll', PLAYER_1);
    expect(grants).toHaveLength(1);
    expect(grants[0].noTap).toBe(true);
  });
});
