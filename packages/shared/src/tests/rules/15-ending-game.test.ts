/**
 * @module 15-ending-game.test
 *
 * Tests for CoE Rules Section 10: Ending the Game.
 *
 * Rule references from docs/coe-rules.md.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  GANDALF,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, reduce,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { EvaluatedAction } from '../../index.js';

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

describe('10 Winning with The One Ring', () => {
  test.todo('[HERO] Cracks of Doom or Gollum\'s Fate: wizard player wins');
  test.todo('[MINION] company bearing One Ring at Barad-dur: ringwraith wins');
});

describe('10 Calling the game (Short game)', () => {
  test.todo('[10] short game: call if >= 25 MP and deck exhausted once, or deck exhausted twice');
  test.todo('[10] calling: opponent gets one last turn');
  test.todo('[10] automatic end: both decks exhausted twice, game ends after current turn');
});

describe('10 Deck exhaustion', () => {
  beforeEach(() => resetMint());

  test.todo('[10] deck exhausted when last card drawn');
  test.todo('[10] on exhaust: discard cards that would be discarded, return sites to location deck');

  test('[10] on exhaust: exchange up to 5 cards between discard and sideboard', () => {
    // Build state with cards in playDeck that we'll move to discard
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          playDeck: [DAGGER_OF_WESTERNESSE, BARROW_WIGHT],
          sideboard: [CAVE_DRAKE, ORC_PATROL],
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    // Move playDeck cards to discard to simulate empty deck with discard
    const p1 = state.players[0];
    const withState: typeof state = {
      ...state,
      phaseState: { phase: Phase.EndOfTurn, step: 'reset-hand', discardDone: [true, true] } as typeof state.phaseState,
      players: [
        { ...p1, playDeck: [], discardPile: [...p1.playDeck] },
        state.players[1],
      ] as typeof state.players,
    };

    // Step 1: deck-exhaust enters the exchange sub-flow
    const actions = computeLegalActions(withState, PLAYER_1);
    const exhaustActions = viableOfType(actions, 'deck-exhaust');
    expect(exhaustActions).toHaveLength(1);

    const exhaustResult = reduce(withState, exhaustActions[0].action);
    expect(exhaustResult.error).toBeUndefined();
    expect(exhaustResult.state.players[0].deckExhaustPending).toBe(true);

    // Step 2: exchange actions available + pass
    const exchangeActions = computeLegalActions(exhaustResult.state, PLAYER_1);
    const exchanges = viableOfType(exchangeActions, 'exchange-sideboard');
    expect(exchanges.length).toBeGreaterThan(0);
    expect(viableOfType(exchangeActions, 'pass')).toHaveLength(1);

    // Execute one exchange
    const exchangeResult = reduce(exhaustResult.state, exchanges[0].action);
    expect(exchangeResult.error).toBeUndefined();
    expect(exchangeResult.state.players[0].deckExhaustExchangeCount).toBe(1);

    // Step 3: pass completes the reshuffle
    const passActions = computeLegalActions(exchangeResult.state, PLAYER_1);
    const passResult = reduce(exchangeResult.state, viableOfType(passActions, 'pass')[0].action);
    expect(passResult.error).toBeUndefined();
    expect(passResult.state.players[0].deckExhaustPending).toBe(false);
    expect(passResult.state.players[0].playDeck.length).toBeGreaterThan(0);
    expect(passResult.state.players[0].discardPile).toHaveLength(0);
  });

  test.todo('[10] on exhaust: shuffle discard pile becomes new play deck');
  test.todo('[10] deck exhaustion happens immediately, cannot be responded to');
});

describe('10 Free Council: determining the winner', () => {
  test.todo('[10.3.i] corruption checks for all non-ringwraith non-balrog characters');
  test.todo('[10.3.i] either player may take actions affecting corruption checks');
  test.todo('[10.3.ii] total MPs for each of 6 sources: character, ally, item, faction, kill, misc');
  test.todo('[10.3.iii] doubling rule: if opponent has 0 in character/ally/item/faction, double yours');
  test.todo('[10.3.iv] diversity rule: no source > 50% of total positive MPs');
  test.todo('[10.3.v] reveal duplicates: reduce opponent MP by 1 per matching unique card');
  test.todo('[10.3.vi] apply -5 misc MP penalty for eliminated avatar');
  test.todo('[10.3.vii] highest MP total wins; tie = tie');
  test.todo('[HERO] minion items worth half MP (rounded up) for wizard players');
});
