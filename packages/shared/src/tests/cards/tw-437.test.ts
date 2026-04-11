/**
 * @module tw-437.test
 *
 * Card test: Wellinghall (tw-437)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — Fangorn                 |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                |
 * | 4 | playableResources | OK     | [] — no playable resources (matches card text)     |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks (matches card text)      |
 * | 6 | resourceDraws     | OK     | 1                                                  |
 * | 7 | hazardDraws       | OK     | 1                                                  |
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
 * Certified: 2026-04-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  resetMint,
  pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  WELLINGHALL,
  GLAMDRING,
  isSiteCard,
  buildMovementMap,
  getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Wellinghall (tw-437)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a free-hold with correct structural properties', () => {
    const def = pool[WELLINGHALL as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('free-hold');
    expect(def.sitePath).toEqual(['wilderness', 'wilderness']);
    expect(def.nearestHaven).toBe('Lórien');
    expect(def.region).toBe('Fangorn');
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
    const def = pool[WELLINGHALL as string];
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

  test('no resources are playable at Wellinghall (no playable resource types)', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      hand: [GLAMDRING],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: WELLINGHALL });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Wellinghall ───────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Wellinghall');
  });

  test('reachable from Lórien via region movement at distance 2', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Wellinghall',
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Fangorn = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects beyond standard site properties', () => {
    const def = pool[WELLINGHALL as string];
    if (!isSiteCard(def)) return;

    expect(def.effects).toEqual([]);
    expect(def.text).toContain('Lórien');
  });
});
