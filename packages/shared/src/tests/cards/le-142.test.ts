/**
 * @module le-142.test
 *
 * Card test: Thrice Outnumbered (le-142)
 * Type: hazard-event (permanent)
 *
 * Card text:
 *   "Each player may take one Man hazard creature from his discard pile and
 *    shuffle it into his play deck at the end of each turn. Discard this card
 *    or a Man hazard creature from your hand at the end of opponent's
 *    long-event phase. Discard when any play deck is exhausted.
 *    Cannot be duplicated."
 *
 * Effects:
 *   1. duplication-limit scope:game max:1 — cannot be duplicated
 *   2. on-event: play-deck-exhausted — discard self when any deck exhausts
 *
 * | # | Effect                                          | Status          | Notes                               |
 * |---|-------------------------------------------------|-----------------|-------------------------------------|
 * | 1 | duplication-limit (game, max 1)                 | OK              | movement-hazard.ts duplication check |
 * | 2 | on-event: play-deck-exhausted, discard-self     | OK              | completeDeckExhaust in reducer-utils |
 * | 3 | end-of-turn: each player fetches Man creature   | NOT IMPLEMENTED | no grant-action for permanent events |
 * | 4 | maintenance: discard self or Man from hand (EoT) | NOT IMPLEMENTED | no maintenance-cost DSL type         |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — rules 3 and 4 require engine support not yet built.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  addCardInPlay,
  dispatch,
  HAZARD_PLAYER,
  expectInDiscardPile,
  SAPLING_OF_THE_WHITE_TREE,
  Phase,
  makeMHState,
  viableActions,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, EndOfTurnPhaseState } from '../../index.js';
import { CardStatus } from '../../index.js';

const THRICE_OUTNUMBERED = 'le-142' as CardDefinitionId;

const thriceInPlay: CardInPlay = {
  instanceId: 'thrice-1' as CardInstanceId,
  definitionId: THRICE_OUTNUMBERED,
  status: CardStatus.Untapped,
};

describe('Thrice Outnumbered (le-142)', () => {
  beforeEach(() => resetMint());

  test('cannot be duplicated — not playable when copy already in cardsInPlay', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THRICE_OUTNUMBERED],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [thriceInPlay],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('can be played when no copy is already in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THRICE_OUTNUMBERED],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const allHazardActions = readyState.players[HAZARD_PLAYER].hand.map(h => h.instanceId);
    // The card in hand should appear as a viable play-hazard action
    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(allHazardActions.length).toBeGreaterThan(0);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('discards when active player deck exhausts during EOT', () => {
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
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, THRICE_OUTNUMBERED);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    expectInDiscardPile(afterPass, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(false);
  });

  test('discards when opponent (hazard player) deck exhausts during EOT', () => {
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
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, HAZARD_PLAYER, THRICE_OUTNUMBERED);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });

    expectInDiscardPile(afterPass, HAZARD_PLAYER, THRICE_OUTNUMBERED);
    expect(afterPass.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === THRICE_OUTNUMBERED,
    )).toBe(false);
  });
});
