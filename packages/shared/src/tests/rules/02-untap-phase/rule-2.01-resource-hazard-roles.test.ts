/**
 * @module rule-2.01-resource-hazard-roles
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.01: Resource/Hazard Player Roles
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * For the sake of clarity in the following rules, the "resource player" refers to the player whose turn it is, while the "hazard player" is their opponent.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

describe('Rule 2.01 — Resource/Hazard Player Roles', () => {
  beforeEach(() => resetMint());

  test('When PLAYER_1 is active, PLAYER_1 is resource player and PLAYER_2 is hazard player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // PLAYER_1 is active → resource player → gets untap action
    const p1Actions = computeLegalActions(state, PLAYER_1);
    const p1Viable = p1Actions.filter(a => a.viable);
    expect(p1Viable.some(a => a.action.type === 'untap')).toBe(true);

    // PLAYER_2 is not active → hazard player → gets pass (not untap)
    const p2Actions = computeLegalActions(state, PLAYER_2);
    const p2Viable = p2Actions.filter(a => a.viable);
    expect(p2Viable.some(a => a.action.type === 'pass')).toBe(true);
    expect(p2Viable.some(a => a.action.type === 'untap')).toBe(false);
  });

  test('When PLAYER_2 is active, PLAYER_2 is resource player and PLAYER_1 is hazard player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // PLAYER_2 is active → resource player → gets untap action
    const p2Actions = computeLegalActions(state, PLAYER_2);
    const p2Viable = p2Actions.filter(a => a.viable);
    expect(p2Viable.some(a => a.action.type === 'untap')).toBe(true);

    // PLAYER_1 is not active → hazard player → gets pass (not untap)
    const p1Actions = computeLegalActions(state, PLAYER_1);
    const p1Viable = p1Actions.filter(a => a.viable);
    expect(p1Viable.some(a => a.action.type === 'pass')).toBe(true);
    expect(p1Viable.some(a => a.action.type === 'untap')).toBe(false);
  });
});
