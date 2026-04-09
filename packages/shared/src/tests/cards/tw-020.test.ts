/**
 * @module tw-020.test
 *
 * Card test: Cave-drake (tw-020)
 * Type: hazard-creature
 * Effects: 1
 *
 * "Dragon. Two strikes. Attacker chooses defending characters."
 *
 * This tests the single effect:
 * 1. combat-rule: attacker-chooses-defenders — during strike assignment,
 *    the attacker (hazard player) assigns strikes instead of the defender.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  CAVE_DRAKE, ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  reduce, pool, resolveChain,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType } from '../../index.js';
import type { CreatureCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Cave-drake (tw-020)', () => {
  beforeEach(() => resetMint());

  test('card definition has attacker-chooses-defenders combat rule', () => {
    const def = pool[CAVE_DRAKE as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.strikes).toBe(2);
    expect(def.prowess).toBe(10);
    expect(def.race).toBe('dragon');
    expect(def.effects).toBeDefined();
    expect(def.effects).toContainEqual({
      type: 'combat-rule',
      rule: 'attacker-chooses-defenders',
    });
  });

  test('combat starts with attacker assignment phase (not defender)', () => {
    // Set up a M/H state: P1 active with 2 characters at Moria,
    // P2 (hazard player) has Cave-drake in hand.
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
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Set M/H phase to play-hazards with a wilderness site path (Cave-drake keys to wilderness)
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    // P2 plays Cave-drake targeting P1's company
    const cavedrakeId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cavedrakeId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    expect(result.error).toBeUndefined();

    // Resolve the chain → combat initiates
    const afterChain = resolveChain(result.state);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // Key assertion: cancel-window before attacker assigns (attacker-chooses-defenders)
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(10);
  });

  test('attacker (hazard player) gets assign-strike actions, defender does not', () => {
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
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const cavedrakeId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cavedrakeId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    expect(result.error).toBeUndefined();
    const afterChain = resolveChain(result.state);

    // During cancel-window, defender gets pass only (no cancel cards in hand)
    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    expect(defenderActions.filter(a => a.viable && a.action.type === 'assign-strike')).toHaveLength(0);
    expect(defenderActions.filter(a => a.viable && a.action.type === 'pass')).toHaveLength(1);

    // Attacker has no actions during cancel-window
    const attackerActions = computeLegalActions(afterChain, PLAYER_2);
    expect(attackerActions.filter(a => a.viable)).toHaveLength(0);

    // After defender passes cancel-window, attacker gets assign-strike actions
    const passResult = reduce(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(passResult.error).toBeUndefined();
    expect(passResult.state.combat!.assignmentPhase).toBe('attacker');
    const attackerActions2 = computeLegalActions(passResult.state, PLAYER_2);
    expect(attackerActions2.filter(a => a.viable && a.action.type === 'assign-strike')).toHaveLength(2);
  });

  test('normal creature (Orc-patrol) uses defender assignment phase', () => {
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
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
    const result = reduce(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'wilderness' },
    });
    expect(result.error).toBeUndefined();
    const afterChain = resolveChain(result.state);

    expect(afterChain.combat).not.toBeNull();
    // Normal creature: defender assigns strikes
    expect(afterChain.combat!.assignmentPhase).toBe('defender');

    // Defender (P1) should have assign-strike actions
    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const defenderAssignStrikes = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defenderAssignStrikes.length).toBeGreaterThan(0);
  });
});
