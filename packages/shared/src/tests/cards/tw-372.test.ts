/**
 * @module tw-372.test
 *
 * Card test: Bag End (tw-372)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * No special text. No automatic attacks. No playable resources.
 * "Nearest Haven: Rivendell"
 * Site Path: Wilderness, Wilderness, Free-domain
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                 |
 * | 2 | sitePath          | OK     | [wilderness, wilderness, free] — matches card text   |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool               |
 * | 4 | playableResources | OK     | Empty — no playable resources                        |
 * | 5 | automaticAttacks  | OK     | Empty — no automatic attacks                         |
 * | 6 | resourceDraws     | OK     | 2                                                    |
 * | 7 | hazardDraws       | OK     | 2                                                    |
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
  resetMint, pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  BAG_END, RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Bag End (tw-372)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a free-hold with correct structural properties', () => {
    const def = pool[BAG_END as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('free-hold');
    expect(def.sitePath).toEqual(['wilderness', 'wilderness', 'free']);
    expect(def.nearestHaven).toBe('Rivendell');
    expect(def.region).toBe('The Shire');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('nearest haven Rivendell exists in the card pool', () => {
    const rivendellDef = pool[RIVENDELL as string];
    expect(rivendellDef).toBeDefined();
    expect(isSiteCard(rivendellDef)).toBe(true);
    if (!isSiteCard(rivendellDef)) return;
    expect(rivendellDef.siteType).toBe('haven');
  });

  test('site path regions are valid types', () => {
    const def = pool[BAG_END as string];
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

  test('no resources playable at Bag End', () => {
    const state = buildSitePhaseState({ site: BAG_END });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('no automatic attacks', () => {
    const def = pool[BAG_END as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Bag End');
  });

  test('reachable from Rivendell via region movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Bag End',
    );

    expect(regionEntry).toBeDefined();
    // Rhudaur → Arthedain → The Shire = 3 regions traversed
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('not reachable from Lórien via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const lorien = allSites.find(s => s.name === 'Lórien')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Bag End');
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects — empty text and no effects array', () => {
    const def = pool[BAG_END as string];
    if (!isSiteCard(def)) return;

    expect(def.text).toBe('');
    expect('effects' in def).toBe(false);
  });
});
