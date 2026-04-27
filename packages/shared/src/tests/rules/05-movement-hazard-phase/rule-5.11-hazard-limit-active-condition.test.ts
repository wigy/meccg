/**
 * @module rule-5.11-hazard-limit-active-condition
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.11: Hazard Limit as Active Condition
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Not exceeding the hazard limit is treated as an active condition of the hazard player taking actions during the entirety of a movement/hazard phase; there must be fewer declared actions that count against the hazard limit when compared to that hazard limit at declaration, and there must be no more declared actions that count against the hazard limit when compared to that hazard limit at resolution.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, nonViableOfType, makeShadowMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  EYE_OF_SAURON,
  Phase,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

describe('Rule 5.11 — Hazard Limit as Active Condition', () => {
  beforeEach(() => resetMint());

  test('Hazard action offered as viable when hazard count is below limit', () => {
    // hazardsPlayedThisCompany=0 < hazardLimitAtReveal=2 → Eye of Sauron is viable
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }) };

    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
  });

  test('Hazard action offered as non-viable when hazard limit is reached', () => {
    // hazardsPlayedThisCompany=2 >= hazardLimitAtReveal=2 → Eye of Sauron is non-viable
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 2 }) };

    // Eye of Sauron must be listed but not viable (limit reached)
    const allActions = computeLegalActions(state, PLAYER_2);
    const nonViable = nonViableOfType(allActions, 'play-hazard');
    const eyeInst = state.players[1].hand[0].instanceId;
    expect(nonViable.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === eyeInst)).toBe(true);
  });

  test('Hazard action with hazard limit of 1 is non-viable when one hazard already played', () => {
    // hazardsPlayedThisCompany=1 >= hazardLimitAtReveal=1 → no more plays allowed
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeShadowMHState({ hazardLimitAtReveal: 1, hazardsPlayedThisCompany: 1 }) };

    const viable = viableActions(state, PLAYER_2, 'play-hazard');
    expect(viable).toHaveLength(0);
  });
});
