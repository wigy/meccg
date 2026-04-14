/**
 * @module tw-408.test
 *
 * Card test: Lórien (tw-408)
 * Type: hero-site (haven)
 * Effects: 0
 *
 * "Site Path From Rivendell: Wilderness/Wilderness/Border-land/Wilderness.
 *  Site Path From Edhellond: Wilderness/Border-land/Free-domain/Free-domain/Border-land/Wilderness."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                            |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                                  |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                                  |
 * | 4 | havenPaths        | OK     | Rivendell (4 regions), Edhellond (6 regions) — both exist  |
 * | 5 | path symmetry     | OK     | Reverse paths match in Rivendell and Edhellond data        |
 * | 6 | playableResources | OK     | Empty (correct for haven)                                  |
 * | 7 | automaticAttacks  | OK     | Empty (correct for haven)                                  |
 * | 8 | resourceDraws     | OK     | 2                                                          |
 * | 9 | hazardDraws       | OK     | 2                                                          |
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
 * Certified: 2026-04-01
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
  MORIA, MINAS_TIRITH, MOUNT_DOOM, EAGLES_EYRIE, HENNETH_ANNUN,
  THRANDUILS_HALLS,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Lórien (tw-408)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Lórien (haven)', () => {
    const state = buildSitePhaseState({ site: LORIEN });
    const actions = computeLegalActions(state, PLAYER_1);

    // Only action should be pass (no items/allies/factions playable at a haven)
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });


  // ─── Movement from Lórien ──────────────────────────────────────────────────

  test('starter movement reaches Rivendell and Edhellond (haven-to-haven)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name)
      .sort();

    expect(starterHavens).toEqual(['Edhellond', 'Rivendell']);
  });

  test('starter movement reaches all sites with nearestHaven Lórien', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterSites = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType !== 'haven')
      .map(r => r.site.name)
      .sort();

    // All hero sites with nearestHaven "Lórien"
    const expectedSites = allSites
      .filter(s => s.siteType !== 'haven' && s.nearestHaven === 'Lórien')
      .map(s => s.name)
      .sort();

    expect(starterSites).toEqual(expectedSites);

    // Verify known sites are included
    expect(starterSites).toContain(pool[MORIA as string].name);
    expect(starterSites).toContain(pool[MINAS_TIRITH as string].name);
    expect(starterSites).toContain(pool[EAGLES_EYRIE as string].name);
    expect(starterSites).toContain(pool[HENNETH_ANNUN as string].name);
    expect(starterSites).toContain(pool[THRANDUILS_HALLS as string].name);
    expect(starterSites).toContain(pool[MOUNT_DOOM as string].name);
  });

  test('starter movement does not reach Grey Havens', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Grey Havens');
  });

  test('region movement reaches sites within 4 regions of Wold & Foothills', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionNames = [...new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    )].sort();

    // Lórien is in Wold & Foothills. Region movement (max 4 regions) should
    // reach sites in adjacent and nearby regions.
    // Verify some key sites are reachable
    expect(regionNames).toContain('Moria');          // Redhorn Gate (adjacent)
    expect(regionNames).toContain("Eagles' Eyrie");  // Anduin Vales (adjacent)
    expect(regionNames).toContain('Rivendell');       // Rhudaur (via regions)
  });

  test('region movement distances are correct for nearby sites', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);

    // Build a map of site name -> minimum region distance
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // Adjacent regions from Wold & Foothills
    expect(distMap.get("Eagles' Eyrie")).toBe(2);   // Anduin Vales
    expect(distMap.get('Moria')).toBe(2);            // Redhorn Gate
    // Farther sites
    expect(distMap.get('Rivendell')).toBe(4);        // Rhudaur (4 regions away)
  });
});
