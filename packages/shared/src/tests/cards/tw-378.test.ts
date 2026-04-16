/**
 * @module tw-378.test
 *
 * Card test: Bree (tw-378)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                         |
 * |---|-------------------|--------|-----------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                         |
 * | 2 | sitePath          | OK     | wilderness, wilderness — matches card          |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool         |
 * | 4 | playableResources | OK     | Empty                                          |
 * | 5 | automaticAttacks  | OK     | Empty                                          |
 * | 6 | resourceDraws     | OK     | 1                                              |
 * | 7 | hazardDraws       | OK     | 1                                              |
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
  viableFor,
} from '../test-helpers.js';
import {
  BREE, BARROW_DOWNS, OLD_FOREST, THE_WHITE_TOWERS_HERO,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Bree (tw-378)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Bree (empty playableResources)', () => {
    const state = buildSitePhaseState({ site: BREE });
    const viable = viableFor(state, PLAYER_1);

    // Only action should be pass (no items/allies/factions playable)
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });


  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Rivendell reaches Bree', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Bree');
  });

  test('region movement from Bree reaches nearby Arthedain sites', () => {
    const bree = pool[BREE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, bree, allSites);
    const regionNames = [...new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    )];

    // Same region (Arthedain) — The White Towers is also in Arthedain
    expect(regionNames).toContain(pool[THE_WHITE_TOWERS_HERO as string].name);
    // Adjacent regions — Barrow-downs (Cardolan), Old Forest (Cardolan)
    expect(regionNames).toContain(pool[BARROW_DOWNS as string].name);
    expect(regionNames).toContain(pool[OLD_FOREST as string].name);
  });

  test('region movement distance to same-region sites is 1', () => {
    const bree = pool[BREE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, bree, allSites);

    // Build a map of site name -> minimum region distance
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // The White Towers is also in Arthedain (same region = distance 1)
    expect(distMap.get(pool[THE_WHITE_TOWERS_HERO as string].name)).toBe(1);
    // Barrow-downs is in Cardolan (adjacent to Arthedain = distance 2)
    expect(distMap.get(pool[BARROW_DOWNS as string].name)).toBe(2);
    expect(distMap.get(pool[OLD_FOREST as string].name)).toBe(2);
  });

  test('starter movement from Bree reaches Rivendell (back to nearest haven)', () => {
    const bree = pool[BREE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, bree, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Rivendell');
  });
});
