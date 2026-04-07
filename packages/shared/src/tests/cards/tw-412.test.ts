/**
 * @module tw-412.test
 *
 * Card test: Minas Tirith (tw-412)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                |
 * |---|-------------------|--------|------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                  |
 * | 2 | sitePath          | OK     | [wilderness, border, free] — matches card             |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                  |
 * | 4 | playableResources | OK     | [faction] — matches card text                        |
 * | 5 | automaticAttacks  | OK     | Empty                                                |
 * | 6 | resourceDraws     | OK     | 2                                                    |
 * | 7 | hazardDraws       | OK     | 2                                                    |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Faction playability     | IMPLEMENTED | legal-actions/site.ts               |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
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
  MINAS_TIRITH, MEN_OF_ANORIEN,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Minas Tirith (tw-412)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a free-hold with correct structural properties', () => {
    const def = pool[MINAS_TIRITH as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('free-hold');
    expect(def.sitePath).toEqual(['wilderness', 'border', 'free']);
    expect(def.nearestHaven).toBe('Lórien');
    expect(def.region).toBe('Anórien');
    expect(def.playableResources).toEqual(['faction']);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('nearest haven Lórien exists in card pool', () => {
    const lorienDef = pool[LORIEN as string];
    expect(lorienDef).toBeDefined();
    expect(isSiteCard(lorienDef)).toBe(true);
    if (!isSiteCard(lorienDef)) return;
    expect(lorienDef.siteType).toBe('haven');
  });

  test('site path has valid region types', () => {
    const def = pool[MINAS_TIRITH as string];
    if (!isSiteCard(def)) return;

    const validTypes = new Set([
      'wilderness', 'border', 'free', 'coastal', 'shadow',
      'dark', 'double-wilderness', 'double-shadow-land', 'double-coastal-sea',
    ]);
    for (const region of def.sitePath) {
      expect(validTypes.has(region)).toBe(true);
    }
  });

  test('no automatic attacks', () => {
    const def = pool[MINAS_TIRITH as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('faction is playable at Minas Tirith (Men of Anórien)', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      hand: [MEN_OF_ANORIEN],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const influenceActions = viable.filter(a => a.action.type === 'influence-attempt');
    expect(influenceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: MINAS_TIRITH });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Minas Tirith ──────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Minas Tirith');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Minas Tirith',
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Rohan → Anórien = 3 regions traversed
    expect(regionEntry!.regionDistance).toBe(3);
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects beyond standard site properties', () => {
    const def = pool[MINAS_TIRITH as string];
    if (!isSiteCard(def)) return;

    // Minas Tirith has no special text beyond "Nearest Haven: Lórien"
    // which is captured structurally, not as effects
    expect(def.text).toBe('');
  });
});
