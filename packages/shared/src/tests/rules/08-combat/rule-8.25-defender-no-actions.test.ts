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
import { Phase } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  makeCancelWindowCombat,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
const RIVENDELL = 'tw-d01' as CardDefinitionId;
const LEGOLAS = 'tw-126' as CardDefinitionId;
const LORIEN = 'tw-d06' as CardDefinitionId;

describe('Rule 8.25 — Defending Player Action Restriction', () => {
  beforeEach(() => resetMint());

  test('Defending player gets only assign-strike/pass during creature combat (no resource actions)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const state = makeCancelWindowCombat(base);

    // state.combat != null — engine routes exclusively to combatActions
    expect(state.combat).not.toBeNull();
    expect(state.combat?.phase).toBe('assign-strikes');
    expect(state.combat?.assignmentPhase).toBe('defender');
    expect(state.combat?.defendingPlayerId).toBe(PLAYER_1);

    const actions = computeLegalActions(state, PLAYER_1).filter(ea => ea.viable);
    const actionTypes = new Set(actions.map(ea => ea.action.type));

    // Defender gets only combat assignment actions — no resource events or other actions
    for (const t of actionTypes) {
      expect(['assign-strike', 'pass']).toContain(t);
    }
  });
});
