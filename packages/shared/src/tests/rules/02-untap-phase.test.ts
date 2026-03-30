/**
 * @module 02-untap-phase.test
 *
 * Tests for CoE Rules Section 2.I: Untap Phase.
 *
 * Rule references from docs/coe-rules.txt lines 179-183.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  runFullSetup, runActions,
  Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  CAVE_DRAKE, ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, reduce, makePlayDeck,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { EvaluatedAction } from '../../index.js';

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

describe('2.I Untap phase', () => {
  beforeEach(() => resetMint());

  test('resource player may untap tapped non-site cards', () => {
    const state = runFullSetup();

    // At start of turn 1 Untap phase, all characters should be untapped already
    expect(state.phaseState.phase).toBe(Phase.Untap);
    const activePlayer = state.activePlayer!;
    const playerIdx = state.players.findIndex(p => p.id === activePlayer);
    const player = state.players[playerIdx];

    for (const company of player.companies) {
      for (const charId of company.characters) {
        const char = player.characters[charId as string];
        expect(char.status).toBe('untapped');
      }
    }
  });

  test('both players pass to advance from untap phase', () => {
    let state = runFullSetup();
    expect(state.phaseState.phase).toBe(Phase.Untap);
    const activePlayer = state.activePlayer!;
    const hazardPlayer = state.players.find(p => p.id !== activePlayer)!.id;

    // Both players pass to advance
    state = runActions(state, [
      { type: 'pass', player: hazardPlayer },
      { type: 'pass', player: activePlayer },
    ]);

    // Should advance to organization phase
    expect(state.phaseState.phase).toBe(Phase.Organization);
  });

  test('non-active player can pass during untap phase', () => {
    const state = runFullSetup();
    expect(state.phaseState.phase).toBe(Phase.Untap);
    const nonActivePlayer = state.players.find(p => p.id !== state.activePlayer)!.id;

    const actions = computeLegalActions(state, nonActivePlayer);
    const viable = actions.filter(a => a.viable);
    // Hazard player gets pass + sideboard intent actions (opponent avatar in play)
    expect(viable.some(a => a.action.type === 'pass')).toBe(true);
  });

  test('untap phase actions: resource player can pass', () => {
    const state = runFullSetup();
    const activePlayer = state.activePlayer!;
    const actions = computeLegalActions(state, activePlayer);
    const passActions = viableOfType(actions, 'pass');
    expect(passActions.length).toBeGreaterThan(0);
  });

  test('[2.I] heal wounded characters at havens to tapped position', () => {
    // Place a wounded (inverted) Aragorn at Rivendell (a haven)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Both players pass untap phase
    let result = reduce(state, { type: 'pass', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Wounded character at haven should be healed to tapped (not untapped)
    const p1 = result.state.players[0];
    const charId = p1.companies[0].characters[0] as string;
    expect(p1.characters[charId].status).toBe(CardStatus.Tapped);
  });

  test('[2.I] wounded characters NOT at havens remain wounded', () => {
    // Place a wounded (inverted) Aragorn at Moria (not a haven)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Both players pass untap phase
    let result = reduce(state, { type: 'pass', player: PLAYER_2 });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Wounded character at non-haven should remain wounded (inverted)
    const p1 = result.state.players[0];
    const charId = p1.companies[0].characters[0] as string;
    expect(p1.characters[charId].status).toBe(CardStatus.Inverted);
  });

  test.todo('[2.I] site cards do not untap during untap phase');

  test('[2.I] hazard player gets sideboard intent actions when resource avatar in play', () => {
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
    expect(viableOfType(actions, 'pass')).toHaveLength(1);
  });

  test('[2.I] hazard sideboard to deck: fetch 1, then sub-flow exits', () => {
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

    // Fetch one card (must pick, no pass)
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

  test('[2.I] hazard sideboard to discard: fetch 1-5, pass when done', () => {
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

    // Must fetch at least 1 (no pass yet)
    let fetchActions = computeLegalActions(startResult.state, PLAYER_2);
    expect(viableOfType(fetchActions, 'pass')).toHaveLength(0);

    // Fetch 1 card
    const fetchResult = reduce(startResult.state, viableOfType(fetchActions, 'fetch-hazard-from-sideboard')[0].action);
    expect(fetchResult.error).toBeUndefined();

    // Now pass is available
    fetchActions = computeLegalActions(fetchResult.state, PLAYER_2);
    expect(viableOfType(fetchActions, 'pass')).toHaveLength(1);
    expect(viableOfType(fetchActions, 'fetch-hazard-from-sideboard')).toHaveLength(1);

    // Pass exits sub-flow and marks sideboard accessed
    const passResult = reduce(fetchResult.state, viableOfType(fetchActions, 'pass')[0].action);
    expect(passResult.error).toBeUndefined();
    expect(passResult.state.players.find(p => p.id === PLAYER_2)!.sideboardAccessedDuringUntap).toBe(true);
  });

  test('[2.I] no hazard sideboard access if resource player has no avatar', () => {
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
    // Hazard player still gets pass
    expect(viableOfType(actions, 'pass')).toHaveLength(1);
  });
});
