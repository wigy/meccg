/**
 * @module tw-419.test
 *
 * Card test: Pelargir (tw-419)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * No special rules — standard site with text "Nearest Haven: Edhellond."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                |
 * | 2 | sitePath          | OK     | [wilderness, border, free] — 3 regions             |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool             |
 * | 4 | playableResources | OK     | [] — no resources playable                         |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks                          |
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
 * Certified: 2026-04-13
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  EDHELLOND,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  PELARGIR, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Pelargir (tw-419)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Pelargir', () => {
    const state = buildSitePhaseState({ site: PELARGIR });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('minor items are not playable (no playableResources)', () => {
    const state = buildSitePhaseState({
      site: PELARGIR,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: PELARGIR });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Pelargir ──────────────────────────────────────────────────

  test('reachable from Edhellond via starter movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Pelargir');
  });

  test('starter movement from Pelargir reaches Edhellond (back to nearest haven)', () => {
    const pelargir = pool[PELARGIR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, pelargir, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Edhellond');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
