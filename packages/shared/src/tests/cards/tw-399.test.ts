/**
 * @module tw-399.test
 *
 * Card test: Grey Havens (tw-399)
 * Type: hero-site (haven)
 * Effects: 0
 *
 * "Site Path From Rivendell: Wilderness/Wilderness/Free-domain.
 *  Site Path From Edhellond: Wilderness/Coastland/Coastland/Coastland/Coastland/Free-domain."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                                |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                                      |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                                      |
 * | 4 | havenPaths        | OK     | Rivendell (3 regions), Edhellond (6 regions) — both exist      |
 * | 5 | path symmetry     | OK     | Reverse paths match in Rivendell and Edhellond data            |
 * | 6 | playableResources | OK     | Empty (correct for haven)                                      |
 * | 7 | automaticAttacks  | OK     | Empty (correct for haven)                                      |
 * | 8 | resourceDraws     | OK     | 2                                                              |
 * | 9 | hazardDraws       | OK     | 2                                                              |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 3 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-04-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RIVENDELL,
  resetMint, pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  EDHELLOND, GREY_HAVENS, BLUE_MOUNTAIN_DWARF_HOLD,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Grey Havens (tw-399)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a haven with correct structural properties', () => {
    const def = pool[GREY_HAVENS as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('haven');
    expect(def.sitePath).toEqual([]);
    expect(def.nearestHaven).toBe('');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('haven paths to Rivendell match card text', () => {
    const def = pool[GREY_HAVENS as string];
    if (!isSiteCard(def)) return;

    // Card text: "Site Path From Rivendell: Wilderness/Wilderness/Free-domain"
    expect(def.havenPaths).toBeDefined();
    expect(def.havenPaths!['Rivendell']).toEqual(['wilderness', 'wilderness', 'free']);
  });

  test('haven paths to Edhellond match card text', () => {
    const def = pool[GREY_HAVENS as string];
    if (!isSiteCard(def)) return;

    // Card text: "Site Path From Edhellond: Wilderness/Coastland/Coastland/Coastland/Coastland/Free-domain"
    expect(def.havenPaths).toBeDefined();
    expect(def.havenPaths!['Edhellond']).toEqual(['wilderness', 'coastal', 'coastal', 'coastal', 'coastal', 'free']);
  });

  test('haven paths are symmetric with destination havens', () => {
    const ghDef = pool[GREY_HAVENS as string];
    const rivendellDef = pool[RIVENDELL as string];
    const edhellondDef = pool[EDHELLOND as string];
    if (!isSiteCard(ghDef) || !isSiteCard(rivendellDef) || !isSiteCard(edhellondDef)) return;

    // Grey Havens→Rivendell reversed should equal Rivendell→Grey Havens
    const ghToRiv = ghDef.havenPaths!['Rivendell'];
    const rivToGH = rivendellDef.havenPaths!['Grey Havens'];
    expect(rivToGH).toEqual([...ghToRiv].reverse());

    // Grey Havens→Edhellond reversed should equal Edhellond→Grey Havens
    const ghToEdh = ghDef.havenPaths!['Edhellond'];
    const edhToGH = edhellondDef.havenPaths!['Grey Havens'];
    expect(edhToGH).toEqual([...ghToEdh].reverse());
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Grey Havens (haven)', () => {
    const state = buildSitePhaseState({ site: GREY_HAVENS });
    const actions = computeLegalActions(state, PLAYER_1);

    // Only action should be pass (no items/allies/factions playable at a haven)
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('no automatic attacks at Grey Havens', () => {
    const def = pool[GREY_HAVENS as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  test('does not connect to Lórien directly', () => {
    const def = pool[GREY_HAVENS as string];
    if (!isSiteCard(def)) return;

    // Grey Havens only has paths to Rivendell and Edhellond, not Lórien
    expect(def.havenPaths!['Lórien']).toBeUndefined();
  });

  // ─── Movement from Grey Havens ──────────────────────────────────────────────

  test('starter movement reaches Rivendell and Edhellond (haven-to-haven)', () => {
    const greyHavens = pool[GREY_HAVENS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name)
      .sort();

    expect(starterHavens).toEqual(['Edhellond', 'Rivendell']);
  });

  test('starter movement reaches all sites with nearestHaven Grey Havens', () => {
    const greyHavens = pool[GREY_HAVENS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterSites = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType !== 'haven')
      .map(r => r.site.name)
      .sort();

    // All hero sites with nearestHaven "Grey Havens"
    const expectedSites = allSites
      .filter(s => s.siteType !== 'haven' && s.nearestHaven === 'Grey Havens')
      .map(s => s.name)
      .sort();

    expect(starterSites).toEqual(expectedSites);

    // Verify known site is included
    expect(starterSites).toContain(pool[BLUE_MOUNTAIN_DWARF_HOLD as string].name);
  });

  test('starter movement does not reach Lórien', () => {
    const greyHavens = pool[GREY_HAVENS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Lórien');
  });

  test('region movement reaches sites within 4 regions of Lindon', () => {
    const greyHavens = pool[GREY_HAVENS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const regionNames = [...new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    )].sort();

    // Grey Havens is in Lindon. Region movement (max 4 regions) should
    // reach sites in adjacent and nearby regions.
    // Blue Mountain Dwarf-hold is in Númeriador (adjacent to Lindon)
    expect(regionNames).toContain('Blue Mountain Dwarf-hold');
  });

  test('region movement distances are correct for nearby sites', () => {
    const greyHavens = pool[GREY_HAVENS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);

    // Build a map of site name -> minimum region distance
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // Blue Mountain Dwarf-hold is in Númeriador (Lindon→Númeriador = 2 regions)
    expect(distMap.get('Blue Mountain Dwarf-hold')).toBe(2);
  });
});
