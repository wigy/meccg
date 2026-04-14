/**
 * @module tw-386.test
 *
 * Card test: Dol Amroth (tw-386)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * "Nearest Haven: Edhellond"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                |
 * |---|-------------------|--------|------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                  |
 * | 2 | sitePath          | OK     | [wilderness, free] — matches card                    |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool               |
 * | 4 | playableResources | OK     | [faction] — matches card text                        |
 * | 5 | automaticAttacks  | OK     | Empty                                                |
 * | 6 | resourceDraws     | OK     | 1                                                    |
 * | 7 | hazardDraws       | OK     | 1                                                    |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Faction playability     | IMPLEMENTED | legal-actions/site.ts               |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-04-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  DOL_AMROTH, EDHELLOND, KNIGHTS_OF_DOL_AMROTH,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Dol Amroth (tw-386)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('faction is playable at Dol Amroth (Knights of Dol Amroth)', () => {
    const state = buildSitePhaseState({
      site: DOL_AMROTH,
      hand: [KNIGHTS_OF_DOL_AMROTH],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const influenceActions = viable.filter(a => a.action.type === 'influence-attempt');
    expect(influenceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: DOL_AMROTH });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Dol Amroth ───────────────────────────────────────────────

  test('reachable from Edhellond via starter movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dol Amroth');
  });

  test('reachable from Edhellond via region movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Dol Amroth',
    );

    expect(regionEntry).toBeDefined();
    // Anfalas → Belfalas = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
