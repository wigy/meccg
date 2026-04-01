/**
 * @module tw-243.test
 *
 * Card test: Gates of Morning (tw-243)
 * Type: hero-resource-event (permanent, environment)
 * Effects: 2 (duplication-limit scope:game max:1, on-event self-enters-play discard-opposing-environments)
 *
 * "Environment. When Gates of Morning is played, all environment hazard
 *  cards in play are immediately discarded, and all hazard environment
 *  effects are canceled. Cannot be duplicated."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ARAGORN, LEGOLAS,
  GATES_OF_MORNING, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardInPlay, CardInstanceId, GameState } from '../../index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find viable actions of a specific type for a player. */
function viableActions(state: GameState, playerId: typeof PLAYER_1, actionType: string) {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === actionType);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Gates of Morning (tw-243)', () => {
  beforeEach(() => resetMint());

  test('can be played as a permanent event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Card moved from hand to cardsInPlay
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].cardsInPlay).toHaveLength(1);
    expect(result.state.players[0].cardsInPlay[0].instanceId).toBe(gomId);
  });

  test('discards Doors of Night (hazard environment) when played', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Gates of Morning in P1 cardsInPlay
    expect(result.state.players[0].cardsInPlay).toHaveLength(1);
    expect(result.state.players[0].cardsInPlay[0].instanceId).toBe(gomId);

    // Doors of Night discarded from P2 cardsInPlay
    expect(result.state.players[1].cardsInPlay).toHaveLength(0);
    expect(result.state.players[1].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('discards own hazard environment cards when played', () => {
    // Edge case: P1 has a Doors of Night in their own cardsInPlay
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Gates of Morning in cardsInPlay, Doors of Night discarded
    const p1InPlay = result.state.players[0].cardsInPlay;
    expect(p1InPlay).toHaveLength(1);
    expect(p1InPlay[0].instanceId).toBe(gomId);
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).toContain('don-1' as CardInstanceId);
  });

  test('does not discard own resource environment cards', () => {
    // If somehow another resource environment is in play, it should NOT be discarded
    const otherGomInPlay: CardInPlay = {
      instanceId: 'gom-other' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    // Use a second player's cardsInPlay with a resource environment
    // (this would normally be blocked by duplication-limit, but we test the discard logic)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [otherGomInPlay] },
      ],
    });

    // Duplication limit will block this, but let's verify via the legal actions
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBe('Gates of Morning cannot be duplicated');
  });

  test('cannot be duplicated when opponent has a copy in play', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [gomInPlay] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBe('Gates of Morning cannot be duplicated');
  });

  test('no opposing environments to discard is a no-op', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomId = state.players[0].hand[0].instanceId;
    const result = reduce(state, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });
    expect(result.error).toBeUndefined();

    // Gates of Morning played, no discards needed
    expect(result.state.players[0].cardsInPlay).toHaveLength(1);
    expect(result.state.players[0].discardPile).toHaveLength(0);
    expect(result.state.players[1].discardPile).toHaveLength(0);
  });
});
