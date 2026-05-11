/**
 * @module tw-438.test
 *
 * Card test: Woodmen-town (tw-438)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * No special text beyond "Nearest Haven: Lórien". No automatic attacks.
 * No playable resources.
 * Site Path: Wilderness/Border/Wilderness ({w}{b}{w})
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                    |
 * | 2 | sitePath          | OK     | ["wilderness","border","wilderness"] — matches {w}{b}{w} |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                      |
 * | 4 | region            | OK     | "Western Mirkwood" — valid region in card pool           |
 * | 5 | playableResources | OK     | [] — no playable resources                               |
 * | 6 | automaticAttacks  | OK     | [] — no automatic attacks                                |
 * | 7 | resourceDraws     | OK     | 2                                                        |
 * | 8 | hazardDraws       | OK     | 2                                                        |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                               |
 * |---|---------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Starter movement    | IMPLEMENTED | nearestHaven = Lórien               |
 * | 3 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used      |
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
  LORIEN,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const WOODMEN_TOWN = 'tw-438' as CardDefinitionId;

describe('Woodmen-town (tw-438)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ───────────────────────────────────────────────────

  test('no resources playable at Woodmen-town', () => {
    const state = buildSitePhaseState({ site: WOODMEN_TOWN });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (WOODMEN_TOWN as string),
    );

    expect(entry).toBeDefined();
  });
});
