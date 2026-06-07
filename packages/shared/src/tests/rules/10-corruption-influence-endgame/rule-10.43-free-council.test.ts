/**
 * @module rule-10.43-free-council
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.43: Free Council / Determining the Winner
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The Free Council / Audience with Sauron / Day of Reckoning / Day of Decision - When the game ends after being called and any subsequent turns have been completed, the winner is determined by proceeding through the following steps (10.3.i-vi) in order, prior to which characters do not automatically untap, during which no actions may be taken unless otherwise noted, and during which long- and permanent-events in play are still active.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase } from '../../../index.js';
import type { FreeCouncilPhaseState } from '../../../index.js';
import {
  buildTestState, resetMint, viableFor,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  findCharInstanceId,
} from '../../test-helpers.js';

describe('Rule 10.43 — Free Council / Determining the Winner', () => {
  beforeEach(() => resetMint());

  test('Non-current player has no actions during Free Council corruption checks', () => {
    // Rule 10.43: "no actions may be taken unless otherwise noted."
    // During the corruption-checks step, only the currentPlayer may declare
    // corruption checks or pass. The other player must wait and cannot take
    // any normal resource/character/hazard actions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [aragornId],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...base, phaseState: fcState };

    // PLAYER_1 is the currentPlayer — they get exactly one pass action
    const p1Actions = viableFor(state, PLAYER_1);
    expect(p1Actions.some(a => a.action.type === 'pass')).toBe(true);

    // PLAYER_2 is NOT the currentPlayer — they get no viable actions
    const p2Actions = viableFor(state, PLAYER_2);
    expect(p2Actions).toHaveLength(0);
  });

  test.todo('When game ends: characters do not auto-untap; long/permanent-events still active');
});
