/**
 * @module tw-008.test
 *
 * Card test: Assassin (tw-8)
 * Type: hazard-creature
 * Effects: 3
 *
 * "Man. Three attacks (of one strike each) all against the same character.
 * Attacker chooses defending character. One or two of these attacks may be
 * canceled by tapping one character (not the defending character) in the
 * defender's company for each attack canceled. This may be done even after
 * a strike is assigned and after facing another attack. If an attack from
 * Assassin is given more than one strike, each additional strike becomes
 * an excess strike (-1 prowess modification) against the attacked character."
 *
 * This tests the three effects:
 * 1. combat-attacker-chooses-defenders — attacker assigns strikes
 * 2. combat-multi-attack (count: 3) — three strikes auto-assigned to one target
 * 3. combat-cancel-attack-by-tap (maxCancels: 2) — defender taps to cancel
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  ASSASSIN,
  RIVENDELL, LORIEN, MINAS_TIRITH, BREE,
  buildTestState, resetMint, makeMHState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Assassin (tw-8)', () => {
  beforeEach(() => resetMint());


  test('combat initiates with attacker assignment, 3 total strikes, and forceSingleTarget', () => {
    // P1 active with 2 characters moving to Bree (border-hold)
    // P2 (hazard player) has Assassin in hand
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    // P2 plays Assassin targeting P1's company
    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });

    // Resolve chain → combat initiates
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    // Multi-attack: 3 attacks × 1 strike = 3 total strikes
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(11);
    expect(afterChain.combat!.forceSingleTarget).toBe(true);
    expect(afterChain.combat!.cancelByTapRemaining).toBe(2);
  });

  test('attacker assigns one character and all 3 strikes auto-assigned to that target', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Attacker gets assign-strike actions for both characters
    const attackerActions = computeLegalActions(afterPass, PLAYER_2);
    const assignStrikes = attackerActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(assignStrikes).toHaveLength(2); // Can target either character

    // Attacker assigns to Aragorn
    const aragornCharId = charIdAt(afterPass, 0);
    const assignResult = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // All 3 strikes are now assigned to Aragorn
    const combat = assignResult.combat!;
    expect(combat.strikeAssignments).toHaveLength(3);
    expect(combat.strikeAssignments.every(sa => sa.characterId === aragornCharId)).toBe(true);

    // Should be in cancel-by-tap sub-phase
    expect(combat.assignmentPhase).toBe('cancel-by-tap');
  });

  test('defender can cancel attacks by tapping non-target characters', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Attacker assigns to first character (Aragorn)
    const aragornCharId = charIdAt(afterPass, 0, 0, 0);
    const legolasCharId = charIdAt(afterPass, 0, 0, 1);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });
    expect(r2.combat!.assignmentPhase).toBe('cancel-by-tap');

    // Defender (P1) gets cancel-by-tap actions for non-target characters
    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-by-tap',
    );
    // Legolas and Gimli can tap (not Aragorn, the target)
    expect(cancelActions).toHaveLength(2);
    const passActions = defActions.filter(
      a => a.viable && a.action.type === 'pass',
    );
    expect(passActions).toHaveLength(1);

    // Defender taps Legolas to cancel one attack
    const r3 = dispatch(r2, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasCharId,
    });
    expect(r3.combat!.strikeAssignments).toHaveLength(2);
    expect(r3.combat!.strikesTotal).toBe(2);
    // Legolas is now tapped
    expect(r3.players[0].characters[legolasCharId as string].status).toBe('tapped');
  });

  test('cancel-by-tap respects maxCancels limit (max 2)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, 0, 0, 0);
    const legolasCharId = charIdAt(afterPass, 0, 0, 1);
    const gimliCharId = charIdAt(afterPass, 0, 0, 2);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Cancel first attack
    const r3 = dispatch(r2, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasCharId,
    });
    expect(r3.combat!.cancelByTapRemaining).toBe(1);

    // Cancel second attack
    const r4 = dispatch(r3, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: gimliCharId,
    });
    // After 2 cancels (maxCancels), should proceed to resolution
    expect(r4.combat!.strikeAssignments).toHaveLength(1);
    expect(r4.combat!.assignmentPhase).toBe('done');
    // Should be in resolve-strike phase (auto-selected since only 1 strike)
    expect(r4.combat!.phase).toBe('resolve-strike');
  });

  test('defender can pass cancel-by-tap to proceed with remaining strikes', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, 0);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });
    expect(r2.combat!.assignmentPhase).toBe('cancel-by-tap');

    // Defender passes without canceling
    const r3 = dispatch(r2, { type: 'pass', player: PLAYER_1 });
    expect(r3.combat!.assignmentPhase).toBe('done');
    // 3 strikes remain, defender chooses resolution order
    expect(r3.combat!.strikeAssignments).toHaveLength(3);
    expect(r3.combat!.phase).toBe('choose-strike-order');
  });

  test('canceling all 3 attacks ends combat (creature goes to discard)', () => {
    // This requires 3 non-target characters — but maxCancels is 2, so
    // the defender cannot cancel all 3. With 2 cancels, 1 strike remains.
    // Let's verify that: with 2 cancels on a 3-attack creature, 1 remains.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, 0, 0, 0);
    const legolasCharId = charIdAt(afterPass, 0, 0, 1);
    const gimliCharId = charIdAt(afterPass, 0, 0, 2);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Cancel 2 of 3 attacks
    const r3 = dispatch(r2, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasCharId,
    });
    const r4 = dispatch(r3, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: gimliCharId,
    });

    // 1 strike remains — combat continues with resolve-strike
    expect(r4.combat).not.toBeNull();
    expect(r4.combat!.strikeAssignments).toHaveLength(1);
    expect(r4.combat!.phase).toBe('resolve-strike');
  });

  test('defender gets NO assign-strike actions (attacker chooses)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender (P1) should NOT have assign-strike actions
    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const defenderAssignStrikes = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defenderAssignStrikes).toHaveLength(0);
  });

  test('only non-target untapped characters can cancel-by-tap', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          // Only 2 characters — one will be the target, one can cancel
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, 0);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Only Legolas (non-target, untapped) should be available
    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-by-tap',
    );
    expect(cancelActions).toHaveLength(1);
  });

  test('solo character company: no cancel-by-tap options (only pass)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const gameState = { ...state, phaseState: mhState };

    const assassinId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Defender passes cancel-window
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, 0);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Only pass is available (no other characters to tap)
    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-by-tap',
    );
    expect(cancelActions).toHaveLength(0);
    const passActions = defActions.filter(
      a => a.viable && a.action.type === 'pass',
    );
    expect(passActions).toHaveLength(1);
  });
});
