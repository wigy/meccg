/**
 * @module rule-10.09-corruption-immunity
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.09: Corruption Immunity
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Allies, Ringwraiths, and Balrogs are not affected by corruption and never make corruption checks, but may still fulfill active conditions of effects that require a corruption check upon resolution (at which point any other effects are implemented but the corruption check is skipped).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, attachAllyToChar, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  GWAIHIR,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { FreeCouncilPhaseState } from '../../../index.js';
import type { CorruptionCheckAction } from '../../../types/actions-universal.js';

describe('Rule 10.09 — Corruption Immunity', () => {
  beforeEach(() => resetMint());

  test('Allies, Ringwraiths, and Balrogs not affected by corruption and never make corruption checks', () => {
    // Aragorn has ally Gwaihir. In the Free Council, only Aragorn gets a
    // corruption check action — Gwaihir (an ally) must not receive one.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const stateWithAlly = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, GWAIHIR);

    const aragornId = findCharInstanceId(stateWithAlly, RESOURCE_PLAYER, ARAGORN);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...stateWithAlly, phaseState: fcState };

    const checks = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'corruption-check') as { action: CorruptionCheckAction }[];

    // Only Aragorn gets a corruption check, not Gwaihir
    expect(checks).toHaveLength(1);
    expect(checks[0].action.characterId).toBe(aragornId);
  });
});
