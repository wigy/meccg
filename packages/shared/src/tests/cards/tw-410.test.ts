/**
 * @module tw-410.test
 *
 * Card test: Lossadan Camp (tw-410)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * No special text beyond "Nearest Haven: Rivendell". No automatic attacks.
 * No playable resources.
 * Site Path: Wilderness/Wilderness/Wilderness
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                        |
 * |---|-------------------|--------|--------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                        |
 * | 2 | sitePath          | OK     | ["wilderness","wilderness","wilderness"] — matches {w}{w}{w} |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool                       |
 * | 4 | playableResources | OK     | [] — no playable resources                                   |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks                                    |
 * | 6 | resourceDraws     | OK     | 2                                                            |
 * | 7 | hazardDraws       | OK     | 2                                                            |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                |
 * |---|---------------------|-------------|--------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc.  |
 * | 2 | Region movement     | IMPLEMENTED | movement-map.ts                      |
 * | 3 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used       |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  viableFor,
} from '../test-helpers.js';
import {
  RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const LOSSADAN_CAMP = 'tw-410' as CardDefinitionId;

describe('Lossadan Camp (tw-410)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Lossadan Camp', () => {
    const state = buildSitePhaseState({ site: LOSSADAN_CAMP });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('reachable from Rivendell via region movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Lossadan Camp',
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Lossadan Camp');
  });
});
