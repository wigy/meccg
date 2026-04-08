/**
 * @module rule-2.11-phase-transitions
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.11: Phase Transitions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * When players have finished taking actions during a phase and any end-of-phase actions have been resolved, the next phase begins immediately without an opportunity to take actions between phases or between turns.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, runActions, reduce, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING, STING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

describe('Rule 2.11 — Phase Transitions', () => {
  beforeEach(() => resetMint());

  test('Untap to Organization: no gap between phases', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Resource player untaps, hazard player passes → immediately in Organization
    const state2 = runActions(state, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(state2.phaseState.phase).toBe(Phase.Organization);

    // Organization phase actions should be immediately available
    const actions = computeLegalActions(state2, PLAYER_1);
    const viable = actions.filter(a => a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('Organization to Long-Event: first pass enters end-of-org window, second pass advances', () => {
    // CoE rule wording: end-of-organization-phase plays exist (e.g. Stealth,
    // Concealment) — the engine carries an `end-of-org` sub-step so those
    // cards have a window. A pass during the normal organization actions
    // step opens that window; a second pass closes it and advances to the
    // Long-event phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    // First pass: still in Organization, but at the end-of-org sub-step.
    const state2 = runActions(state, [{ type: 'pass', player: PLAYER_1 }]);
    expect(state2.phaseState.phase).toBe(Phase.Organization);
    expect((state2.phaseState as { step?: string }).step).toBe('end-of-org');

    // Second pass: advances to Long-event.
    const state3 = runActions(state2, [{ type: 'pass', player: PLAYER_1 }]);
    expect(state3.phaseState.phase).toBe(Phase.LongEvent);
  });

  test('Long-Event to Movement/Hazard: pass advances immediately', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    // Should advance to movement/hazard or site phase (depending on companies with movement)
    expect(result.state.phaseState.phase).not.toBe(Phase.LongEvent);
  });

  test('End-of-Turn to Untap: no opportunity to play between turns', () => {
    // Build hand arrays of exactly HAND_SIZE using various card defs
    const cardDefs = [GLAMDRING, STING, DAGGER_OF_WESTERNESSE, CAVE_DRAKE, ORC_PATROL,
      BARROW_WIGHT, SUN, EYE_OF_SAURON, GATES_OF_MORNING];
    const hand8 = cardDefs.slice(0, 8);

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: hand8, siteDeck: [MORIA], playDeck: cardDefs },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hand8, siteDeck: [MINAS_TIRITH], playDeck: cardDefs },
      ],
    });

    // Both players pass discard step
    let s = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // Both at hand size → both pass through reset-hand, advances to signal-end
    s = runActions(s, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // P1 passes signal-end → immediately in Untap, active player switches
    const result = reduce(s, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.Untap);
    expect(result.state.activePlayer).toBe(PLAYER_2);

    // No intermediate phase — Untap actions are immediately available for the new resource player
    const p2Actions = computeLegalActions(result.state, PLAYER_2);
    const p2Viable = p2Actions.filter(a => a.viable);
    expect(p2Viable.length).toBeGreaterThan(0);
  });
});
