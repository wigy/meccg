/**
 * @module tw-434.test
 *
 * Card test: Vale of Erech (tw-434)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * "Nearest Haven: Edhellond"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                          |
 * | 2 | sitePath          | OK     | [wilderness, border] — matches {w}{b}          |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool         |
 * | 4 | playableResources | OK     | [] — nothing playable here                     |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks                      |
 * | 6 | resourceDraws     | OK     | 1                                              |
 * | 7 | hazardDraws       | OK     | 1                                              |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                              |
 * |---|---------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement | IMPLEMENTED | movement-map.ts                     |
 * | 3 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  EDHELLOND,
  GLAMDRING,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const VALE_OF_ERECH = 'tw-434' as CardDefinitionId;

describe('Vale of Erech (tw-434)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: VALE_OF_ERECH });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('no items are playable at Vale of Erech', () => {
    const state = buildSitePhaseState({
      site: VALE_OF_ERECH,
      hand: [GLAMDRING],
    });
    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions).toHaveLength(0);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Edhellond reaches Vale of Erech', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Vale of Erech');
  });

  test('starter movement from Vale of Erech reaches Edhellond (back to nearest haven)', () => {
    const valeOfErech = pool[VALE_OF_ERECH as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, valeOfErech, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Edhellond');
  });
});
