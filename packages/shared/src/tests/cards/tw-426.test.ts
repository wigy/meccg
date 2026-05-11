/**
 * @module tw-426.test
 *
 * Card test: Southron Oasis (tw-426)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * No special text beyond nearest haven. No automatic attacks. No playable resources.
 * "Nearest Haven: Edhellond"
 * Site Path: Wilderness / Free-domain / Coastal-sea / Wilderness
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                         |
 * |---|-------------------|--------|---------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                         |
 * | 2 | sitePath          | OK     | [wilderness, free, coastal, wilderness] — matches card text   |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool                        |
 * | 4 | playableResources | OK     | [] — no playable resources                                    |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks                                     |
 * | 6 | resourceDraws     | OK     | 2                                                             |
 * | 7 | hazardDraws       | OK     | 2                                                             |
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
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  EDHELLOND, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const SOUTHRON_OASIS = 'tw-426' as CardDefinitionId;

describe('Southron Oasis (tw-426)', () => {
  beforeEach(() => resetMint());

  test('no resources playable at Southron Oasis', () => {
    const state = buildSitePhaseState({ site: SOUTHRON_OASIS });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('minor items are not playable (no playableResources)', () => {
    const state = buildSitePhaseState({
      site: SOUTHRON_OASIS,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: SOUTHRON_OASIS });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('reachable from Edhellond via starter movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Southron Oasis');
  });
});
