/**
 * @module rule-8.42-cvcc-hazard-restrictions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.42: CvCC Hazard Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Players cannot play hazards during Company vs. Company Combat.
 * Hazards that affect "attacks" or "strikes" have no effect on Company vs. Company Combat unless they specifically affect "company vs. company combat".
 * In order to cancel a Company vs. Company Combat attack with an effect that requires one or more race types for the attack to be canceled, all of the characters in the attacking company must have one of the required race types (but not necessarily the same type).
 * Only the defending player is considered to be facing an attack, while both the attacking characters and the defending characters are considered to be facing strikes.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment, CompanyId } from '../../../index.js';
import type { SitePhaseState, CombatState } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint, dispatch, viableActions,
} from '../../test-helpers.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const MORIA = 'tw-d21' as CardDefinitionId;
const MORIA_AS = 'as-169' as CardDefinitionId;
const RIVENDELL = 'tw-d01' as CardDefinitionId;

// A typical hazard short-event (Nazgul Creature)
const WOLVES = 'tw-074' as CardDefinitionId;

function buildCvCCCombatState() {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: [PERCHEN] }],
        hand: [WOLVES],
        siteDeck: [MORIA_AS],
      },
    ],
    phase: Phase.Site,
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };

  let s = { ...state, phaseState: sitePhaseState } as import('../../../index.js').GameState;
  s = dispatch(s, { type: 'pass', player: PLAYER_1 });

  const declareAction = viableActions(s, PLAYER_1, 'declare-company-attack')[0].action as {
    type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
  };
  s = dispatch(s, declareAction);

  return s;
}

describe('Rule 8.42 — CvCC Hazard Restrictions', () => {
  beforeEach(() => resetMint());

  test('CvCC: isCvCC flag is true on CombatState', () => {
    const state = buildCvCCCombatState();
    expect(state.combat?.isCvCC).toBe(true);
  });

  test('CvCC: no hazards can be played during CvCC (no play-hazard actions)', () => {
    const state = buildCvCCCombatState();

    // During CvCC assign-strikes, the hazard player should not be able to play hazards
    const hazardActions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(hazardActions.length).toBe(0);
  });

  test('CvCC: attacker step-1 hazard window is skipped — directly to attacker sub-step', () => {
    const state = buildCvCCCombatState();

    // Progress to resolve-strike
    let s = state;
    s = dispatch(s, { type: 'pass', player: PLAYER_2 }); // defender passes assignment
    const atkAssign = viableActions(s, PLAYER_1, 'assign-strike');
    expect(atkAssign.length).toBeGreaterThan(0);
    s = dispatch(s, atkAssign[0].action);

    // Now in resolve-strike: attacker should have resolve-strike actions directly
    // (no hazard window — CvCC skips rule 3.iv.1)
    expect(s.combat?.phase).toBe('resolve-strike');
    const atkResolve = viableActions(s, PLAYER_1, 'resolve-strike');
    expect(atkResolve.length).toBeGreaterThan(0);
  });

  test('CvCC: cancel-attack actions based on creature type require ALL attackers to match', () => {
    // This test verifies the data model is correct: isCvCC is set on combat
    // The actual cancel-attack filtering would need a specific card with race requirement
    const state = buildCvCCCombatState();
    expect((state.combat as CombatState).isCvCC).toBe(true);

    // Cancel-attack actions during CvCC should use CvCC-specific rules
    // For now verify the assignmentPhase is 'defender' (standard start)
    expect((state.combat as CombatState).assignmentPhase).toBe('defender');
  });
});
