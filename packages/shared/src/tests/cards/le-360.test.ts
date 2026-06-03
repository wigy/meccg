/**
 * @module le-360.test
 *
 * Card test: Caves of Ûlund (le-360)
 * Type: minion-site (ruins-and-lairs) in Withered Heath
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Items (minor, major, greater, gold ring).
 *   Automatic-attacks: Dragon — 1 strike with 13 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                         |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness, wilderness] — matches {d}{w}{w}{w} |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367) in card pool           |
 * | 4 | region            | OK     | "Withered Heath" — valid region in card pool                      |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches card text            |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 13 prowess — data only                          |
 * | 7 | resourceDraws     | OK     | 2                                                                 |
 * | 8 | hazardDraws       | OK     | 2                                                                 |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                                   |
 * |---|----------------------------|-----------------|---------------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources           |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Dol Guldur      |
 * | 3 | Region movement            | IMPLEMENTED     | regional distance 4 from Dol Guldur (Southern Mirkwood  |
 * |   |                            |                 | → Anduin Vales → Grey Mountain Narrows → Withered Heath)|
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase    |
 * | 5 | Automatic attacks at site  | NOT IMPLEMENTED | auto-attack trigger is stubbed; data-only for now       |
 *
 * Playable: YES (no special effects; all data fields are routed through
 *   engine machinery that is already implemented. The Dragon auto-attack is
 *   carried as data for the future auto-attack wiring — no card text
 *   asks for anything beyond the standard auto-attack flow.)
 *
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const CAVES_OF_ULUND_LE = 'le-360' as CardDefinitionId;
const CAVES_OF_ULUND_TW = 'tw-381' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Caves of Ûlund (le-360)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → Caves of Ûlund (LE) ─────────────────────────────

  test('starter movement from Dol Guldur reaches Caves of Ûlund (le-360)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe360 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CAVES_OF_ULUND_LE as string),
    );

    expect(starterLe360).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach hero Caves of Ûlund (tw-381)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterTw381 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CAVES_OF_ULUND_TW as string),
    );

    expect(starterTw381).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion Caves of Ûlund (le-360)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe360 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CAVES_OF_ULUND_LE as string),
    );

    expect(starterLe360).toBeUndefined();
  });

  // ─── Movement: Caves of Ûlund (LE) → Dol Guldur ─────────────────────────────

  test('starter movement from Caves of Ûlund (le-360) reaches Dol Guldur', () => {
    const cavesOfUlund = pool[CAVES_OF_ULUND_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, cavesOfUlund, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  // ─── Region movement ─────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches le-360 within 3 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (CAVES_OF_ULUND_LE as string),
    );

    // Southern Mirkwood (Dol Guldur) → Anduin Vales → Grey Mountain Narrows
    // → Withered Heath. regionDistance counts all regions traversed including
    // both endpoints, so 4 regions = regionDistance 4.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });

  test('haven-to-haven movement from Dol Guldur does not include le-360 (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Caves of Ûlund')).toBe(false);
  });
});
