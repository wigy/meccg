/**
 * @module tw-388.test
 *
 * Card test: Drúadan Forest (tw-388)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien"
 * Site Path: Wilderness, Border-land, Free-domain
 * No automatic attacks. No playable resources.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                |
 * |---|-------------------|--------|------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                |
 * | 2 | sitePath          | OK     | [wilderness, border, free] — matches {w}{b}{f}       |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                  |
 * | 4 | playableResources | OK     | Empty — no playable resources per card text           |
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
 * Certified: 2026-05-10
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
import type { SiteCard } from '../../index.js';

const DRUADAN_FOREST = 'tw-388' as import('../../index.js').CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Drúadan Forest (tw-388)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ─────────────────────────────────────────────────

  test('no resources playable at Drúadan Forest', () => {
    const state = buildSitePhaseState({ site: DRUADAN_FOREST });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Movement ────────────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Drúadan Forest');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Drúadan Forest',
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Rohan → Anórien = 2 edges = regionDistance 3
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('not reachable from Grey Havens via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Drúadan Forest');
  });

  // ─── No special effects ──────────────────────────────────────────────────

});
