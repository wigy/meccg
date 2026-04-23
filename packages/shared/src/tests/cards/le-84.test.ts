/**
 * @module le-84.test
 *
 * Card test: Marsh-drake (le-84)
 * Type: hazard-creature (drake)
 *
 * Text:
 *   "Drake. Two strikes."
 *
 * Base stats: strikes 2, prowess 11, body —, kill MP 1.
 *
 * keyedTo:
 * | # | Entry                              | When   | Notes            |
 * |---|------------------------------------|--------|------------------|
 * | 1 | regionTypes: [shadow, coastal]     | always | base cost {c}{s} |
 *
 * Distinct region types inside a single `keyedTo` entry are alternatives
 * (OR'd): Marsh-drake keys when the resolved site path contains at least
 * one shadow-land OR at least one coastal-sea. No `effects` — all rules
 * ("Drake" race, two strikes) are carried by base card fields handled
 * structurally by the engine.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const MARSH_DRAKE = 'le-84' as CardDefinitionId;

const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const COASTAL_KEYING = { method: 'region-type' as const, value: RegionType.Coastal };

function makeCoastalMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Coastal],
    resolvedSitePathNames: ['Andrast Coast'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
  });
}

function baseStateWithHazardInHand() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [MARSH_DRAKE],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Marsh-drake (le-84)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: two strikes at prowess 11 on a shadow path ─────────────

  test('attack uses 2 strikes at prowess 11 via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, SHADOW_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(11);
    expect(after.combat!.creatureRace).toBe('drake');
    expect(after.combat!.creatureBody).toBeNull();
  });

  // ─── Base stats also apply on a coastal path ────────────────────────────

  test('attack uses 2 strikes at prowess 11 via coastal keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeCoastalMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, COASTAL_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(11);
  });

  // ─── Keying: playable on a pure-shadow path ─────────────────────────────

  test('playable on a pure-shadow path via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  // ─── Keying: playable on a pure-coastal path ────────────────────────────

  test('playable on a pure-coastal path via coastal keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeCoastalMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Coastal;
    })).toBe(true);
  });

  // ─── Keying: distinct types in one entry are OR'd ───────────────────────

  test('playable on a shadow+coastal path via either keying option', () => {
    const state = baseStateWithHazardInHand();
    const mixedMH = makeMHState({
      resolvedSitePath: [RegionType.Shadow, RegionType.Coastal],
      resolvedSitePathNames: ['Imlad Morgul', 'Andrast Coast'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: mixedMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const offered = new Set(plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.value;
    }));
    expect(offered.has(RegionType.Shadow)).toBe(true);
    expect(offered.has(RegionType.Coastal)).toBe(true);
  });

  // ─── Keying: NOT playable on paths that lack both region types ──────────

  test('NOT playable on a pure-wilderness path', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('NOT playable on a pure-dark-domain path', () => {
    const state = baseStateWithHazardInHand();
    const darkMH = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: darkMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable on a pure-free-domain path', () => {
    const state = baseStateWithHazardInHand();
    const freeMH = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Anorien'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready: GameState = { ...state, phaseState: freeMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
