/**
 * @module tw-072.test
 *
 * Card test: Orc-guard (tw-072)
 * Type: hazard-creature
 * Effects: 0
 *
 * "Orcs. Five strikes."
 *
 * Orc-guard is a vanilla hazard creature with no special effects.
 * The card text describes its race (orc) and strike count (5), both
 * captured in base stats. This test verifies the card definition and
 * that it can be played as a hazard creature during movement/hazard.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_GUARD,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  pool, resolveChain,
  handCardId, companyIdAt, dispatch,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType } from '../../index.js';
import type { CreatureCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Orc-guard (tw-072)', () => {
  beforeEach(() => resetMint());

  test('card definition has correct base stats and no effects', () => {
    const def = pool[ORC_GUARD as string] as CreatureCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hazard-creature');
    expect(def.id).toBe('tw-072');
    expect(def.name).toBe('Orc-guard');
    expect(def.strikes).toBe(5);
    expect(def.prowess).toBe(8);
    expect(def.body).toBeNull();
    expect(def.unique).toBe(false);
    expect(def.race).toBe('orc');
    expect(def.killMarshallingPoints).toBe(1);
    expect(def.effects).toBeUndefined();
  });

  test('keyed to shadow and dark regions with shadow-hold and dark-hold sites', () => {
    const def = pool[ORC_GUARD as string] as CreatureCard;
    expect(def.keyedTo).toBeDefined();
    expect(def.keyedTo).toHaveLength(1);
    const keying = def.keyedTo[0];
    expect(keying.regionTypes).toEqual(['shadow', 'dark']);
    expect(keying.siteTypes).toEqual(['shadow-hold', 'dark-hold']);
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
          hand: [ORC_GUARD],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'shadow' },
    });
  });

  test('initiates combat with 5 strikes and 8 prowess (defender assigns)', () => {
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
          hand: [ORC_GUARD],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'shadow' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.assignmentPhase).toBe('defender');
    expect(afterChain.combat!.strikesTotal).toBe(5);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('defender gets assign-strike actions against Orc-guard', () => {
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
          hand: [ORC_GUARD],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const orcId = handCardId(gameState, 1);
    const companyId = companyIdAt(gameState, 0);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: orcId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type' as const, value: 'shadow' },
    });
    const afterChain = resolveChain(afterPlay);

    const defenderActions = computeLegalActions(afterChain, PLAYER_1);
    const defenderAssignStrikes = defenderActions.filter(
      a => a.viable && a.action.type === 'assign-strike',
    );
    expect(defenderAssignStrikes.length).toBeGreaterThan(0);
  });
});
