/**
 * @module tw-435.test
 *
 * Card test: Variag Camp (tw-435)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * "Nearest Haven: Edhellond"
 * No automatic attacks. No playable resources.
 * Site Path: wilderness / free / coastal-sea / wilderness / shadow
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                             |
 * | 2 | sitePath          | OK     | [wilderness, free, coastal-sea, wilderness, shadow]               |
 * |   |                   |        | matches {w}{f}{c}{w}{s} from data/cards.json                      |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool (tw-393)                   |
 * | 4 | playableResources | OK     | [] — no playable resources, matches absent "playable" in data     |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks                                         |
 * | 6 | resourceDraws     | OK     | 3                                                                 |
 * | 7 | hazardDraws       | OK     | 4                                                                 |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                  |
 * |---|---------------------|-------------|----------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc.    |
 * | 2 | Starter movement    | IMPLEMENTED | movement-map.ts haven-site indexing    |
 * | 3 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used in M/H  |
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

const VARIAG_CAMP = 'tw-435' as CardDefinitionId;

describe('Variag Camp (tw-435)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ─────────────────────────────────────────────────────

  test('no resources playable at Variag Camp', () => {
    const state = buildSitePhaseState({ site: VARIAG_CAMP });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Movement ────────────────────────────────────────────────────────────────

  test('starter movement from Edhellond reaches Variag Camp', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (VARIAG_CAMP as string),
    );

    expect(entry).toBeDefined();
  });

  test('starter movement from Variag Camp reaches Edhellond', () => {
    const variegCamp = pool[VARIAG_CAMP as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, variegCamp, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDHELLOND as string),
    );

    expect(entry).toBeDefined();
  });
});
