/**
 * @module dm-108.test
 *
 * Card test: Little Snuffler (dm-108)
 * Type: hazard-creature
 * Effects: 2
 *
 * "Orc. One strike. Attacker chooses defending characters. Each ranger in
 * attacked company lowers Little Snuffler's body by 2. If attack is not
 * defeated, any resource that requires a scout in target company cannot be
 * played for the rest of the turn."
 *
 * This tests:
 * 1. combat-attacker-chooses-defenders — hazard player assigns strikes
 * 2. on-event: attack-not-defeated → deny-scout-resources constraint
 *
 * Note: the ranger body-reduction rule has no effect because the creature
 * has body: null (no body check occurs).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO,
  LITTLE_SNUFFLER, CONCEALMENT, STEALTH,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, buildSitePhaseState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch, expectInPile,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
import type { CardInstanceId } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Little Snuffler (dm-108)', () => {
  beforeEach(() => resetMint());


  test('attacker chooses defenders — hazard player assigns strikes', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [LITTLE_SNUFFLER],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const snufflerId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: snufflerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });

    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(5);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Attacker (P2) gets assign-strike actions — attacker-chooses-defenders
    const attackerActions = computeLegalActions(afterPass, PLAYER_2);
    const assignStrikes = attackerActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(assignStrikes).toHaveLength(2);

    // Defender (P1) should NOT have assign-strike actions
    const defenderActions = computeLegalActions(afterPass, PLAYER_1);
    const defAssigns = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defAssigns).toHaveLength(0);
  });

  test('attack defeated — creature to kill pile, no constraint added', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [LITTLE_SNUFFLER],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const snufflerId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: snufflerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window, then attacker assigns to Aragorn
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const aragornId = charIdAt(afterPass, 0);
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornId,
      tapped: false,
    });

    // Aragorn prowess 6 + high roll (12) easily beats creature prowess 5
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 12 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    const resolveAction = actions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // Combat finalized — creature should be in defender's kill pile
    expect(afterStrike.combat).toBeNull();
    expectInPile(afterStrike, 0, 'killPile', LITTLE_SNUFFLER);

    // No constraint should have been added
    expect(afterStrike.activeConstraints).toHaveLength(0);
  });

  test('attack not defeated — deny-scout-resources constraint added', () => {
    // Bilbo (prowess 1) can lose to prowess 5 creature
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [LITTLE_SNUFFLER],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const snufflerId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: snufflerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window, attacker assigns to Bilbo
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const bilboId = charIdAt(afterPass, 0);
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: bilboId,
      tapped: false,
    });

    // Low roll (2): Bilbo prowess 1 + 2 = 3 ≤ creature prowess 5 → strike fails
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 2 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    const resolveAction = actions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // Bilbo is wounded → body check
    if (afterStrike.combat?.phase === 'body-check') {
      // Bilbo body 9, roll high to survive the body check
      const bodyState = { ...afterStrike, cheatRollTotal: 2 };
      const bodyActions = computeLegalActions(bodyState, PLAYER_2);
      const bodyAction = bodyActions.find(a => a.viable && a.action.type === 'body-check-roll');
      expect(bodyAction).toBeDefined();
      const afterBody = dispatch(bodyState, bodyAction!.action);

      // Combat finalized — creature to attacker's discard (not defeated)
      expect(afterBody.combat).toBeNull();
      expectInPile(afterBody, 1, 'discardPile', LITTLE_SNUFFLER);

      // deny-scout-resources constraint should be added
      const constraints = afterBody.activeConstraints;
      expect(constraints.length).toBeGreaterThanOrEqual(1);
      const denyScout = constraints.find(c => c.kind.type === 'deny-scout-resources');
      expect(denyScout).toBeDefined();
      expect(denyScout!.scope).toEqual({ kind: 'turn' });
      expect(denyScout!.target).toEqual({ kind: 'company', companyId });
    } else {
      // Combat finalized directly (no body check since creature has no body)
      expect(afterStrike.combat).toBeNull();
      expectInPile(afterStrike, 1, 'discardPile', LITTLE_SNUFFLER);

      const constraints = afterStrike.activeConstraints;
      expect(constraints.length).toBeGreaterThanOrEqual(1);
      const denyScout = constraints.find(c => c.kind.type === 'deny-scout-resources');
      expect(denyScout).toBeDefined();
      expect(denyScout!.scope).toEqual({ kind: 'turn' });
      expect(denyScout!.target).toEqual({ kind: 'company', companyId });
    }
  });

  test('deny-scout-resources constraint blocks scout-requiring resources during site phase', () => {
    // Build a site phase state with Stealth (requires scout) and Concealment in hand
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [STEALTH, CONCEALMENT],
    });

    const companyId = companyIdAt(state, 0);

    // Add the deny-scout-resources constraint targeting P1's company
    const constrained = addConstraint(state, {
      source: 'fake-creature' as CardInstanceId,
      sourceDefinitionId: LITTLE_SNUFFLER,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'deny-scout-resources' },
    });

    // Check that scout-requiring short events are blocked
    const actions = computeLegalActions(constrained, PLAYER_1);

    // Stealth has play-target with scout filter — should be blocked
    const stealthActions = actions.filter(
      a => a.action.type === 'play-short-event'
        && (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId
        === constrained.players[0].hand.find(c => c.definitionId === STEALTH)?.instanceId,
    );
    expect(stealthActions.every(a => !a.viable || stealthActions.length === 0)).toBe(true);

    // Pass should always be available
    const passAction = actions.find(a => a.viable && a.action.type === 'pass');
    expect(passAction).toBeDefined();
  });
});
