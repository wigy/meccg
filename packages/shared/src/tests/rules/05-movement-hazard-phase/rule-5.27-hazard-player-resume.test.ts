/**
 * @module rule-5.27-hazard-player-resume
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.27: Hazard Player May Resume
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a hazard player declares that they are done taking actions during a movement/hazard phase and then the resource player takes another action in the same phase, the hazard player may resume taking actions.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GATES_OF_MORNING,
  makeMHState, handCardId,
} from '../../test-helpers.js';
import type { MovementHazardPhaseState } from '../../../index.js';

describe('Rule 5.27 — Hazard Player May Resume', () => {
  beforeEach(() => resetMint());

  test('If hazard player declares done but resource player acts, hazard player may resume', () => {
    // Hazard player has passed (hazardPlayerPassed: true).
    // Resource player plays Gates of Morning (permanent event).
    // After that action, hazardPlayerPassed must be reset to false.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Hazard player has already declared done (passed) in the play-hazards step
    const mhState = makeMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 2, hazardPlayerPassed: true });
    const stateAtMH = { ...base, phaseState: mhState };

    // Resource player plays Gates of Morning — a permanent event from hand
    const gomId = handCardId(stateAtMH, RESOURCE_PLAYER);
    const after = dispatch(stateAtMH, { type: 'play-permanent-event', player: PLAYER_1, cardInstanceId: gomId });

    // Hazard player's pass must be cleared — they can still take actions this company's M/H phase
    const afterMH = after.phaseState as MovementHazardPhaseState;
    expect(afterMH.hazardPlayerPassed).toBe(false);
  });
});
