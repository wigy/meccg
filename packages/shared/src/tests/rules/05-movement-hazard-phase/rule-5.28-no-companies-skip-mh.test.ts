/**
 * @module rule-5.28-no-companies-skip-mh
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.28: No Companies Skip M/H Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If the resource player has no companies, that player skips their movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';

describe('Rule 5.28 — No Companies Skip M/H Phase', () => {
  beforeEach(() => resetMint());

  test('If resource player has no companies, skip movement/hazard phase', () => {
    // P1 (active player) has no companies. When the long-event phase ends
    // and would normally transition to M/H phase, P1's M/H phase (and site
    // phase) must be skipped entirely, advancing directly to End-of-Turn.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [], hand: [], siteDeck: [RIVENDELL, MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const after = dispatch(base, { type: 'pass', player: PLAYER_1 });

    // M/H phase (and Site phase) must be skipped — should land in End-of-Turn
    expect(after.phaseState.phase).toBe(Phase.EndOfTurn);
  });
});
