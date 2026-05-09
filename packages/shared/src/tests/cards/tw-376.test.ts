/**
 * @module tw-376.test
 *
 * Card test: Beorn's House (tw-376)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * No special text. No automatic attacks. No playable resources.
 * "Nearest Haven: Lórien"
 * Site Path: Wilderness, Border-land
 * Region: Anduin Vales
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
 * Certified: 2026-05-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  resetMint, pool,
  buildSitePhaseState,
  viableFor,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import type { SiteCard } from '../../index.js';

const BEORNS_HOUSE = 'tw-376' as CardDefinitionId;
// Card name uses curly apostrophe (U+2019)
const BEORNS_HOUSE_NAME = "Beorn’s House";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Beorn’s House (tw-376)", () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test("no resources playable at Beorn’s House", () => {
    const state = buildSitePhaseState({ site: BEORNS_HOUSE });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });


  // ─── Movement ──────────────────────────────────────────────────────────────

  test("reachable from Lórien via starter movement", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain(BEORNS_HOUSE_NAME);
  });

  test("reachable from Lórien via region movement", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === BEORNS_HOUSE_NAME,
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills -> Anduin Vales = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test("not reachable from Grey Havens via starter movement", () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain(BEORNS_HOUSE_NAME);
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
