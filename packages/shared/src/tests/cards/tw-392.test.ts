/**
 * @module tw-392.test
 *
 * Card test: Easterling Camp (tw-392)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * Text: "Nearest Haven: Lórien"
 * No playable resources. No automatic attacks. No special rules beyond structural data.
 * Site Path: Wilderness / Shadow / Shadow / Shadow (4 regions — Wold & Foothills → Brown Lands → Dagorlad → Horse Plains)
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                              |
 * | 2 | sitePath          | OK     | [wilderness, shadow, shadow, shadow] — 4 regions to Horse Plains   |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven (tw-408) in card pool                       |
 * | 4 | playableResources | OK     | [] — no items playable (no "Playable:" clause in text)             |
 * | 5 | automaticAttacks  | OK     | [] — no attacks (no "Automatic-attacks:" clause in text)           |
 * | 6 | resourceDraws     | OK     | 4                                                                  |
 * | 7 | hazardDraws       | OK     | 4                                                                  |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                               |
 * |---|---------------------|-------------|--------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement | IMPLEMENTED | movement-map.ts                     |
 * | 3 | Region movement     | IMPLEMENTED | sites reachable within 4 regions    |
 * | 4 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1,
  LORIEN, RIVENDELL,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const EASTERLING_CAMP = 'tw-392' as CardDefinitionId;

describe('Easterling Camp (tw-392)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Easterling Camp', () => {
    const state = buildSitePhaseState({ site: EASTERLING_CAMP });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: EASTERLING_CAMP });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Easterling Camp');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Easterling Camp',
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });

  test('not reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Easterling Camp');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
