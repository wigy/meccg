/**
 * @module tw-403.test
 *
 * Card test: Iron Hill Dwarf-hold (tw-403)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien"
 *
 * No automatic attacks, no playable resources, no special rules.
 * A free-hold in the Iron Hills region. Region distance from Lórien
 * (Wold & Foothills) to Iron Hills is 5 — exceeds the region-movement
 * limit of 4, so the site is only reachable via starter movement.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                            |
 * |---|-------------------|--------|------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                              |
 * | 2 | sitePath          | OK     | [wilderness, border, border, wilderness, wilderness] ✓           |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                             |
 * | 4 | playableResources | OK     | [] — card text lists no playable items                           |
 * | 5 | automaticAttacks  | OK     | [] — no attacks                                                  |
 * | 6 | resourceDraws     | OK     | 3                                                                |
 * | 7 | hazardDraws       | OK     | 3                                                                |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                      |
 * |---|---------------------|-------------|--------------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, play-res    |
 * | 2 | Starter movement    | IMPLEMENTED | reachable from Lórien (nearestHaven match) |
 * | 3 | Region movement     | IMPLEMENTED | NOT reachable (region distance 5 > max 4)  |
 * | 4 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used             |
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
import type { CardDefinitionId, SiteCard } from '../../index.js';

const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId;

describe('Iron Hill Dwarf-hold (tw-403)', () => {
  beforeEach(() => resetMint());

  test('no resources are playable — only pass is available', () => {
    const state = buildSitePhaseState({ site: IRON_HILL_DWARF_HOLD });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Iron Hill Dwarf-hold');
  });

  test('not reachable from Lórien via region movement — region distance exceeds 4', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Iron Hill Dwarf-hold',
    );

    expect(regionEntry).toBeUndefined();
  });
});
