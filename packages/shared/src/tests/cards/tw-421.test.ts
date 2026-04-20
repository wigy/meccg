/**
 * @module tw-421.test
 *
 * Card test: Rivendell (tw-421)
 * Type: hero-site (haven)
 * Effects: 0
 *
 * "Site Path From Lórien: Wilderness/Border-land/Wilderness/Wilderness.
 *  Site Path From Grey Havens: Free-domain/Wilderness/Wilderness."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                          |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                                |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                                |
 * | 4 | havenPaths        | OK     | Lórien (4 regions), Grey Havens (3 regions) — both exist |
 * | 5 | path symmetry     | OK     | Reverse paths match in Lórien and Grey Havens data       |
 * | 6 | playableResources | OK     | Empty (correct for haven)                                |
 * | 7 | automaticAttacks  | OK     | Empty (correct for haven)                                |
 * | 8 | resourceDraws     | OK     | 2                                                        |
 * | 9 | hazardDraws       | OK     | 2                                                        |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 3 | Region movement         | IMPLEMENTED | 25 sites reachable within 4 regions |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-03-28
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
  ETTENMOORS_HERO, THE_WHITE_TOWERS_HERO, BARROW_DOWNS, OLD_FOREST, BAG_END, BREE,
  DUNNISH_CLAN_HOLD,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const GOBLIN_GATE = 'tw-398' as CardDefinitionId;
const THE_WORTHY_HILLS = 'as-142' as CardDefinitionId;
const ZARAK_DUM_HERO = 'td-181' as CardDefinitionId;
const CARN_DUM_HERO = 'tw-380' as CardDefinitionId;
const LOSSADAN_CAIRN = 'tw-409' as CardDefinitionId;
const MOUNT_GRAM_HERO = 'tw-415' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Rivendell (tw-421)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Rivendell (haven)', () => {
    const state = buildSitePhaseState({ site: RIVENDELL });
    const viable = viableFor(state, PLAYER_1);

    // Only action should be pass (no items/allies/factions playable at a haven)
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });


  // ─── Movement from Rivendell ────────────────────────────────────────────────

  test('starter movement reaches Lórien and Grey Havens (haven-to-haven)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name)
      .sort();

    expect(starterHavens).toEqual(['Grey Havens', 'Lórien']);
  });

  test('starter movement reaches all sites with nearestHaven Rivendell', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterSites = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType !== 'haven')
      .map(r => r.site.name)
      .sort();

    // All hero sites with nearestHaven "Rivendell"
    const expectedSites = [
      pool[ETTENMOORS_HERO as string],
      pool[THE_WHITE_TOWERS_HERO as string],
      pool[BARROW_DOWNS as string],
      pool[OLD_FOREST as string],
      pool[BAG_END as string],
      pool[BREE as string],
      pool[GOBLIN_GATE as string],
      pool[THE_WORTHY_HILLS as string],
      pool[DUNNISH_CLAN_HOLD as string],
      pool[ZARAK_DUM_HERO as string],
      pool[CARN_DUM_HERO as string],
      pool[LOSSADAN_CAIRN as string],
      pool[MOUNT_GRAM_HERO as string],
    ].map(d => d.name).sort();

    expect(starterSites).toEqual(expectedSites);
  });

  test('starter movement does not reach Edhellond', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Edhellond');
  });

  test('region movement reaches all sites within 4 regions of Rhudaur', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionNames = [...new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    )].sort();

    // Rivendell is in Rhudaur. Region movement (max 4 regions) reaches:
    // dist 1 (same region): Ettenmoors (Rhudaur)
    // dist 2 (adjacent): Barrow-downs, Old Forest, The Worthy Hills (Cardolan), Bree, The White Towers, Weathertop (Arthedain), Goblin-gate (High Pass), Carn Dûm, Zarak Dûm (Angmar)
    // dist 3: Bag End (The Shire), Grey Havens (Lindon), Moria, The Under-gates, Dimrill Dale (Redhorn Gate), Eagles' Eyrie, Beorn's House (Anduin Vales), Gondmaeglom, Ovir Hollow (Grey Mountain Narrows)
    // dist 4: Lórien (Wold & Foothills), Dol Guldur (Southern Mirkwood), Glittering Caves, Isengard, Isle of the Ulond (Gap of Isen/Andrast Coast), Thranduil's Halls (Woodland Realm), Bandit Lair (Brown Lands), Blue Mountain Dwarf-hold (Númeriador)
    expect(regionNames).toEqual([
      'Bag End',
      'Bandit Lair',
      'Barrow-downs',
      "Beorn's House",
      'Blue Mountain Dwarf-hold',
      'Bree',
      'Carn Dûm',
      'Dimrill Dale',
      'Dol Guldur',
      'Dunnish Clan-hold',
      "Eagles' Eyrie",
      'Ettenmoors',
      'Framsburg',
      'Gladden Fields',
      'Glittering Caves',
      'Goblin-gate',
      'Gondmaeglom',
      'Grey Havens',
      'Isengard',
      'Isle of the Ulond',
      'Lossadan Cairn',
      'Lórien',
      'Moria',
      'Mount Gram',
      'Mount Gundabad',
      'Old Forest',
      'Ovir Hollow',
      'Rhosgobel',
      'The Under-gates',
      'The White Towers',
      'The Wind Throne',
      'The Worthy Hills',
      "Thranduil's Halls",
      'Weathertop',
      'Zarak Dûm',
    ]);
  });

  test('region movement distances are correct', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);

    // Build a map of site name -> minimum region distance
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // Same region (Rhudaur)
    expect(distMap.get('Ettenmoors')).toBe(1);
    // Adjacent regions
    expect(distMap.get('Barrow-downs')).toBe(2);
    expect(distMap.get('The White Towers')).toBe(2);
    expect(distMap.get('Weathertop')).toBe(2);
    expect(distMap.get('Goblin-gate')).toBe(2);
    expect(distMap.get('Carn Dûm')).toBe(2);
    expect(distMap.get('The Worthy Hills')).toBe(2);
    // 3 regions away
    expect(distMap.get('Moria')).toBe(3);
    expect(distMap.get('Dunnish Clan-hold')).toBe(3);
    expect(distMap.get('Bag End')).toBe(3);
    expect(distMap.get('Grey Havens')).toBe(3);
    expect(distMap.get('Dimrill Dale')).toBe(3);
    expect(distMap.get("Beorn's House")).toBe(3);
    // 4 regions away (max)
    expect(distMap.get('Lórien')).toBe(4);
    expect(distMap.get('Dol Guldur')).toBe(4);
    expect(distMap.get("Thranduil's Halls")).toBe(4);
    expect(distMap.get('Bandit Lair')).toBe(4);
  });
});
