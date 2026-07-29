/**
 * @module dm-108.test
 *
 * Card test: Little Snuffler (dm-108)
 * Type: hazard-creature
 * Effects: 3
 *
 * "Orc. One strike. Attacker chooses defending characters. Each ranger in
 * attacked company lowers Little Snuffler's body by 2. If attack is not
 * defeated, any resource that requires a scout in target company cannot be
 * played for the rest of the turn."
 *
 * This tests:
 * 1. combat-attacker-chooses-defenders — hazard player assigns strikes
 * 2. on-event: attack-not-defeated → deny-scout-resources constraint
 * 3. Little Snuffler has body 10, so a parried strike requires a body check
 *    against the creature (CoE 3.iv.7 / 3.v) — it is NOT auto-defeated. The
 *    printed body of 10 was previously mis-recorded as null, which made the
 *    engine auto-defeat the creature with no body check (bug report: "was
 *    defeated without a body check").
 *
 * 4. combat-body-per-defender-skill — each ranger in the defending company
 *    lowers Little Snuffler's own body by 2 (resolved once at combat
 *    initiation; body checks are then taken against the reduced body).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO,
  LITTLE_SNUFFLER, CONCEALMENT, STEALTH,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, buildSitePhaseState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch, expectInPile, RESOURCE_PLAYER, HAZARD_PLAYER,
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

    const snufflerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const snufflerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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
    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER);
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornId,
      tapped: false,
    });

    // Aragorn prowess 6 + high roll (12) easily beats creature prowess 5 → strike parried
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 12 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    const resolveAction = actions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // Body 10 (not null): parrying the strike requires a body check vs the creature
    expect(afterStrike.combat).not.toBeNull();
    expect(afterStrike.combat!.phase).toBe('body-check');
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');

    // Hazard player rolls the creature body check; roll 12 > body 10 → check fails → creature defeated
    const bodyState = { ...afterStrike, cheatRollTotal: 12 };
    const bodyActions = computeLegalActions(bodyState, PLAYER_2);
    const bodyAction = bodyActions.find(a => a.viable && a.action.type === 'body-check-roll');
    expect(bodyAction).toBeDefined();
    const afterBody = dispatch(bodyState, bodyAction!.action);

    // Combat finalized — creature should be in defender's kill pile
    expect(afterBody.combat).toBeNull();
    expectInPile(afterBody, RESOURCE_PLAYER, 'killPile', LITTLE_SNUFFLER);

    // No constraint should have been added (attack was defeated)
    expect(afterBody.activeConstraints).toHaveLength(0);
  });

  test('REGRESSION: parried strike is not auto-defeated — body check required (body 10)', () => {
    // Bug report: Little Snuffler was "defeated without a body check". Root cause
    // was body: null in the card data, which made the engine auto-defeat the
    // creature on a parry (CoE 3.iv.7: a strike with no body is auto-defeated).
    // With the printed body of 10, a parried strike must roll a body check, and a
    // surviving body check means the creature is discarded (not taken for kill MP).
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

    const snufflerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: snufflerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER);
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornId,
      tapped: false,
    });

    // Aragorn prowess 6 + roll 12 = 18 > creature prowess 5 → strike parried
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 12 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    const resolveAction = actions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // The fix: a body check is REQUIRED — the creature is not auto-defeated.
    expect(afterStrike.combat).not.toBeNull();
    expect(afterStrike.combat!.phase).toBe('body-check');
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');

    // Low body-check roll (2 ≤ body 10) → body check passes → strike not defeated
    const bodyState = { ...afterStrike, cheatRollTotal: 2 };
    const bodyActions = computeLegalActions(bodyState, PLAYER_2);
    const bodyAction = bodyActions.find(a => a.viable && a.action.type === 'body-check-roll');
    expect(bodyAction).toBeDefined();
    const afterBody = dispatch(bodyState, bodyAction!.action);

    // Creature survives the body check → discarded to hazard discard, NOT taken
    // for kill MP. (Before the fix it went straight to the kill pile.)
    expect(afterBody.combat).toBeNull();
    expectInPile(afterBody, HAZARD_PLAYER, 'discardPile', LITTLE_SNUFFLER);
    expect(afterBody.players[0].killPile.some(c => c.definitionId === LITTLE_SNUFFLER)).toBe(false);

    // Attack was not defeated → deny-scout-resources constraint added
    const denyScout = afterBody.activeConstraints.find(c => c.kind.type === 'deny-scout-resources');
    expect(denyScout).toBeDefined();
    expect(denyScout!.target).toEqual({ kind: 'company', companyId });
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

    const snufflerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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
    const bilboId = charIdAt(afterPass, RESOURCE_PLAYER);
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
      expectInPile(afterBody, HAZARD_PLAYER, 'discardPile', LITTLE_SNUFFLER);

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
      expectInPile(afterStrike, HAZARD_PLAYER, 'discardPile', LITTLE_SNUFFLER);

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

    const companyId = companyIdAt(state, RESOURCE_PLAYER);

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

  test('REGRESSION: ranger in defending company lowers creature body by 2 (bug report: body check needed 11+ instead of 9+)', () => {
    // Bug report: a defending company containing a ranger (Aragorn) still
    // faced a body check needing 11+ (full body 10) — the "Each ranger in
    // attacked company lowers Little Snuffler's body by 2" clause was not
    // implemented. Aragorn is a ranger (skills: warrior/scout/ranger);
    // Legolas is not, so the company has exactly one ranger.
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

    const snufflerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: snufflerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // One ranger (Aragorn) in the defending company → body 10 - 2 = 8.
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureBody).toBe(8);

    // Defender passes cancel-window, attacker assigns to Legolas (non-ranger,
    // prowess 5) so the strike is parried on a moderate roll.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const legolasId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: legolasId,
      tapped: false,
    });

    // Legolas prowess 5 + roll 12 = 17 > creature prowess 5 → strike parried
    const stateWithRoll = { ...afterAssign, cheatRollTotal: 12 };
    const actions = computeLegalActions(stateWithRoll, PLAYER_1);
    const resolveAction = actions.find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const afterStrike = dispatch(stateWithRoll, resolveAction!.action);

    // Body check is now taken against the reduced body of 8 (need 9+), not
    // the printed body of 10 (need 11+).
    expect(afterStrike.combat).not.toBeNull();
    expect(afterStrike.combat!.phase).toBe('body-check');
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');
    expect(afterStrike.combat!.creatureBody).toBe(8);

    const bodyActions = computeLegalActions(afterStrike, PLAYER_2);
    const bodyAction = bodyActions.find(a => a.viable && a.action.type === 'body-check-roll');
    expect(bodyAction).toBeDefined();
    expect((bodyAction!.action as { need?: number }).need).toBe(9);
  });
});
