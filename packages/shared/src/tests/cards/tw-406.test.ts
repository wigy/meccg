/**
 * @module tw-406.test
 *
 * Card test: Lake-town (tw-406)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien"
 *
 * No automatic attacks, no playable resources, no special rules.
 * A border-hold in the Northern Rhovanion region with a 4-region site path
 * (wilderness, border, border, wilderness) — reachable from Lórien via
 * both starter and region movement.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                              |
 * | 2 | sitePath          | OK     | [wilderness, border, border, wilderness] ✓         |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                |
 * | 4 | region            | OK     | "Northern Rhovanion" — valid region                |
 * | 5 | playableResources | OK     | [] — card text lists no playable items             |
 * | 6 | automaticAttacks  | OK     | [] — no attacks                                    |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                      |
 * |---|---------------------|-------------|--------------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, play-res    |
 * | 2 | Starter movement    | IMPLEMENTED | reachable from Lórien (nearestHaven match) |
 * | 3 | Region movement     | IMPLEMENTED | reachable from Lórien (4-region path)      |
 * | 4 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used             |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  viableFor,
} from '../test-helpers.js';
import {
  LORIEN, RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const LAKE_TOWN = 'tw-406' as CardDefinitionId;

describe('Lake-town (tw-406)', () => {
  beforeEach(() => resetMint());

  test('no resources are playable — only pass is available', () => {
    const state = buildSitePhaseState({ site: LAKE_TOWN });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LAKE_TOWN as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('reachable from Lórien via region movement — 4-region path at the limit', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (LAKE_TOWN as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });

  test('not reachable from Rivendell via starter movement — nearest haven is Lórien', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LAKE_TOWN as string),
    );

    expect(starterEntry).toBeUndefined();
  });
});
