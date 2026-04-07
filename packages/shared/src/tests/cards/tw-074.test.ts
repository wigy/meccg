/**
 * @module tw-074.test
 *
 * Card test: Orc-patrol (tw-074)
 * Type: hazard-creature
 * Effects: 0
 *
 * "Orcs. Three strikes."
 *
 * Orc-patrol is a vanilla hazard creature with no special effects.
 * The card text describes its race (orc) and strike count (3), both
 * captured in base stats. This test verifies the card definition and
 * that it can be played as a hazard creature during movement/hazard.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_PATROL,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  reduce, pool, resolveChain,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType } from '../../index.js';
import type { CreatureCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Orc-patrol (tw-074)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct base stats and no effects', () => {
    const def = pool[ORC_PATROL as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.id).toBe('tw-074');
    expect(def.name).toBe('Orc-patrol');
    expect(def.strikes).toBe(3);
    expect(def.prowess).toBe(6);
    expect(def.body).toBeNull();
    expect(def.unique).toBe(false);
    expect(def.race).toBe('orc');
    expect(def.killMarshallingPoints).toBe(1);
    expect(def.effects).toBeUndefined();
  });

  test('keyed to wilderness, shadow, dark regions and matching site types', () => {
    const def = pool[ORC_PATROL as string] as CreatureCard;
    expect(def.keyedTo).toBeDefined();
    expect(def.keyedTo).toHaveLength(1);
    const keying = def.keyedTo[0];
    expect(keying.regionTypes).toContain('wilderness');
    expect(keying.regionTypes).toContain('shadow');
    expect(keying.regionTypes).toContain('dark');
    expect(keying.siteTypes).toContain('ruins-and-lairs');
    expect(keying.siteTypes).toContain('shadow-hold');
    expect(keying.siteTypes).toContain('dark-hold');
  });

  test('can be played as hazard creature during movement/hazard phase', () => {
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
  });

  test('initiates combat with defender assignment (no attacker-chooses-defenders)', () => {
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
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(6);
  });

  test('defender gets assign-strike actions against Orc-patrol', () => {
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

    // Defender (P1) should have assign-strike actions
    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const defenderAssignStrikes = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defenderAssignStrikes.length).toBeGreaterThan(0);
  });
});
