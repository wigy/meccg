/**
 * @module tw-390.test
 *
 * Card test: Dunnish Clan-hold (tw-390)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * No special text. No automatic attacks. No playable resources.
 * "Nearest Haven: Rivendell."
 * Site Path: Wilderness, Wilderness, Wilderness
 * Region: Dunland
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                              |
 * | 2 | sitePath          | OK     | [wilderness, wilderness, wilderness] = {w}{w}{w}   |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool             |
 * | 4 | playableResources | OK     | Empty — no playable attribute in authoritative DB  |
 * | 5 | automaticAttacks  | OK     | Empty — no automatic attacks                       |
 * | 6 | resourceDraws     | OK     | 2                                                  |
 * | 7 | hazardDraws       | OK     | 2                                                  |
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
  RIVENDELL, LORIEN,
  resetMint, pool,
  buildSitePhaseState,
  viableFor,
} from '../test-helpers.js';
import {
  DUNNISH_CLAN_HOLD,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Dunnish Clan-hold (tw-390)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ──────────────────────────────────────────────────

  test('no resources playable at Dunnish Clan-hold', () => {
    const state = buildSitePhaseState({ site: DUNNISH_CLAN_HOLD });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dunnish Clan-hold');
  });

  test('reachable from Rivendell via region movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Dunnish Clan-hold',
    );

    expect(regionEntry).toBeDefined();
    // Dunland is reachable within 4 regions from Rivendell
    expect(regionEntry!.regionDistance).toBeGreaterThan(0);
    expect(regionEntry!.regionDistance).toBeLessThanOrEqual(4);
  });

  test('not reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Dunnish Clan-hold');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
