/**
 * @module rule-2.08-play-deck-exhaustion
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.08: Play Deck Exhaustion
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A play deck is "exhausted" when the last card is drawn from it. When a player exhausts their play deck, immediately discard any cards in play that would be discarded when a play deck is exhausted. The exhausting player then returns any site cards from their discard pile to their location deck, then may exchange up to five cards between their discard pile and sideboard (regardless of the type of cards), and then shuffles their discard pile which becomes their play deck. A play deck being exhausted and re-shuffled happens immediately when the last card is drawn (e.g. it may happen in the middle of drawing additional cards, which then resumes once the play deck is reset), and cannot be responded to.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS,
  DAGGER_OF_WESTERNESSE, CAVE_DRAKE, ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';

describe('Rule 2.08 — Play Deck Exhaustion', () => {
  beforeEach(() => resetMint());

  test('Drawing the last card from play deck triggers exhaustion and reshuffle', () => {
    // Set up a state with only 1 card in the play deck and some in discard
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          playDeck: [DAGGER_OF_WESTERNESSE], // Only 1 card left
          discardPile: [CAVE_DRAKE, ORC_PATROL, DAGGER_OF_WESTERNESSE], // These become new play deck
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    // Verify initial state
    expect(state.players[0].playDeck).toHaveLength(1);
    expect(state.players[0].discardPile).toHaveLength(3);
    expect(state.players[0].deckExhaustionCount).toBe(0);
  });

  test.todo('Exhaustion discards cards in play that trigger on deck exhaustion');

  test.todo('Site cards from discard pile return to location deck on exhaustion');

  test.todo('Player may exchange up to 5 cards between discard and sideboard on exhaustion');

  test.todo('Discard pile becomes new play deck after shuffle');

  test.todo('Exhaustion happens immediately mid-draw and cannot be responded to');

  test.todo('Deck exhaustion count increments on each exhaustion');
});
