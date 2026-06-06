/**
 * @module rule-8.27-no-return-during-attack
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.27: No Return to Origin During Attack
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Effects that return a company to its site of origin cannot be declared in the middle of an attack.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import { Phase, computeLegalActions } from '../../../index.js';
import { buildTestState, PLAYER_1, PLAYER_2, resetMint, makeCancelWindowCombat } from '../../test-helpers.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
const RIVENDELL = 'tw-d01' as CardDefinitionId;
const LEGOLAS = 'tw-126' as CardDefinitionId;
const LORIEN = 'tw-d06' as CardDefinitionId;

describe('Rule 8.27 — No Return to Origin During Attack', () => {
  beforeEach(() => resetMint());

  test('Neither player can declare haven-return during active combat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const state = makeCancelWindowCombat(base);
    expect(state.combat).not.toBeNull();

    for (const playerId of [PLAYER_1, PLAYER_2]) {
      const actions = computeLegalActions(state, playerId);
      const hasHavenReturn = actions.some(ea => ea.action.type === 'haven-return');
      expect(hasHavenReturn, `player ${playerId as string} has haven-return action during combat`).toBe(false);
    }
  });
});
