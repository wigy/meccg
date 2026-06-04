/**
 * @module le-387.test
 *
 * Card test: The Lonely Mountain (le-387)
 * Type: minion-site (ruins-and-lairs) in Northern Rhovanion
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur
 *   Playable: Items (minor, major, greater, gold ring)
 *   Automatic-attacks: Dragon — 1 strike with 14 prowess
 *
 * Two sites share the name "The Lonely Mountain": the hero version at
 * tw-428 (keyed to Lórien) and this minion version at le-387 (keyed to
 * Dol Guldur). The movement tests below confirm that the minion version
 * is reachable only from the minion starter haven Dol Guldur.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                                  |
 * |---|-------------------|--------|------------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                              |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness] — matches card {d}{w}{w}                |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool (le-367)                |
 * | 4 | region            | OK     | "Northern Rhovanion" — valid region in card pool                       |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches card text                 |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 14 prowess — data only (auto-attack combat stubbed)  |
 * | 7 | resourceDraws     | OK     | 2                                                                      |
 * | 8 | hazardDraws       | OK     | 2                                                                      |
 *
 * Engine Support:
 * | # | Feature                         | Status          | Notes                                                           |
 * |---|---------------------------------|-----------------|-----------------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED     | select-company, enter-or-skip, play-resources                   |
 * | 2 | Haven path movement             | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Dol Guldur              |
 * | 3 | Region movement                 | IMPLEMENTED     | Northern Rhovanion is 3 region-hops from Southern Mirkwood      |
 * | 4 | Card draws                      | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase            |
 * | 5 | Automatic attacks at site       | NOT IMPLEMENTED | auto-attack trigger is stubbed; data-only for now               |
 *
 * Playable: YES — no DSL effects required. The card text is fully described
 *   by structural data fields. Auto-attacks are data-only (stubbed) as with
 *   all other sites in the current engine.
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

const LONELY_MOUNTAIN_LE = 'le-387' as CardDefinitionId;
const LONELY_MOUNTAIN_TW = 'tw-428' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

describe('The Lonely Mountain (le-387)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → The Lonely Mountain (LE) ───────────────────────

  test('starter movement from Dol Guldur reaches minion The Lonely Mountain (le-387)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe387 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LONELY_MOUNTAIN_LE as string),
    );

    expect(starterLe387).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach hero The Lonely Mountain (tw-428)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterTw428 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LONELY_MOUNTAIN_TW as string),
    );

    expect(starterTw428).toBeUndefined();
  });

  test('starter movement from Minas Morgul does NOT reach minion The Lonely Mountain (le-387)', () => {
    // le-387's nearestHaven is Dol Guldur, not Minas Morgul.
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterLe387 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LONELY_MOUNTAIN_LE as string),
    );

    expect(starterLe387).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion The Lonely Mountain (le-387)', () => {
    // Lórien is a hero haven; minion sites keyed to Dol Guldur are not reachable from it.
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe387 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LONELY_MOUNTAIN_LE as string),
    );

    expect(starterLe387).toBeUndefined();
  });

  // ─── Movement: The Lonely Mountain → Dol Guldur ────────────────────────────

  test('starter movement from minion The Lonely Mountain (le-387) reaches Dol Guldur', () => {
    const lonelyMountain = pool[LONELY_MOUNTAIN_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lonelyMountain, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  test('starter movement from minion The Lonely Mountain (le-387) does NOT reach Minas Morgul', () => {
    const lonelyMountain = pool[LONELY_MOUNTAIN_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lonelyMountain, allSites);
    const starterMinasMorgul = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starterMinasMorgul).toBeUndefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches le-387 with distance 3', () => {
    // Dol Guldur is in Southern Mirkwood; The Lonely Mountain is in Northern Rhovanion.
    // Southern Mirkwood → Southern Rhovanion → Northern Rhovanion is 2 edges → regionDistance = 3.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (LONELY_MOUNTAIN_LE as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('haven-to-haven movement from Dol Guldur does not include The Lonely Mountain (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('The Lonely Mountain')).toBe(false);
  });
});
