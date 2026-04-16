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
  viableActions,
} from '../test-helpers.js';
import {
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


  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources are playable at Wellinghall (no playable resource types)', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: WELLINGHALL });
    const passActions = viableActions(state, PLAYER_1, 'pass');
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

});
