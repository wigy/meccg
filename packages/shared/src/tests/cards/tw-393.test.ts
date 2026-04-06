/**
 * @module tw-393.test
 *
 * Card test: Edhellond (tw-393)
 * Type: hero-site (haven)
 * Effects: 0
 *
 * "Site Path From Grey Havens: Free-domain/Coastland/Coastland/Coastland/Coastland/Wilderness.
 *  Site Path From Lórien: Wilderness/Border-land/Free-domain/Free-domain/Border-land/Wilderness."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                                |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                                      |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                                      |
 * | 4 | havenPaths        | OK     | Grey Havens (6 regions), Lórien (6 regions) — both exist       |
 * | 5 | path symmetry     | OK     | Reverse paths match in Grey Havens and Lórien data             |
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
  LORIEN,
  resetMint, pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  EDHELLOND, GREY_HAVENS,
  DOL_AMROTH, PELARGIR,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Edhellond (tw-393)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a haven with correct structural properties', () => {
    const def = pool[EDHELLOND as string];
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

  test('haven paths to Grey Havens match card text', () => {
    const def = pool[EDHELLOND as string];
    if (!isSiteCard(def)) return;

    // Card text: "Site Path From Grey Havens: Free-domain/Coastland/Coastland/Coastland/Coastland/Wilderness"
    expect(def.havenPaths).toBeDefined();
    expect(def.havenPaths!['Grey Havens']).toEqual(['free', 'coastal', 'coastal', 'coastal', 'coastal', 'wilderness']);
  });

  test('haven paths to Lórien match card text', () => {
    const def = pool[EDHELLOND as string];
    if (!isSiteCard(def)) return;

    // Card text: "Site Path From Lórien: Wilderness/Border-land/Free-domain/Free-domain/Border-land/Wilderness"
    expect(def.havenPaths).toBeDefined();
    expect(def.havenPaths!['Lórien']).toEqual(['wilderness', 'border', 'free', 'free', 'border', 'wilderness']);
  });

  test('haven paths are symmetric with destination havens', () => {
    const edhellondDef = pool[EDHELLOND as string];
    const lorienDef = pool[LORIEN as string];
    const ghDef = pool[GREY_HAVENS as string];
    if (!isSiteCard(edhellondDef) || !isSiteCard(lorienDef) || !isSiteCard(ghDef)) return;

    // Edhellond→Grey Havens path reversed should equal Grey Havens→Edhellond path
    const edhToGH = edhellondDef.havenPaths!['Grey Havens'];
    const ghToEdh = ghDef.havenPaths!['Edhellond'];
    expect(ghToEdh).toEqual([...edhToGH].reverse());

    // Edhellond→Lórien path reversed should equal Lórien→Edhellond path
    const edhToLor = edhellondDef.havenPaths!['Lórien'];
    const lorToEdh = lorienDef.havenPaths!['Edhellond'];
    expect(lorToEdh).toEqual([...edhToLor].reverse());
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Edhellond (haven)', () => {
    const state = buildSitePhaseState({ site: EDHELLOND });
    const actions = computeLegalActions(state, PLAYER_1);

    // Only action should be pass (no items/allies/factions playable at a haven)
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('no automatic attacks at Edhellond', () => {
    const def = pool[EDHELLOND as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  test('does not connect to Rivendell directly', () => {
    const def = pool[EDHELLOND as string];
    if (!isSiteCard(def)) return;

    // Edhellond only has paths to Grey Havens and Lórien, not Rivendell
    expect(def.havenPaths!['Rivendell']).toBeUndefined();
  });

  // ─── Movement from Edhellond ──────────────────────────────────────────────

  test('starter movement reaches Grey Havens and Lórien (haven-to-haven)', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name)
      .sort();

    expect(starterHavens).toEqual(['Grey Havens', 'Lórien']);
  });

  test('starter movement reaches all sites with nearestHaven Edhellond', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterSites = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType !== 'haven')
      .map(r => r.site.name)
      .sort();

    // All hero sites with nearestHaven "Edhellond"
    const expectedSites = allSites
      .filter(s => s.siteType !== 'haven' && s.nearestHaven === 'Edhellond')
      .map(s => s.name)
      .sort();

    expect(starterSites).toEqual(expectedSites);

    // Verify known sites are included
    expect(starterSites).toContain(pool[DOL_AMROTH as string].name);
    expect(starterSites).toContain(pool[PELARGIR as string].name);
  });

  test('starter movement does not reach Rivendell', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Rivendell');
  });

  test('region movement reaches sites within 4 regions of Anfalas', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const regionNames = [...new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    )].sort();

    // Edhellond is in Anfalas. Region movement (max 4 regions) should
    // reach sites in adjacent and nearby regions.
    // Verify some key sites are reachable
    expect(regionNames).toContain('Dol Amroth');    // Belfalas (adjacent)
    expect(regionNames).toContain('Lond Galen');    // Anfalas (same region)
    expect(regionNames).toContain('Tolfalas');       // Mouths of the Anduin (via Belfalas)
    expect(regionNames).toContain('Pelargir');       // Lebennin (via Belfalas)
  });

  test('region movement distances are correct for nearby sites', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);

    // Build a map of site name -> minimum region distance
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // Same region (Anfalas)
    expect(distMap.get('Lond Galen')).toBe(1);
    // Adjacent regions
    expect(distMap.get('Dol Amroth')).toBe(2);       // Belfalas
    // Farther sites
    expect(distMap.get('Pelargir')).toBe(3);          // Lebennin (Anfalas→Belfalas→Lebennin)
    expect(distMap.get('Tolfalas')).toBe(3);           // Mouths of the Anduin (Anfalas→Belfalas→Mouths)
  });
});
