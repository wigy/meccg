/**
 * @module rule-2.13-hazard-sideboard-access
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.13: Hazard Sideboard Access at Untap
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * At the end of the untap phase, if the resource player's avatar is in play (or the resource player is Sauron), the hazard player may either:
 * • bring up to five hazards from their sideboard to their discard pile.
 * • if the hazard player's play deck has at least five cards, bring one hazard from their sideboard directly into their play deck and then shuffle.
 * The types of the cards must be revealed to confirm that they are hazards, but the actual card names don't need to be revealed. This action can only be taken once per turn, and if the hazard player takes this action, the base hazard limit for each of the resource player's companies at the start of this turn's movement/hazard phase(s) is halved (rounded up).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, reduce, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ARAGORN,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makePlayDeck,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import type { EvaluatedAction } from '../../../index.js';

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

describe('Rule 2.13 — Hazard Sideboard Access at Untap', () => {
  beforeEach(() => resetMint());

  test('Hazard player gets sideboard intent actions when resource player avatar is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: makePlayDeck(),
          sideboard: [CAVE_DRAKE, ORC_PATROL],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    const startToDiscard = viableOfType(actions, 'start-hazard-sideboard-to-discard');
    const startToDeck = viableOfType(actions, 'start-hazard-sideboard-to-deck');
    expect(startToDiscard).toHaveLength(1);
    expect(startToDeck).toHaveLength(1);
  });

  test('No hazard sideboard access if resource player has no avatar in play', () => {
    // Aragorn is not an avatar — P2 should not get sideboard access
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          sideboard: [CAVE_DRAKE],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    expect(viableOfType(actions, 'start-hazard-sideboard-to-deck')).toHaveLength(0);
    expect(viableOfType(actions, 'start-hazard-sideboard-to-discard')).toHaveLength(0);
  });

  test('Sideboard to discard: fetch up to 5 hazards, then pass exits sub-flow', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          sideboard: [CAVE_DRAKE, ORC_PATROL],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    // Start to discard
    const startResult = reduce(state, viableOfType(computeLegalActions(state, PLAYER_2), 'start-hazard-sideboard-to-discard')[0].action);
    expect(startResult.error).toBeUndefined();

    // Must fetch at least 1 before passing
    let fetchActions = computeLegalActions(startResult.state, PLAYER_2);
    expect(viableOfType(fetchActions, 'pass')).toHaveLength(0);
    expect(viableOfType(fetchActions, 'fetch-hazard-from-sideboard').length).toBeGreaterThan(0);

    // Fetch 1 card
    const fetchResult = reduce(startResult.state, viableOfType(fetchActions, 'fetch-hazard-from-sideboard')[0].action);
    expect(fetchResult.error).toBeUndefined();

    // Now pass is available
    fetchActions = computeLegalActions(fetchResult.state, PLAYER_2);
    expect(viableOfType(fetchActions, 'pass')).toHaveLength(1);

    // Pass exits sub-flow and marks sideboard accessed
    const passResult = reduce(fetchResult.state, viableOfType(fetchActions, 'pass')[0].action);
    expect(passResult.error).toBeUndefined();
    expect(passResult.state.players.find(p => p.id === PLAYER_2)!.sideboardAccessedDuringUntap).toBe(true);
  });

  test('Sideboard to deck: fetch exactly 1 hazard, then sub-flow exits', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: makePlayDeck(),
          sideboard: [CAVE_DRAKE],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    // Start to deck
    const startResult = reduce(state, viableOfType(computeLegalActions(state, PLAYER_2), 'start-hazard-sideboard-to-deck')[0].action);
    expect(startResult.error).toBeUndefined();

    // Fetch 1 card (no pass allowed — must pick)
    const fetchActions = computeLegalActions(startResult.state, PLAYER_2);
    const fetches = viableOfType(fetchActions, 'fetch-hazard-from-sideboard');
    expect(fetches).toHaveLength(1);
    expect(viableOfType(fetchActions, 'pass')).toHaveLength(0);

    const deckBefore = startResult.state.players.find(p => p.id === PLAYER_2)!.playDeck.length;
    const fetchResult = reduce(startResult.state, fetches[0].action);
    expect(fetchResult.error).toBeUndefined();

    const p2 = fetchResult.state.players.find(p => p.id === PLAYER_2)!;
    expect(p2.sideboard).toHaveLength(0);
    expect(p2.playDeck.length).toBe(deckBefore + 1);
    expect(p2.sideboardAccessedDuringUntap).toBe(true);
  });

  test('Sideboard to deck requires play deck to have at least 5 cards', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: [CAVE_DRAKE, ORC_PATROL], // Only 2 cards — below 5
          sideboard: [BARROW_WIGHT],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    // To-deck should not be available (deck < 5)
    expect(viableOfType(actions, 'start-hazard-sideboard-to-deck')).toHaveLength(0);
    // To-discard should still be available
    expect(viableOfType(actions, 'start-hazard-sideboard-to-discard')).toHaveLength(1);
  });

  test('Sideboard access marks sideboardAccessedDuringUntap which halves hazard limits', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          sideboard: [CAVE_DRAKE],
          companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }],
        },
      ],
    });

    // Before access
    expect(state.players.find(p => p.id === PLAYER_2)!.sideboardAccessedDuringUntap).toBe(false);

    // Start to discard, fetch 1, pass
    const startResult = reduce(state, viableOfType(computeLegalActions(state, PLAYER_2), 'start-hazard-sideboard-to-discard')[0].action);
    const fetchResult = reduce(startResult.state, viableOfType(computeLegalActions(startResult.state, PLAYER_2), 'fetch-hazard-from-sideboard')[0].action);
    const passResult = reduce(fetchResult.state, viableOfType(computeLegalActions(fetchResult.state, PLAYER_2), 'pass')[0].action);

    // After access, sideboardAccessedDuringUntap should be true
    expect(passResult.state.players.find(p => p.id === PLAYER_2)!.sideboardAccessedDuringUntap).toBe(true);
  });

  test.todo('Sideboard access can only be taken once per turn');
});
