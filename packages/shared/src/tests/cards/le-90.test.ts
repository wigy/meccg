/**
 * @module le-90.test
 *
 * Card test: Slayer (le-90)
 * Type: hazard-creature
 * Effects: 3
 *
 * "Slayer. Two attacks (of one strike each) all against the same character.
 * Attacker chooses defending character. The defender may tap any one
 * character in the company to cancel one of these attacks. This may be
 * done even after a strike is assigned and after facing another attack.
 * If an attack from Slayer is given more than one strike, each additional
 * strike becomes an excess strike (-1 prowess modification) against the
 * attacked character."
 *
 * Shape: prowess 11, strikes 1, body —, keyed to {b}{B} (border region
 * or border-hold destination), race Slayer, 2 kill-MP, non-unique.
 *
 * Tests the three effects:
 * 1. combat-attacker-chooses-defenders — attacker assigns strikes
 * 2. combat-multi-attack (count: 2) — two strikes auto-assigned to one target
 * 3. combat-cancel-attack-by-tap (maxCancels: 1) — defender taps one character
 *    to cancel a single attack
 *
 * The excess-strike clause is engine-wide behavior (reducer-combat.ts handles
 * any additional strike on a single target as excess, -1 prowess each); it is
 * not Slayer-specific DSL.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MINAS_TIRITH, BREE,
  buildTestState, resetMint, makeMHState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const SLAYER = 'le-90' as CardDefinitionId;

describe('Slayer (le-90)', () => {
  beforeEach(() => resetMint());

  test('combat initiates with attacker assignment, 2 total strikes, and forceSingleTarget', () => {
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
          hand: [SLAYER],
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

    const slayerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: slayerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });

    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    // Multi-attack: 2 attacks × 1 strike = 2 total strikes
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(11);
    expect(afterChain.combat!.forceSingleTarget).toBe(true);
    expect(afterChain.combat!.cancelByTapRemaining).toBe(1);
  });

  test('attacker assigns one character and both strikes auto-assigned to that target', () => {
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
          hand: [SLAYER],
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

    const slayerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: slayerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Attacker gets assign-strike actions for both characters
    const attackerActions = computeLegalActions(afterPass, PLAYER_2);
    const assignStrikes = attackerActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(assignStrikes).toHaveLength(2);

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
    const assignResult = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Both strikes are now assigned to Aragorn
    const combat = assignResult.combat!;
    expect(combat.strikeAssignments).toHaveLength(2);
    expect(combat.strikeAssignments.every(sa => sa.characterId === aragornCharId)).toBe(true);

    expect(combat.assignmentPhase).toBe('cancel-by-tap');
  });

  test('defender can cancel one attack by tapping a non-target character', () => {
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
          hand: [SLAYER],
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

    const slayerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: slayerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 0);
    const legolasCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
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

    // Defender taps Legolas to cancel one attack
    const r3 = dispatch(r2, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasCharId,
    });
    // One strike canceled; one strike remains
    expect(r3.combat!.strikeAssignments).toHaveLength(1);
    expect(r3.combat!.strikesTotal).toBe(1);
    expect(r3.players[0].characters[legolasCharId as string].status).toBe('tapped');
    // maxCancels is 1, so the cancel allowance is exhausted (becomes undefined)
    // and combat advances past cancel-by-tap to resolve the remaining strike.
    expect(r3.combat!.cancelByTapRemaining).toBeUndefined();
    expect(r3.combat!.assignmentPhase).toBe('done');
    expect(r3.combat!.phase).toBe('resolve-strike');
  });

  test('cancel-by-tap respects maxCancels=1 (only one attack can be canceled)', () => {
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
          hand: [SLAYER],
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

    const slayerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: slayerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 0);
    const legolasCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Cancel one attack (exhausts the single cancel)
    const r3 = dispatch(r2, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasCharId,
    });

    // After the cancel, no further cancel-by-tap actions are offered
    const defActionsAfter = computeLegalActions(r3, PLAYER_1);
    const cancelActionsAfter = defActionsAfter.filter(
      a => a.viable && a.action.type === 'cancel-by-tap',
    );
    expect(cancelActionsAfter).toHaveLength(0);

    // With 1 strike remaining, combat auto-advances to resolve-strike
    expect(r3.combat!.strikeAssignments).toHaveLength(1);
    expect(r3.combat!.phase).toBe('resolve-strike');
  });

  test('defender can pass cancel-by-tap to proceed with both strikes', () => {
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
          hand: [SLAYER],
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

    const slayerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: slayerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
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
    // Both strikes remain; defender chooses resolution order
    expect(r3.combat!.strikeAssignments).toHaveLength(2);
    expect(r3.combat!.phase).toBe('choose-strike-order');
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
          hand: [SLAYER],
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

    const slayerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: slayerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const defenderAssignStrikes = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defenderAssignStrikes).toHaveLength(0);
  });

  test('solo character company: only pass is available in cancel-by-tap window', () => {
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
          hand: [SLAYER],
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

    const slayerId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: slayerId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

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
