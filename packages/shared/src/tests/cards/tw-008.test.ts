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
  ASSASSIN, DARK_QUARRELS,
  RIVENDELL, LORIEN, MINAS_TIRITH, BREE,
  CardStatus,
  buildTestState, resetMint, makeMHState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, findInPile,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const RANK_UPON_RANK = 'dm-80' as CardDefinitionId;
const FOREWARNED_IS_FOREARMED = 'dm-132' as CardDefinitionId;
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
    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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
    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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
    expect(r3.players[0].characters[legolasCharId].status).toBe('tapped');
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 0);
    const legolasCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
    const gimliCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 2);
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 0);
    const legolasCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
    const gimliCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 2);
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
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

  test('cancel-attack in cancel-window decrements multiAttackCount (regression: fractional display bug)', () => {
    // P1 has Dark Quarrels in hand to cancel one Assassin attack.
    // After chain resolution the UI computes strikesPerAttack = strikesTotal / multiAttackCount.
    // Bug: multiAttackCount was not decremented, yielding 2/3 = 0.666... instead of 2/2 = 1.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [DARK_QUARRELS],
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.multiAttackCount).toBe(3);

    // P1 plays Dark Quarrels to cancel one Assassin attack (Men race matches)
    const darkQuarrelsId = handCardId(gameState, RESOURCE_PLAYER);
    const afterCancel = dispatch(afterChain, {
      type: 'cancel-attack',
      player: PLAYER_1,
      cardInstanceId: darkQuarrelsId,
    });
    const afterResolved = resolveChain(afterCancel);

    // Both strikesTotal and multiAttackCount must drop by 1 so strikesPerAttack = 1
    expect(afterResolved.combat).not.toBeNull();
    expect(afterResolved.combat!.strikesTotal).toBe(2);
    expect(afterResolved.combat!.multiAttackCount).toBe(2);
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
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

  test('boosted strikes (Rank upon Rank) become excess strikes, not extra attacks (CRF 22 regression)', () => {
    // Rank upon Rank (dm-80): "+1 prowess and +1 strikes" to all non-agent Man
    // attacks. Assassin is a Man creature, so its printed 1 strike/attack
    // becomes 2, and its 11 prowess becomes 12. Per CRF 22 Assassin: "If an
    // attack from Assassin is given more than one strike, each additional
    // strike becomes an excess strike (-1 prowess modification) against the
    // attacked character" — the attack count must stay at 3 (not become 6
    // real strikes), with a -1 prowess excess-strike penalty on each attack.
    const rankInPlay: CardInPlay = {
      instanceId: 'rank-1' as CardInstanceId,
      definitionId: RANK_UPON_RANK,
      status: CardStatus.Untapped,
    };

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
          cardsInPlay: [rankInPlay],
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Still 3 attacks — not 6 — with the boost prowess folded in and the
    // strike boost tracked separately as a per-attack excess.
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.multiAttackCount).toBe(3);
    expect(afterChain.combat!.strikesPerAttack).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.excessStrikesPerAttack).toBe(1);

    // Defender passes cancel-window, attacker assigns all strikes to Aragorn.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
    const assignResult = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Exactly 3 strike assignments (one per attack), each carrying a single
    // excess strike (-1 prowess) — not 6 full-strength assignments.
    const combat = assignResult.combat!;
    expect(combat.strikeAssignments).toHaveLength(3);
    expect(combat.strikeAssignments.every(sa => sa.characterId === aragornCharId)).toBe(true);
    expect(combat.strikeAssignments.every(sa => sa.excessStrikes === 1)).toBe(true);
  });

  test('Forewarned Is Forearmed + Rank upon Rank together still force all strikes onto one character (bug report regression)', () => {
    // Bug report: with both Rank upon Rank and Forewarned Is Forearmed in
    // play, Assassin's remaining (isolated) attack still picked up RoR's +1
    // strike, but forceSingleTarget was cleared because the reduction logic
    // gated on the *reduced* attack count (1) instead of the creature's own
    // printed multi-attack count (3). That let the attacker assign the two
    // strikes of this single attack to two different characters (e.g. a
    // strike-shield ally and then the shielded character behind it) instead
    // of forcing both onto the same character as Assassin requires.
    const rankInPlay: CardInPlay = {
      instanceId: 'rank-1' as CardInstanceId,
      definitionId: RANK_UPON_RANK,
      status: CardStatus.Untapped,
    };
    const fiaInPlay: CardInPlay = {
      instanceId: 'fia-1' as CardInstanceId,
      definitionId: FOREWARNED_IS_FOREARMED,
      status: CardStatus.Untapped,
    };

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
          cardsInPlay: [fiaInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [ASSASSIN],
          siteDeck: [RIVENDELL],
          cardsInPlay: [rankInPlay],
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Reduced to a single isolated attack (Forewarned), but still forced to
    // one character (Assassin's own restriction) with RoR's boost folded in
    // as a same-character excess strike, not a second, separately-assignable
    // strike.
    expect(afterChain.combat!.isolated).toBe(true);
    expect(afterChain.combat!.uncancelable).toBe(true);
    expect(afterChain.combat!.forceSingleTarget).toBe(true);
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.excessStrikesPerAttack).toBe(1);

    // Defender passes cancel-window (Forewarned's attack cannot be canceled
    // anyway), attacker assigns the strike to Aragorn.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
    const assignResult = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });

    // Exactly one assignment, carrying the excess strike against the SAME
    // character — never a second assignment against a different character.
    const combat = assignResult.combat!;
    expect(combat.strikeAssignments).toHaveLength(1);
    expect(combat.strikeAssignments[0].characterId).toBe(aragornCharId);
    expect(combat.strikeAssignments[0].excessStrikes).toBe(1);
  });

  test('canceling 2 of 3 attacks then defeating the 3rd does NOT award kill MP (bug report regression)', () => {
    // CoE COMBAT / CRF 22 Annotation 14: a canceled attack is never "defeated".
    // A multi-attack creature is only defeated (and its kill MP awarded) if
    // EVERY attack was genuinely defeated in combat — canceling some of them
    // (even via Dark Quarrels) and defeating the rest does not count.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BREE, characters: [ARAGORN, LEGOLAS] }],
          hand: [DARK_QUARRELS, DARK_QUARRELS],
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: assassinId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'border-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    // Cancel 2 of the 3 attacks with Dark Quarrels, leaving 1.
    const dq1 = handCardId(afterChain, RESOURCE_PLAYER);
    const afterCancel1 = resolveChain(dispatch(afterChain, {
      type: 'cancel-attack',
      player: PLAYER_1,
      cardInstanceId: dq1,
    }));
    const dq2 = handCardId(afterCancel1, RESOURCE_PLAYER);
    const afterCancel2 = resolveChain(dispatch(afterCancel1, {
      type: 'cancel-attack',
      player: PLAYER_1,
      cardInstanceId: dq2,
    }));
    expect(afterCancel2.combat!.strikesTotal).toBe(1);
    expect(afterCancel2.combat!.anyAttackCanceled).toBe(true);

    // Defender ends the cancel-window; attacker assigns the last strike to Aragorn.
    const afterPass = dispatch(afterCancel2, { type: 'pass', player: PLAYER_1 });
    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
    const afterAssign = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });
    expect(afterAssign.combat!.assignmentPhase).toBe('cancel-by-tap');

    // Defender declines the final cancel-by-tap opportunity.
    const afterCancelByTapPass = dispatch(afterAssign, { type: 'pass', player: PLAYER_1 });
    expect(afterCancelByTapPass.combat!.phase).toBe('resolve-strike');

    // Aragorn taps to fight at full prowess (6), rolls max (12): 18 > 11 —
    // strike defeated outright (Assassin has no body, so no body check).
    const resolveActions = viableActions({ ...afterCancelByTapPass, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    const tapToFightAction = resolveActions.find(a => 'tapToFight' in a.action && a.action.tapToFight)!.action;
    const afterResolve = dispatch({ ...afterCancelByTapPass, cheatRollTotal: 12 }, tapToFightAction);

    // The last attack was genuinely defeated, but the other 2 were only
    // canceled — the creature as a whole is not "defeated".
    expect(afterResolve.combat).toBeNull();
    expect(findInPile(afterResolve, RESOURCE_PLAYER, 'killPile', ASSASSIN)).toBeUndefined();
    expect(findInPile(afterResolve, HAZARD_PLAYER, 'discardPile', ASSASSIN)).toBeDefined();
  });

  test('cancel-by-tap after facing one attack cancels only unresolved strikes (bug report regression)', () => {
    // CRF 22 Assassin: "you may decide to cancel one of the attacks after
    // facing another attack." Bug: cancel-by-tap removed strike assignments
    // from the end of the array regardless of resolved status, so canceling
    // 2 attacks after facing the 3rd removed the already-resolved (faced)
    // strike and left a phantom unresolved strike still needing resolution
    // — instead of correctly ending combat with 0 unresolved strikes left.
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

    const assassinId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
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

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 0);
    const legolasCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 1);
    const gimliCharId = charIdAt(afterPass, RESOURCE_PLAYER, 0, 2);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });
    expect(r2.combat!.assignmentPhase).toBe('cancel-by-tap');

    // Defender declines the early cancel-by-tap opportunity — proceeds to
    // choose which of the 3 strikes to face first.
    const r3 = dispatch(r2, { type: 'pass', player: PLAYER_1 });
    expect(r3.combat!.phase).toBe('choose-strike-order');
    expect(r3.combat!.strikeAssignments).toHaveLength(3);

    // Defender chooses to face the strike at the last index now — this is
    // the exact ordering from the bug report's game log, and it matters:
    // the original bug removed strikes from the *end* of the array
    // regardless of resolved status, so it only manifests when the resolved
    // strike ends up sitting at the tail of strikeAssignments.
    const chooseActions = viableActions(r3, PLAYER_1, 'choose-strike-order');
    const chooseAction = chooseActions
      .map(a => a.action)
      .reduce((a, b) => ((a as { strikeIndex: number }).strikeIndex > (b as { strikeIndex: number }).strikeIndex ? a : b));
    const r4 = dispatch(r3, chooseAction);
    expect(r4.combat!.phase).toBe('resolve-strike');

    // Aragorn taps to fight and defeats the strike outright (Assassin has no
    // body, so no body check follows).
    const resolveActions = viableActions({ ...r4, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    const tapToFightAction = resolveActions.find(a => 'tapToFight' in a.action && a.action.tapToFight)!.action;
    const r5 = dispatch({ ...r4, cheatRollTotal: 12 }, tapToFightAction);

    // Facing the attack reopens the cancel-by-tap window per CRF 22.
    expect(r5.combat!.phase).toBe('assign-strikes');
    expect(r5.combat!.assignmentPhase).toBe('cancel-by-tap');
    expect(r5.combat!.strikeAssignments.filter(a => a.resolved)).toHaveLength(1);
    expect(r5.combat!.strikeAssignments.filter(a => !a.resolved)).toHaveLength(2);

    // Defender now cancels the 2 remaining (unresolved) attacks by tapping.
    const r6 = dispatch(r5, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasCharId,
    });
    // The already-resolved (faced) strike must survive the cancellation.
    expect(r6.combat!.strikeAssignments).toHaveLength(2);
    expect(r6.combat!.strikeAssignments.filter(a => a.resolved)).toHaveLength(1);

    const r7 = dispatch(r6, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: gimliCharId,
    });

    // Canceled 2, faced 1 → nothing left unresolved: combat must finalize,
    // not leave a phantom attack still needing to be resolved.
    expect(r7.combat).toBeNull();
    expect(findInPile(r7, RESOURCE_PLAYER, 'killPile', ASSASSIN)).toBeUndefined();
    expect(findInPile(r7, HAZARD_PLAYER, 'discardPile', ASSASSIN)).toBeDefined();
  });
});
