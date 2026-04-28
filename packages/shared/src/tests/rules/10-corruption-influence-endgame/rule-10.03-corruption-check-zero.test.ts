/**
 * @module rule-10.03-corruption-check-zero
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.03: Corruption Check at Zero
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a character is required to make a corruption check, the corruption check must be made even if the character has zero corruption points.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';
import type { FreeCouncilPhaseState } from '../../../index.js';
import type { CorruptionCheckAction } from '../../../types/actions-universal.js';

describe('Rule 10.03 — Corruption Check at Zero', () => {
  beforeEach(() => resetMint());

  test('Corruption check must be made even if character has zero corruption points', () => {
    // Aragorn carries no items and has 0 corruption points. In the Free
    // Council phase, the engine must still offer a corruption-check action
    // for him, because the rule requires every character to be checked.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornInstId = base.players[RESOURCE_PLAYER].companies[0].characters[0];

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };

    const state = { ...base, phaseState: fcState };
    const checks = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'corruption-check') as { action: CorruptionCheckAction }[];

    expect(checks.some(a => a.action.characterId === aragornInstId)).toBe(true);
    // Aragorn has 0 CP and 0 modifier — the need is 1 (roll > 0)
    const check = checks.find(a => a.action.characterId === aragornInstId)!;
    expect(check.action.corruptionPoints).toBe(0);
  });
});
