/**
 * @module 07-end-of-turn.test
 *
 * Tests for CoE Rules Section 2.VI: End-of-Turn Phase.
 *
 * Rule references from docs/coe-rules.txt lines 396-399.
 *
 * The end-of-turn phase has three steps:
 * 1. Either player may discard a card from their own hand.
 * 2. Both players reset hands by drawing or discarding to base hand size (8).
 * 3. Resource player signals end of turn; end-of-turn passive conditions resolve.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  Phase,
  ARAGORN, LEGOLAS,
  GLAMDRING, STING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, runActions,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { EndOfTurnPhaseState, GameState } from '../../index.js';
import { HAND_SIZE } from '../../index.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a state in the end-of-turn phase with the given hand contents. */
function buildEndOfTurnState(opts: {
  p1Hand: number;
  p2Hand: number;
  p1DeckSize?: number;
  p2DeckSize?: number;
}): GameState {
  // Build hand arrays of the requested size using various card definitions
  const cardDefs = [GLAMDRING, STING, DAGGER_OF_WESTERNESSE, CAVE_DRAKE, ORC_PATROL,
    BARROW_WIGHT, SUN, EYE_OF_SAURON, GATES_OF_MORNING];

  function handOf(count: number) {
    const hand = [];
    for (let i = 0; i < count; i++) {
      hand.push(cardDefs[i % cardDefs.length]);
    }
    return hand;
  }

  function deckOf(count: number) {
    const deck = [];
    for (let i = 0; i < count; i++) {
      deck.push(cardDefs[i % cardDefs.length]);
    }
    return deck;
  }

  return buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        hand: handOf(opts.p1Hand),
        siteDeck: [MORIA],
        playDeck: deckOf(opts.p1DeckSize ?? 10),
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        hand: handOf(opts.p2Hand),
        siteDeck: [MINAS_TIRITH],
        playDeck: deckOf(opts.p2DeckSize ?? 10),
      },
    ],
    phase: Phase.EndOfTurn,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('2.VI End-of-turn phase', () => {
  beforeEach(() => resetMint());

  test('[2.VI.1] either player may discard a card from their own hand', () => {
    // Both players have 9 cards — above hand size.
    // During the discard step, both should be able to discard.
    const state = buildEndOfTurnState({ p1Hand: 9, p2Hand: 9 });
    const eotState = state.phaseState as EndOfTurnPhaseState;
    expect(eotState.step).toBe('discard');

    // P1 (active/resource player) should have discard options + pass
    const p1Actions = computeLegalActions(state, PLAYER_1);
    const p1Viable = p1Actions.filter(a => a.viable);
    const p1Discards = p1Viable.filter(a => a.action.type === 'discard-card');
    const p1Pass = p1Viable.filter(a => a.action.type === 'pass');
    expect(p1Discards.length).toBe(9); // one per card in hand
    expect(p1Pass.length).toBe(1);

    // P2 (non-active player) should also have discard options + pass
    const p2Actions = computeLegalActions(state, PLAYER_2);
    const p2Viable = p2Actions.filter(a => a.viable);
    const p2Discards = p2Viable.filter(a => a.action.type === 'discard-card');
    const p2Pass = p2Viable.filter(a => a.action.type === 'pass');
    expect(p2Discards.length).toBe(9);
    expect(p2Pass.length).toBe(1);

    // P1 discards a card — still in discard step (P2 hasn't acted)
    const discardAction = p1Discards[0].action;
    expect(discardAction.type).toBe('discard-card');
    const result = reduce(state, discardAction);
    expect(result.error).toBeUndefined();
    const afterP1 = result.state;
    expect((afterP1.phaseState as EndOfTurnPhaseState).step).toBe('discard');
    expect(afterP1.players[0].hand.length).toBe(8);
    expect(afterP1.players[0].discardPile.length).toBe(1);

    // P1 should have no more actions (already acted)
    const p1ActionsAfter = computeLegalActions(afterP1, PLAYER_1);
    expect(p1ActionsAfter.filter(a => a.viable).length).toBe(0);

    // P2 discards a card — both done, advances to reset-hand
    const p2ActionsAfter = computeLegalActions(afterP1, PLAYER_2);
    const p2DiscardsAfter = p2ActionsAfter.filter(a => a.viable && a.action.type === 'discard-card');
    expect(p2DiscardsAfter.length).toBe(9);
    const result2 = reduce(afterP1, p2DiscardsAfter[0].action);
    expect(result2.error).toBeUndefined();
    expect((result2.state.phaseState as EndOfTurnPhaseState).step).toBe('reset-hand');
    expect(result2.state.players[1].hand.length).toBe(8);
  });

  test('[2.VI.1b] player who discards below hand size must draw back up in reset-hand', () => {
    // Both at 8. P1 passes, P2 discards (8→7). In reset-hand, P2 must draw 1.
    const state = buildEndOfTurnState({ p1Hand: HAND_SIZE, p2Hand: HAND_SIZE });

    // P1 passes, P2 discards
    let s = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
    ]);
    const p2Hand = s.players[1].hand;
    s = runActions(s, [
      { type: 'discard-card', player: PLAYER_2, cardInstanceId: p2Hand[0] },
    ]);
    expect((s.phaseState as EndOfTurnPhaseState).step).toBe('reset-hand');
    expect(s.players[0].hand.length).toBe(HAND_SIZE); // P1 still at 8
    expect(s.players[1].hand.length).toBe(7); // P2 at 7

    // P1 at hand size → pass
    s = runActions(s, [
      { type: 'pass', player: PLAYER_1 },
    ]);
    // Should NOT advance to signal-end yet — P2 still needs to draw
    expect((s.phaseState as EndOfTurnPhaseState).step).toBe('reset-hand');

    // P2 draws 1 card to reach 8
    s = runActions(s, [
      { type: 'draw-cards', player: PLAYER_2, count: 1 },
    ]);
    expect(s.players[1].hand.length).toBe(HAND_SIZE);
    // Now both at hand size → signal-end
    expect((s.phaseState as EndOfTurnPhaseState).step).toBe('signal-end');
  });

  test('[2.VI.2] both players reset hands by drawing or discarding to base hand size of 8', () => {
    // P1 has 10 cards (must discard 2), P2 has 5 cards (must draw 3).
    // Start at reset-hand step directly by passing through discard.
    const state = buildEndOfTurnState({ p1Hand: 10, p2Hand: 5 });

    // Both players pass through discard step
    const afterDiscard = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);
    expect((afterDiscard.phaseState as EndOfTurnPhaseState).step).toBe('reset-hand');

    // P1 (10 cards) should only see discard-card actions (must discard to 8)
    const p1Actions = computeLegalActions(afterDiscard, PLAYER_1);
    const p1Viable = p1Actions.filter(a => a.viable);
    expect(p1Viable.every(a => a.action.type === 'discard-card')).toBe(true);
    expect(p1Viable.length).toBe(10); // one per card in hand

    // P2 (5 cards) should see a draw-cards action
    const p2Actions = computeLegalActions(afterDiscard, PLAYER_2);
    const p2Viable = p2Actions.filter(a => a.viable);
    const p2Draw = p2Viable.find(a => a.action.type === 'draw-cards');
    expect(p2Draw).toBeDefined();
    expect(p2Draw!.action.type === 'draw-cards' && p2Draw!.action.count).toBe(3);

    // P2 draws 3 cards to reach 8
    let s = runActions(afterDiscard, [
      { type: 'draw-cards', player: PLAYER_2, count: 3 },
    ]);
    expect(s.players[1].hand.length).toBe(HAND_SIZE);

    // P1 still needs to discard 2 cards
    const p1Hand = s.players[0].hand;
    s = runActions(s, [
      { type: 'discard-card', player: PLAYER_1, cardInstanceId: p1Hand[0] },
      { type: 'discard-card', player: PLAYER_1, cardInstanceId: p1Hand[1] },
    ]);

    // Both at hand size → should have advanced to signal-end
    expect(s.players[0].hand.length).toBe(HAND_SIZE);
    expect(s.players[1].hand.length).toBe(HAND_SIZE);
    expect((s.phaseState as EndOfTurnPhaseState).step).toBe('signal-end');
  });

  test('[2.VI.3] resource player signals end of turn; end-of-turn passive conditions resolve', () => {
    // Both players at hand size 8 — go through all steps to signal-end
    const state = buildEndOfTurnState({ p1Hand: HAND_SIZE, p2Hand: HAND_SIZE });

    // Both players pass through discard step
    let s = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);
    expect((s.phaseState as EndOfTurnPhaseState).step).toBe('reset-hand');

    // Both at hand size → P1 passes, handler sees both at hand size,
    // auto-advances to signal-end
    s = runActions(s, [
      { type: 'pass', player: PLAYER_1 },
    ]);
    expect((s.phaseState as EndOfTurnPhaseState).step).toBe('signal-end');

    // Only the resource player (active player = P1) should have actions
    const p1Actions = computeLegalActions(s, PLAYER_1);
    const p1Viable = p1Actions.filter(a => a.viable);
    expect(p1Viable.length).toBe(1);
    expect(p1Viable[0].action.type).toBe('pass');

    const p2Actions = computeLegalActions(s, PLAYER_2);
    const p2Viable = p2Actions.filter(a => a.viable);
    expect(p2Viable.length).toBe(0);

    // P1 passes → turn ends, active player switches, Untap phase begins
    const result = reduce(s, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.Untap);
    expect(result.state.activePlayer).toBe(PLAYER_2);
    expect(result.state.turnNumber).toBe(2);
  });
});
