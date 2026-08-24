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
import type { SitePhaseState, GameState } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint, dispatch, dispatchResult, viableActions,
} from '../../test-helpers.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
// tw-168: Legolas Greenleaf — hero character (mind 6, homesite: Thranduil's Halls)
const LEGOLAS_TW = 'tw-168' as CardDefinitionId;
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

  test('CvCC: strike is not re-fought after the defender survives the body check', () => {
    // Bug report: attacking with a single character (e.g. Akhôrahil) against a
    // single defender caused the engine to re-roll the same strike forever
    // instead of concluding after one body check, because resolveStrikeCvCC
    // leaves the strike `resolved: false` pending its body check and the
    // "survives" outcome never flipped it back to `true`.
    let state = buildCvCCInResolveStrike();

    // Attacker (Aragorn, prowess 6) taps to fight.
    state = dispatch(state, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });

    // Force the attacker's roll to the maximum (12 + prowess 6 = 18), which
    // beats any possible defender roll (Perchen, prowess 3: max 12 + 3 = 15) —
    // deterministically wins the strike regardless of RNG.
    state = { ...state, cheatRollTotal: 12 };
    state = dispatch(state, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    expect(state.combat?.phase).toBe('body-check');
    expect(state.combat?.bodyCheckTarget).toBe('character');
    expect(state.combat?.strikeAssignments[0].resolved).toBe(false);

    // Force the body check roll low (2), which survives against Perchen's body 9.
    state = { ...state, cheatRollTotal: 2 };
    const bodyCheckActions = viableActions(state, PLAYER_1, 'body-check-roll');
    expect(bodyCheckActions.length).toBeGreaterThan(0);
    state = dispatch(state, bodyCheckActions[0].action);

    // With only one strike assigned, a resolved (surviving) strike must
    // finalize combat rather than looping back into resolve-strike for the
    // same, already-fought strike.
    expect(state.combat).toBeNull();
  });

  test('CvCC: attacker distributes excess strikes as -1 prowess each', () => {
    // P1 has 2 attackers (Aragorn + Legolas) vs P2's single defender (Perchen).
    // After Aragorn is assigned to Perchen, Legolas has no defender to pair with
    // → 1 excess strike lands in cvccExcessPool. The attacker may then allocate
    // it as -1 to the current strike before declaring their tap/untap choice.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS_TW] }],
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

    let s = { ...state, phaseState: sitePhaseState } as GameState;

    // Pass play-resources to enter declare-company-attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    // Declare CvCC
    const declareActions = viableActions(s, PLAYER_1, 'declare-company-attack');
    const declareAction = declareActions[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);

    // strikesTotal must be 2 (both Aragorn and Legolas are attackers)
    expect(s.combat?.strikesTotal).toBe(2);

    // Defender passes — lets attacker decide pairings
    s = dispatch(s, { type: 'pass', player: PLAYER_2 });

    // Attacker assigns one of their characters to Perchen (takes first action)
    const atkAssignActions = viableActions(s, PLAYER_1, 'assign-strike');
    expect(atkAssignActions.length).toBeGreaterThan(0);
    s = dispatch(s, atkAssignActions[0].action);

    // No more unassigned defenders → attacker must pass to finalize
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    // One excess strike: Legolas was unpaired
    expect(s.combat?.cvccExcessPool).toBe(1);

    // allocate-cvcc-excess must be offered to the attacker before tap choice
    const excessActions = viableActions(s, PLAYER_1, 'allocate-cvcc-excess');
    expect(excessActions.length).toBe(1);

    // After allocating, the pool is consumed and the defender's strike carries +1 excess
    s = dispatch(s, excessActions[0].action);
    expect(s.combat?.cvccExcessPool).toBeUndefined();
    expect(s.combat?.strikeAssignments[0].excessStrikes).toBe(1);
  });

  test('CvCC: excess strike -1 prowess penalty is applied when the strike is resolved', () => {
    // Bug report: engine allocated the excess strike as a -1 prowess penalty
    // on the defender's strike assignment, but resolveStrikeCvCC never
    // subtracted it when computing the defender's roll — the defender kept
    // full prowess. Same setup as the previous test (Aragorn prowess 6 +
    // Legolas vs Perchen prowess 3, Legolas unpaired → 1 excess strike on
    // Perchen), continued through strike resolution.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS_TW] }],
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

    let s = { ...state, phaseState: sitePhaseState } as GameState;

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    const declareActions = viableActions(s, PLAYER_1, 'declare-company-attack');
    const declareAction = declareActions[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);

    s = dispatch(s, { type: 'pass', player: PLAYER_2 });

    const atkAssignActions = viableActions(s, PLAYER_1, 'assign-strike');
    s = dispatch(s, atkAssignActions[0].action);

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    expect(s.combat?.cvccExcessPool).toBe(1);
    const excessActions = viableActions(s, PLAYER_1, 'allocate-cvcc-excess');
    s = dispatch(s, excessActions[0].action);
    expect(s.combat?.strikeAssignments[0].excessStrikes).toBe(1);

    // Attacker taps to fight (full prowess 6, Aragorn is untapped).
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });

    // Defender taps to fight (full prowess 3, minus the 1 excess strike → 2).
    const result = dispatchResult(s, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    const defEffect = result.effects?.find(
      e => e.effect === 'dice-roll' && e.label === 'CvCC Strike: Perchen',
    ) as { die1: number; die2: number; total?: number } | undefined;
    expect(defEffect).toBeDefined();
    const defProwessUsed = (defEffect?.total ?? 0) - (defEffect?.die1 ?? 0) - (defEffect?.die2 ?? 0);
    expect(defProwessUsed).toBe(2);
  });
});
