/**
 * @module tw-432.test
 *
 * Card test: Thranduil's Halls (tw-432)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                        |
 * | 2 | sitePath          | OK     | [wilderness, border, border] — 3-region path from Lórien  |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                       |
 * | 4 | playableResources | OK     | [faction] — correct for free-hold                          |
 * | 5 | automaticAttacks  | OK     | Empty                                                      |
 * | 6 | resourceDraws     | OK     | 2                                                          |
 * | 7 | hazardDraws       | OK     | 2                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Faction playability     | IMPLEMENTED | legal-actions/site.ts               |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  THRANDUILS_HALLS, LORIEN, WOOD_ELVES,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

const SITE_NAME = 'Thranduil’s Halls';

describe(`${SITE_NAME} (tw-432)`, () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('faction is playable at Thranduil’s Halls (Wood-elves)', () => {
    const state = buildSitePhaseState({
      site: THRANDUILS_HALLS,
      hand: [WOOD_ELVES],
    });
    const influenceActions = viableActions(state, PLAYER_1, 'influence-attempt');
    expect(influenceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: THRANDUILS_HALLS });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Thranduil’s Halls ─────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain(SITE_NAME);
  });

  test('reachable from Lórien via region movement at distance 3', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === SITE_NAME,
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Anduin Vales → Woodland Realm = 3 regions traversed
    expect(regionEntry!.regionDistance).toBe(3);
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
