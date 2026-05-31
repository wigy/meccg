/**
 * @module rule-2.09-empty-play-deck-and-discard
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.09: Empty Play Deck and Discard
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a player ever has no cards in both their play deck and discard pile, the next card that the player discards immediately becomes their play deck.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CAVE_DRAKE, ORC_PATROL,
  findHandCardId,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

describe('Rule 2.09 — Empty Play Deck and Discard', () => {
  beforeEach(() => resetMint());

  test('Both play deck and discard pile empty: next discarded card immediately becomes play deck', () => {
    // PLAYER_1 has one card in hand (CAVE_DRAKE), empty deck, empty discard.
    // When they discard during the EOT discard step, the card must go to
    // their play deck (not discard pile), so they can draw it back next turn.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [CAVE_DRAKE],
          siteDeck: [MORIA],
          playDeck: [],         // empty deck
          discardPile: [],      // and empty discard → rule 2.09 applies
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Find the card instance in PLAYER_1's hand
    const cavedrakeId = findHandCardId(state, RESOURCE_PLAYER, CAVE_DRAKE);

    // PLAYER_1 discards their card during the discard step
    const afterDiscard = dispatch(state, { type: 'discard-card', player: PLAYER_1, cardInstanceId: cavedrakeId });

    // The discarded card must be in playDeck, not discardPile (rule 2.09)
    expect(afterDiscard.players[RESOURCE_PLAYER].playDeck.some(c => c.instanceId === cavedrakeId)).toBe(true);
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cavedrakeId)).toBe(false);

    // Advance to reset-hand: PLAYER_2 passes discard, both done
    const p2Pass = dispatch(afterDiscard, { type: 'pass', player: PLAYER_2 });

    // In reset-hand, PLAYER_1 should be offered draw-cards (playDeck now has 1 card)
    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const viableP1 = actions.filter(a => a.viable);
    expect(viableP1.some(a => a.action.type === 'draw-cards')).toBe(true);
    // deck-exhaust must NOT be offered when deck has cards
    expect(viableP1.some(a => a.action.type === 'deck-exhaust')).toBe(false);
  });

  test('Rule does not trigger if play deck is empty but discard has cards', () => {
    // When play deck is empty but discard pile has cards, the normal deck-exhaust
    // flow is used (not the rule-2.09 direct-to-deck behavior).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          playDeck: [], // empty deck
          discardPile: [CAVE_DRAKE, ORC_PATROL], // but discard has cards
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Advance to reset-hand step
    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const viableP1 = actions.filter(a => a.viable);

    // deck-exhaust must be offered (normal deck exhaustion flow)
    expect(viableP1.some(a => a.action.type === 'deck-exhaust')).toBe(true);
    // draw-cards must NOT be offered when deck is empty
    expect(viableP1.some(a => a.action.type === 'draw-cards')).toBe(false);
  });

  test('Rule does not trigger if discard is empty but play deck has cards', () => {
    // When discard pile is empty but play deck has cards, normal draw is used.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          playDeck: [CAVE_DRAKE], // deck has cards
          discardPile: [], // but discard is empty
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // Advance to reset-hand step
    const p1Pass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const p2Pass = dispatch(p1Pass, { type: 'pass', player: PLAYER_2 });

    const actions = computeLegalActions(p2Pass, PLAYER_1);
    const viableP1 = actions.filter(a => a.viable);

    // draw-cards must be offered (normal draw flow)
    expect(viableP1.some(a => a.action.type === 'draw-cards')).toBe(true);
    // deck-exhaust must NOT be offered when deck has cards
    expect(viableP1.some(a => a.action.type === 'deck-exhaust')).toBe(false);
  });
});
