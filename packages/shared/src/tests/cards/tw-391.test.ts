/**
 * @module tw-391.test
 *
 * Card test: Eagles' Eyrie (tw-391)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * No special text. No automatic attacks. No playable resources.
 * "Nearest Haven: Lórien"
 * Site Path: Wilderness, Border-land
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                 |
 * | 2 | sitePath          | OK     | [wilderness, border] — matches card text             |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                  |
 * | 4 | playableResources | OK     | Empty — no playable resources                        |
 * | 5 | automaticAttacks  | OK     | Empty — no automatic attacks                         |
 * | 6 | resourceDraws     | OK     | 1                                                    |
 * | 7 | hazardDraws       | OK     | 1                                                    |
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
  EAGLES_EYRIE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Eagles' Eyrie (tw-391)", () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a free-hold with correct structural properties', () => {
    const def = pool[EAGLES_EYRIE as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('free-hold');
    expect(def.sitePath).toEqual(['wilderness', 'border']);
    expect(def.nearestHaven).toBe('Lórien');
    expect(def.region).toBe('Anduin Vales');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(1);
    expect(def.hazardDraws).toBe(1);
  });

  test('nearest haven Lórien exists in the card pool', () => {
    const lorienDef = pool[LORIEN as string];
    expect(lorienDef).toBeDefined();
    expect(isSiteCard(lorienDef)).toBe(true);
    if (!isSiteCard(lorienDef)) return;
    expect(lorienDef.siteType).toBe('haven');
  });

  test('site path regions are valid types', () => {
    const def = pool[EAGLES_EYRIE as string];
    if (!isSiteCard(def)) return;

    const validTypes = new Set([
      'wilderness', 'border', 'free', 'coastal', 'shadow',
      'dark', 'double-wilderness', 'double-shadow-land', 'double-coastal-sea',
    ]);
    for (const region of def.sitePath) {
      expect(validTypes.has(region)).toBe(true);
    }
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Eagles\' Eyrie', () => {
    const state = buildSitePhaseState({ site: EAGLES_EYRIE });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('no automatic attacks', () => {
    const def = pool[EAGLES_EYRIE as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain("Eagles' Eyrie");
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === "Eagles' Eyrie",
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Anduin Vales = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('not reachable from Grey Havens via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain("Eagles' Eyrie");
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects — empty text and no effects array', () => {
    const def = pool[EAGLES_EYRIE as string];
    if (!isSiteCard(def)) return;

    expect(def.text).toBe('');
    expect('effects' in def).toBe(false);
  });
});
