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
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, reduce,
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

  test('active player passes to advance from untap phase', () => {
    let state = runFullSetup();
    expect(state.phaseState.phase).toBe(Phase.Untap);
    const activePlayer = state.activePlayer!;

    // Active player passes to advance
    state = runActions(state, [
      { type: 'pass', player: activePlayer },
    ]);

    // Should advance to organization phase
    expect(state.phaseState.phase).toBe(Phase.Organization);
  });

  test('non-active player has no legal actions during untap phase', () => {
    const state = runFullSetup();
    expect(state.phaseState.phase).toBe(Phase.Untap);
    const nonActivePlayer = state.players.find(p => p.id !== state.activePlayer)!.id;

    const actions = computeLegalActions(state, nonActivePlayer);
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(0);
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

    // Pass untap phase
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
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

    // Pass untap phase
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Wounded character at non-haven should remain wounded (inverted)
    const p1 = result.state.players[0];
    const charId = p1.companies[0].characters[0] as string;
    expect(p1.characters[charId].status).toBe(CardStatus.Inverted);
  });

  test.todo('[2.I] site cards do not untap during untap phase');

  test.todo('[2.I] hazard player may access sideboard if resource player avatar in play (halves hazard limit)');
});
