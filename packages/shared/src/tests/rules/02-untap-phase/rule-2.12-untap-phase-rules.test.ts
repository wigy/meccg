/**
 * @module rule-2.12-untap-phase-rules
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.12: Untap Phase - Untap or Heal
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * During the untap phase, for each of the resource player's non-site cards, that player may either untap the card if it is tapped or, if the card is a character at one of the player's havens, heal the character to the tapped position.
 */

import { describe, test, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  expectCharStatus, RESOURCE_PLAYER, HAZARD_PLAYER,
  attachAllyToChar, setAllyStatus, expectAllyStatus, GWAIHIR,
} from '../../test-helpers.js';


describe('Rule 2.12 — Untap Phase - Untap or Heal', () => {
  beforeEach(() => resetMint());

  test('Tapped characters are untapped during untap phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('Wounded character at haven is healed to tapped position', () => {
    // Rivendell is a haven — wounded (inverted) character should heal to tapped
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    // Healed to tapped, not untapped
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });

  test('Wounded character NOT at haven remains wounded', () => {
    // Moria is not a haven — wounded character should remain wounded
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('Wounded ally at haven is healed to tapped position', () => {
    // CoE 2.V.2.2: allies are treated as characters for healing. Rivendell is
    // a haven — a wounded (inverted) ally should heal to tapped, same as a
    // wounded character, not stay wounded forever.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    state = setAllyStatus(state, RESOURCE_PLAYER, ARAGORN, GWAIHIR, CardStatus.Inverted);

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectAllyStatus(nextState, RESOURCE_PLAYER, ARAGORN, GWAIHIR, CardStatus.Tapped);
  });

  test('Untapped characters remain untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Untapped }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('Only resource player non-site cards are affected by untap', () => {
    // Opponent's tapped character should NOT be untapped during resource player's untap
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    // Opponent's character should still be tapped
    expectCharStatus(nextState, HAZARD_PLAYER, LEGOLAS, CardStatus.Tapped);
  });

  test('All tapped characters in the same company are untapped together', () => {
    // Two characters (Aragorn, Bilbo) both tapped in the same company.
    // The untap action must process every non-site card — both untap in one step.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: ARAGORN, status: CardStatus.Tapped },
            { defId: BILBO, status: CardStatus.Tapped },
          ] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharStatus(nextState, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
  });
});
