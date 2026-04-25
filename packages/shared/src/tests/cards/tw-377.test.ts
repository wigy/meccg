/**
 * @module tw-377.test
 *
 * Card test: Blue Mountain Dwarf-hold (tw-377)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * "Nearest Haven: Grey Havens."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                |
 * |---|-------------------|--------|------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                  |
 * | 2 | sitePath          | OK     | [free, wilderness] — matches card {f}{w}             |
 * | 3 | nearestHaven      | OK     | "Grey Havens" — valid haven in card pool             |
 * | 4 | playableResources | OK     | [faction] — correct for free-hold                    |
 * | 5 | automaticAttacks  | OK     | Empty                                                |
 * | 6 | resourceDraws     | OK     | 1                                                    |
 * | 7 | hazardDraws       | OK     | 1                                                    |
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
 * Certified: 2026-04-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  BLUE_MOUNTAIN_DWARF_HOLD, GREY_HAVENS, BLUE_MOUNTAIN_DWARVES,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Blue Mountain Dwarf-hold (tw-377)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('faction is playable at Blue Mountain Dwarf-hold (Blue Mountain Dwarves)', () => {
    const state = buildSitePhaseState({
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const influenceActions = viableActions(state, PLAYER_1, 'influence-attempt');
    expect(influenceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: BLUE_MOUNTAIN_DWARF_HOLD });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Blue Mountain Dwarf-hold ────────────────────────────────

  test('reachable from Grey Havens via starter movement', () => {
    const greyHavens = pool[GREY_HAVENS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Blue Mountain Dwarf-hold');
  });

  test('reachable from Grey Havens via region movement at distance 2', () => {
    const greyHavens = pool[GREY_HAVENS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Blue Mountain Dwarf-hold',
    );

    expect(regionEntry).toBeDefined();
    // Lindon → Númeriador = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
