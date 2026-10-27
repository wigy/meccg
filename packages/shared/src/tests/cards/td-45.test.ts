/**
 * @module td-45.test
 *
 * Card test: Light-drake (td-45)
 * Type: hazard-creature (Drake)
 *
 * Text: "Drake. Two strikes."
 *
 * Base stats: strikes 2, prowess 8, body — (no body check), kill MP 1,
 * race Drake.
 *
 * Canonical cost (`attributes.playable`): {w}{R} — a wilderness region in
 * the site path, or arriving at a Ruins-and-Lairs site. Encoded as a single
 * `keyedTo` entry whose fields are alternatives (OR'd):
 * `regionTypes: [wilderness]` OR `siteTypes: [ruins-and-lairs]`.
 *
 * All keying is handled structurally by the engine (mh-hazard-play.ts
 * region-type / site-type keying). "Drake" and "Two strikes" are carried by
 * the base `race` and `strikes` fields; the card has no special abilities.
 *
 * Effects: none.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const LIGHT_DRAKE = 'td-45' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const RUINS_KEYING = { method: 'site-type' as const, value: SiteType.RuinsAndLairs };

describe('Light-drake (td-45)', () => {
  let state: GameState;

  beforeEach(() => {
    resetMint();
    state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [LIGHT_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
  });

  // ─── Base stats: two strikes at prowess 8, race drake, body — ─────────────

  test('attack uses 2 strikes at prowess 8, race drake, no body', () => {
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, WILDERNESS_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.creatureRace).toBe('drake');
    expect(after.combat!.creatureBody).toBeNull();
    // Two strikes against a two-character company: defender assigns.
    expect(after.combat!.phase).toBe('assign-strikes');
    expect(viableActions(after, PLAYER_1, 'assign-strike').length).toBeGreaterThan(0);
  });

  // ─── Keying: {w}{R} ───────────────────────────────────────────────────────

  test('keyable by a single wilderness region in the site path', () => {
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      }),
    };

    const ks = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy);
    expect(ks).toContainEqual(WILDERNESS_KEYING);
  });

  test('keyable by a Ruins-and-Lairs destination without wilderness in path', () => {
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Andrast'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const ks = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(p => (p.action as { keyedBy?: { method: string; value: string } }).keyedBy);
    expect(ks).toContainEqual(RUINS_KEYING);
    expect(ks.some(k => k?.method === 'region-type')).toBe(false);
  });

  test('NOT keyable on a pure-shadow path arriving at a Shadow-hold', () => {
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow],
        resolvedSitePathNames: ['Imlad Morgul'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Minas Morgul',
      }),
    };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT keyable on a free-domain path to a Free-hold', () => {
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Anórien'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
      }),
    };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
