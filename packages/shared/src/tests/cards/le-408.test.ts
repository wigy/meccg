/**
 * @module le-408.test
 *
 * Card test: Thranduil's Halls (le-408)
 * Type: minion-site (free-hold) in the Woodland Realm
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Information, Items (minor, major, gold ring).
 *   Automatic-attacks (2):
 *     (1st) Elves — each character faces 1 strike with 9 prowess
 *       (detainment against covert company);
 *     (2nd) Elves — 3 strikes with 10 prowess (against overt company only).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                               |
 * | 2 | sitePath          | OK     | [dark, wilderness, shadow] — matches card {d}{w}{s}               |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool                    |
 * | 4 | region            | OK     | "Woodland Realm" — valid region in card pool                      |
 * | 5 | playableResources | OK     | [information, minor, major, gold-ring] — matches card text        |
 * | 6 | automaticAttacks  | OK     | 2 Elves attacks (detainment-vs-covert + overt-only) — data only   |
 * | 7 | resourceDraws     | OK     | 1                                                                 |
 * | 8 | hazardDraws       | OK     | 2                                                                 |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                                   |
 * |---|----------------------------|-----------------|---------------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources           |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Dol Guldur      |
 * | 3 | Region movement            | IMPLEMENTED     | regional distance from Southern Mirkwood                |
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase    |
 * | 5 | Automatic attacks at site  | NOT IMPLEMENTED | auto-attack trigger is stubbed; data-only for now       |
 *
 * Playable: YES (no special effects; all data fields are routed through
 *   engine machinery that is already implemented. The two auto-attacks
 *   are carried as data for the future auto-attack wiring — no card
 *   text asks for anything beyond the standard auto-attack flow.)
 *
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const THRANDUILS_HALLS_LE = 'le-408' as CardDefinitionId;
const THRANDUILS_HALLS_TW = 'tw-432' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe("Thranduil's Halls (le-408)", () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → Thranduil's Halls (LE) ──────────────────────────

  test("starter movement from Dol Guldur reaches Thranduil's Halls (le-408)", () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe408 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THRANDUILS_HALLS_LE as string),
    );

    expect(starterLe408).toBeDefined();
  });

  test("starter movement from Dol Guldur does NOT reach hero Thranduil's Halls (tw-432)", () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterTw432 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THRANDUILS_HALLS_TW as string),
    );

    expect(starterTw432).toBeUndefined();
  });

  test("starter movement from Lórien does NOT reach minion Thranduil's Halls (le-408)", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe408 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THRANDUILS_HALLS_LE as string),
    );

    expect(starterLe408).toBeUndefined();
  });

  // ─── Movement: Thranduil's Halls → Dol Guldur ───────────────────────────────

  test("starter movement from Thranduil's Halls (le-408) reaches Dol Guldur", () => {
    const thranduilsHalls = pool[THRANDUILS_HALLS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, thranduilsHalls, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches le-408 within 4 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (THRANDUILS_HALLS_LE as string),
    );

    // Southern Mirkwood (Dol Guldur) → Heart of Mirkwood → Woodland Realm.
    // That's 3 consecutive regions, so regionDistance === 3.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('haven-to-haven movement from Dol Guldur does not include le-408 (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has("Thranduil's Halls")).toBe(false);
  });
});
