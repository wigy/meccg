/**
 * @module rule-2.03-hazard-player-actions
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.03: Hazard Player Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The hazard player can only play hazards, and can only take hazard actions on their cards in play, during their opponent's movement/hazard phase. The hazard player cannot play resources nor take resource/character actions during their opponent's turn unless a rule or effect specifically allows them to do so.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS,
  GATES_OF_MORNING, SUN, CAVE_DRAKE, ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import type { EvaluatedAction } from '../../../index.js';

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

describe('Rule 2.03 — Hazard Player Actions', () => {
  beforeEach(() => resetMint());

  test('Hazard player has no viable play actions during opponent untap phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    // Hazard player should not have play-hazard actions during untap
    expect(viableOfType(actions, 'play-hazard')).toHaveLength(0);
  });

  test('Hazard player has no viable play actions during opponent organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    const viable = actions.filter(a => a.viable);
    // Hazard player should have no viable actions during opponent's organization phase
    expect(viable).toHaveLength(0);
  });

  test('Hazard player has no viable play actions during opponent long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    const viable = actions.filter(a => a.viable);
    // Hazard player should have no viable actions during opponent's long-event phase
    expect(viable).toHaveLength(0);
  });

  test('Hazard player cannot play resource cards during opponent turn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [GATES_OF_MORNING, SUN], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    // Hazard player should not be able to play resource events
    expect(viableOfType(actions, 'play-permanent-event')).toHaveLength(0);
    expect(viableOfType(actions, 'play-long-event')).toHaveLength(0);
    expect(viableOfType(actions, 'play-character')).toHaveLength(0);
  });
});
