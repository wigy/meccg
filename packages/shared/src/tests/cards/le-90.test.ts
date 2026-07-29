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
  DARK_QUARRELS, GATES_OF_MORNING,
  buildTestState, resetMint, makeMHState,
  resolveChain,
  handCardId, companyIdAt, charIdAt, dispatch, viableActions, expectInDiscardPile, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId } from '../../index.js';

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

    // Defender (P1) gets cancel-by-tap actions for all untapped characters including target
    // Slayer: "any one character" — Aragorn (target), Legolas, and Gimli can all tap
    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-by-tap',
    );
    expect(cancelActions).toHaveLength(3);

    // Defender taps Legolas to cancel one attack
    const r3 = dispatch(r2, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: legolasCharId,
    });
    // One strike canceled; one strike remains
    expect(r3.combat!.strikeAssignments).toHaveLength(1);
    expect(r3.combat!.strikesTotal).toBe(1);
    expect(r3.players[0].characters[legolasCharId].status).toBe('tapped');
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

  test('solo character company: target character can tap to cancel (allowTargetToCancel)', () => {
    // Regression test for bug: Slayer says "any one character" (including the target),
    // unlike Assassin which says "not the defending character". When the company has
    // only one character, that character is both the target and the only one who can tap.
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
    expect(afterChain.combat!.cancelByTapAllowTarget).toBe(true);

    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const aragornCharId = charIdAt(afterPass, RESOURCE_PLAYER);
    const r2 = dispatch(afterPass, {
      type: 'assign-strike',
      player: PLAYER_2,
      characterId: aragornCharId,
      tapped: false,
    });
    expect(r2.combat!.assignmentPhase).toBe('cancel-by-tap');

    // Aragorn is the target but Slayer allows "any one character" — cancel action offered
    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-by-tap',
    );
    expect(cancelActions).toHaveLength(1);
    expect((cancelActions[0].action as { characterId: string }).characterId).toBe(aragornCharId);

    // Aragorn taps to cancel one attack; one strike remains
    const r3 = dispatch(r2, {
      type: 'cancel-by-tap',
      player: PLAYER_1,
      characterId: aragornCharId,
    });
    expect(r3.combat!.strikeAssignments).toHaveLength(1);
    expect(r3.combat!.strikesTotal).toBe(1);
    expect(r3.players[0].characters[aragornCharId].status).toBe('tapped');
    expect(r3.combat!.phase).toBe('resolve-strike');
  });

  test('a generic halve-strikes effect (Dark Quarrels) does not remove a whole attack', () => {
    // Regression test: Slayer's two attacks (of one strike each) are resolved
    // as two separate attacks in succession (CoE 2.IV.vii.2.1); a "reduce
    // strikes" effect only affects the *current* attack (CoE 3.i), so halving
    // the current 1-strike attack (ceil(1/2) = 1) leaves it unchanged, and the
    // second, not-yet-resolved attack contributes its strike untouched. Total
    // strikes must remain 2, not collapse to 1 (which would silently cancel an
    // entire attack the halving effect was never meant to reach).
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
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
          hand: [DARK_QUARRELS],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [gomInPlay],
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
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.multiAttackCount).toBe(2);
    expect(afterChain.combat!.strikesPerAttack).toBe(1);

    const halveActions = viableActions(afterChain, PLAYER_1, 'halve-strikes');
    expect(halveActions.length).toBe(1);

    const afterHalve = dispatch(afterChain, halveActions[0].action);

    // Still 2 total strikes: the current attack's single strike can't be
    // halved below 1, and the second attack is entirely untouched.
    expect(afterHalve.combat!.strikesTotal).toBe(2);
    expectInDiscardPile(afterHalve, RESOURCE_PLAYER, DARK_QUARRELS);
  });
});
