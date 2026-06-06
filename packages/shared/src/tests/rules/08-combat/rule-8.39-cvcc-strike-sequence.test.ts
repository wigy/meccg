/**
 * @module rule-8.39-cvcc-strike-sequence
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.39: CvCC Strike Sequence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * CvCC Strike Sequence Steps:
 * Step 1 - Attacking player may play resources/take actions affecting strike resolution.
 * Step 2 - Attacking player allocates excess strikes as -1 prowess.
 * Step 3 - Attacking player may apply -3 to stay untapped.
 * Step 4 - Defending player may apply -3 to stay untapped.
 * Step 5 - Defending player may tap untapped characters for +1 support.
 * Step 6 - Defending player may play resources/take actions affecting strike.
 * Step 7 - Both players roll and add modified prowess; weapon mods first; tapped -1, wounded -2.
 * Step 8 - Compare rolls: higher wins (loser is wounded + body check), tie = both tapped.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment, CompanyId } from '../../../index.js';
import type { SitePhaseState } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint, dispatch, viableActions,
} from '../../test-helpers.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
const BILBO = 'tw-131' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const MORIA = 'tw-d21' as CardDefinitionId;
const MORIA_AS = 'as-169' as CardDefinitionId;
const RIVENDELL = 'tw-d01' as CardDefinitionId;

function buildCvCCInResolveStrike() {
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
        hand: [],
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

  // Pass play-resources to enter declare-company-attack
  s = dispatch(s, { type: 'pass', player: PLAYER_1 });

  // Declare CvCC
  const declareActions = viableActions(s, PLAYER_1, 'declare-company-attack');
  const declareAction = declareActions[0].action as {
    type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
  };
  s = dispatch(s, declareAction);

  // Defender passes (doesn't assign any characters)
  s = dispatch(s, { type: 'pass', player: PLAYER_2 });

  // Attacker assigns Aragorn to attack Perchen
  const atkAssignActions = viableActions(s, PLAYER_1, 'assign-strike');
  expect(atkAssignActions.length).toBeGreaterThan(0);
  s = dispatch(s, atkAssignActions[0].action);

  // Should now be in resolve-strike phase
  return s;
}

describe('Rule 8.39 — CvCC Strike Sequence', () => {
  beforeEach(() => resetMint());

  test('CvCC: two-step resolve — attacker declares tap choice first (sub-step 1)', () => {
    const state = buildCvCCInResolveStrike();

    expect(state.combat?.phase).toBe('resolve-strike');

    // Sub-step 1: only ATTACKER (PLAYER_1) gets resolve-strike actions
    const atkActions = viableActions(state, PLAYER_1, 'resolve-strike');
    expect(atkActions.length).toBeGreaterThan(0); // tap and/or untap

    // Defender must wait
    const defActions = viableActions(state, PLAYER_2, 'resolve-strike');
    expect(defActions.length).toBe(0);
  });

  test('CvCC: attacker can choose to tap (full prowess)', () => {
    const state = buildCvCCInResolveStrike();
    const atkActions = viableActions(state, PLAYER_1, 'resolve-strike');
    const tapAction = atkActions.find(ea => (ea.action as { tapToFight: boolean }).tapToFight === true);
    expect(tapAction).toBeDefined();
  });

  test('CvCC: attacker can choose to stay untapped (-3 prowess)', () => {
    const state = buildCvCCInResolveStrike();
    const atkActions = viableActions(state, PLAYER_1, 'resolve-strike');
    const untapAction = atkActions.find(ea => (ea.action as { tapToFight: boolean }).tapToFight === false);
    expect(untapAction).toBeDefined();
  });

  test('CvCC: after attacker declares -3 choice, defender gets resolve-strike actions (sub-step 2)', () => {
    const state = buildCvCCInResolveStrike();

    // Attacker declares tap
    const afterAtkDeclare = dispatch(state, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });

    // Now defender should get resolve-strike actions
    const defActions = viableActions(afterAtkDeclare, PLAYER_2, 'resolve-strike');
    expect(defActions.length).toBeGreaterThan(0);

    // Attacker should not get more actions in sub-step 2
    const atkActions = viableActions(afterAtkDeclare, PLAYER_1, 'resolve-strike');
    expect(atkActions.length).toBe(0);
  });

  test('CvCC: attackerTapToFight stored on strike assignment after sub-step 1', () => {
    const state = buildCvCCInResolveStrike();
    const afterAtkDeclare = dispatch(state, { type: 'resolve-strike', player: PLAYER_1, tapToFight: false, need: 2, explanation: '' });

    const strike = afterAtkDeclare.combat?.strikeAssignments[0];
    expect(strike?.attackerTapToFight).toBe(false);
  });

  test('CvCC: both roll after defender resolves — strike gets resolved', () => {
    let state = buildCvCCInResolveStrike();

    // Attacker taps
    state = dispatch(state, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });

    // Defender taps
    state = dispatch(state, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    // After both roll, the strike should be resolved or a body check/finalize should follow
    const combat = state.combat;
    if (combat) {
      // Either in body-check phase or strike is resolved
      const strike = combat.strikeAssignments[0];
      expect(strike?.resolved === true || combat.phase === 'body-check').toBe(true);
    } else {
      // Combat finalized (no body check needed in some outcomes)
      expect(state.combat).toBeNull();
    }
  });

  test('CvCC: attacker distributes excess strikes as -1 prowess each', () => {
    // P1 (Wizard) has 2 attackers (Aragorn + Bilbo); P2 (Ringwraith) has 1 defender (Perchen).
    // strikesTotal = 2 (attacker count). After Aragorn is paired with Perchen, no unassigned
    // defenders remain — P1 passes. The engine skips defender-any and sets cvccExcessPool=1.
    // P1 may then allocate that excess as a -1 modifier before resolving the strike.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [PERCHEN] }],
          hand: [],
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

    // Pass play-resources → declare-company-attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    // Declare CvCC
    const declareActions = viableActions(s, PLAYER_1, 'declare-company-attack');
    const declareAction = declareActions[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);

    // Defender passes (no pre-assignment)
    s = dispatch(s, { type: 'pass', player: PLAYER_2 });

    // Attacker assigns first available character to Perchen (e.g. Aragorn)
    const assignActions = viableActions(s, PLAYER_1, 'assign-strike');
    expect(assignActions.length).toBeGreaterThan(0);
    s = dispatch(s, assignActions[0].action);

    // No more unassigned defenders — P1 must pass; engine skips defender-any
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    // Excess pool should be 1 (2 attackers − 1 unique defender)
    expect(s.combat?.cvccExcessPool).toBe(1);

    // P1 gets allocate-cvcc-excess action alongside resolve-strike
    const excessActions = viableActions(s, PLAYER_1, 'allocate-cvcc-excess');
    expect(excessActions.length).toBe(1);

    // Allocate the excess: current strike gains excessStrikes = 1 (−1 to defender prowess)
    s = dispatch(s, { type: 'allocate-cvcc-excess', player: PLAYER_1 });

    const strike = s.combat?.strikeAssignments[s.combat.currentStrikeIndex];
    expect(strike?.excessStrikes).toBe(1);
    expect(s.combat?.cvccExcessPool).toBeUndefined();
  });
});
