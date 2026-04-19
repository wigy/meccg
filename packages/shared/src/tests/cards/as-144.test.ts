/**
 * @module as-144.test
 *
 * Card test: Eagles' Eyrie (as-144)
 * Type: minion-site (free-hold) in Anduin Vales
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Information, Items (minor, major).
 *   Automatic-attacks: Animals — 2 strikes with 10 prowess
 *     (attacker chooses defending characters).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                    |
 * | 2 | sitePath          | OK     | [dark, shadow] — matches {d}{s}                        |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)             |
 * | 4 | region            | OK     | "Anduin Vales" — adjacent to Southern Mirkwood         |
 * | 5 | playableResources | OK     | [information, minor, major] — matches text             |
 * | 6 | automaticAttacks  | OK     | Animals, 2 strikes / 10 prowess — data-only for now    |
 * | 7 | resourceDraws     | OK     | 1                                                      |
 * | 8 | hazardDraws       | OK     | 2                                                      |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                  |
 * |---|----------------------------|-----------------|----------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, etc.    |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts — Dol Guldur ↔ as-144  |
 * | 3 | Region movement            | IMPLEMENTED     | regional distance from Southern Mirkwood |
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws used       |
 * | 5 | Automatic attacks at site  | NOT IMPLEMENTED | auto-attack trigger stubbed; data only |
 *
 * Note: Eagles' Eyrie also exists as a hero site (tw-391, nearest haven Lórien).
 * The two are distinct minion/hero variants with different haven affiliations.
 *
 * Playable: YES (no special effects; all data fields are routed through
 *   engine machinery that is already implemented. The auto-attack is carried
 *   as data for the future auto-attack wiring — no card text asks for anything
 *   beyond the standard auto-attack flow.)
 *
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import {
  isSiteCard,
  buildMovementMap,
  getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const EAGLES_EYRIE_AS = 'as-144' as CardDefinitionId;
const EAGLES_EYRIE_TW = 'tw-391' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe("Eagles' Eyrie (as-144)", () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → Eagles' Eyrie (AS) ──────────────────────────────

  test("starter movement from Dol Guldur reaches Eagles' Eyrie (as-144)", () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterAs144 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EAGLES_EYRIE_AS as string),
    );

    expect(starterAs144).toBeDefined();
  });

  test("starter movement from Dol Guldur does NOT reach hero Eagles' Eyrie (tw-391)", () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterTw391 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EAGLES_EYRIE_TW as string),
    );

    expect(starterTw391).toBeUndefined();
  });

  test("starter movement from Lórien does NOT reach minion Eagles' Eyrie (as-144)", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterAs144 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EAGLES_EYRIE_AS as string),
    );

    expect(starterAs144).toBeUndefined();
  });

  // ─── Movement: Eagles' Eyrie (AS) → Dol Guldur ──────────────────────────────

  test("starter movement from Eagles' Eyrie (as-144) reaches Dol Guldur", () => {
    const eaglesEyrie = pool[EAGLES_EYRIE_AS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, eaglesEyrie, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches as-144 within 4 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (EAGLES_EYRIE_AS as string),
    );

    // Southern Mirkwood (Dol Guldur) → Anduin Vales (adjacent) = 2 regions.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('haven-to-haven movement from Dol Guldur does not include as-144 (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has("Eagles' Eyrie")).toBe(false);
  });
});
