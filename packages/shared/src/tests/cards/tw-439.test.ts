/**
 * @module tw-439.test
 *
 * Card test: Wose Passage-hold (tw-439)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * No special text beyond "Nearest Haven: Edhellond". No automatic attacks.
 * No playable resources.
 * Site Path: Wilderness/Wilderness/Wilderness
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                          |
 * | 2 | sitePath          | OK     | ["wilderness","wilderness","wilderness"] — matches {w}{w}{w}   |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool                         |
 * | 4 | playableResources | OK     | [] — no playable resources                                     |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks                                      |
 * | 6 | resourceDraws     | OK     | 2                                                              |
 * | 7 | hazardDraws       | OK     | 2                                                              |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                |
 * |---|---------------------|-------------|--------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc.  |
 * | 2 | Region movement     | IMPLEMENTED | movement-map.ts                      |
 * | 3 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used       |
 *
 * Playable: YES
 * Certified: 2026-05-11
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
  EDHELLOND,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const WOSE_PASSAGE_HOLD = 'tw-439' as CardDefinitionId;

describe('Wose Passage-hold (tw-439)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Wose Passage-hold', () => {
    const state = buildSitePhaseState({ site: WOSE_PASSAGE_HOLD });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('reachable from Edhellond via region movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Wose Passage-hold',
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('reachable from Edhellond via starter movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Wose Passage-hold');
  });
});
