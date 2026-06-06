/**
 * @module rule-8.25-defender-no-actions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.25: Defending Player Action Restriction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A defending player cannot take any actions during combat if they are facing an attack during their opponent's turn except as allowed for company vs. company combat, even if taking a particular action would normally be allowed during a combat step.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../../index.js';
import { Phase, computeLegalActions } from '../../../index.js';
import { buildTestState, PLAYER_1, PLAYER_2, resetMint, makeCancelWindowCombat } from '../../test-helpers.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
const RIVENDELL = 'tw-d01' as CardDefinitionId;
const LEGOLAS = 'tw-126' as CardDefinitionId;
const LORIEN = 'tw-d06' as CardDefinitionId;

describe('Rule 8.25 — Defending Player Action Restriction', () => {
  beforeEach(() => resetMint());

  test('Defending player gets only combat actions during creature combat on opponent turn', () => {
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
    expect(state.combat?.defendingPlayerId).toBe(PLAYER_1);

    const actions = computeLegalActions(state, PLAYER_1).filter(ea => ea.viable);
    const actionTypes = new Set(actions.map(ea => ea.action.type));

    // Defending player may only take combat-specific actions
    const COMBAT_TYPES = new Set(['assign-strike', 'pass', 'cancel-attack', 'halve-strikes',
      'protect-from-strike-assignment', 'modify-attack', 'company-combat-boost', 'haven-join-attack']);
    for (const t of actionTypes) {
      expect(COMBAT_TYPES.has(t), `unexpected action type "${t}" for defending player during combat`).toBe(true);
    }
  });
});
