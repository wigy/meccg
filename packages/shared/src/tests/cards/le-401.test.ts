/**
 * @module le-401.test
 *
 * Card test: Sarn Goriwing (le-401)
 * Type: minion-site (shadow-hold) in the Heart of Mirkwood
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Items (minor, major).
 *   Automatic-attacks: Orcs — 3 strikes with 5 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                       |
 * |---|-------------------|--------|-------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                       |
 * | 2 | sitePath          | OK     | [dark, wilderness] — {d}{w}                                 |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367) in card pool     |
 * | 4 | region            | OK     | "Heart of Mirkwood" — valid region in card pool             |
 * | 5 | playableResources | OK     | [minor, major] — matches card text "Items (minor, major)"  |
 * | 6 | automaticAttacks  | OK     | 1 Orcs attack (3 strikes, 5 prowess) — data only           |
 * | 7 | resourceDraws     | OK     | 1                                                           |
 * | 8 | hazardDraws       | OK     | 1                                                           |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                                |
 * |---|----------------------------|-----------------|------------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources        |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Dol Guldur   |
 * | 3 | Region movement            | IMPLEMENTED     | regional distance from Southern Mirkwood             |
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase |
 * | 5 | Automatic attacks at site  | NOT IMPLEMENTED | auto-attack trigger is stubbed; data-only for now    |
 *
 * Playable: YES (no special effects; all data fields route through engine
 *   machinery that is already implemented. The single Orcs auto-attack is
 *   carried as data for the future auto-attack wiring — the card text asks
 *   for nothing beyond the standard auto-attack flow.)
 *
 * Certified: 2026-06-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const SARN_GORIWING_LE = 'le-401' as CardDefinitionId;
const SARN_GORIWING_TW = 'tw-423' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Sarn Goriwing (le-401)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → Sarn Goriwing (LE) ──────────────────────────────

  test('starter movement from Dol Guldur reaches Sarn Goriwing (le-401)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe401 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (SARN_GORIWING_LE as string),
    );

    expect(starterLe401).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach hero Sarn Goriwing (tw-423)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterTw423 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (SARN_GORIWING_TW as string),
    );

    expect(starterTw423).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion Sarn Goriwing (le-401)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe401 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (SARN_GORIWING_LE as string),
    );

    expect(starterLe401).toBeUndefined();
  });

  // ─── Movement: Sarn Goriwing → Dol Guldur ───────────────────────────────────

  test('starter movement from Sarn Goriwing (le-401) reaches Dol Guldur', () => {
    const sarnGoriwing = pool[SARN_GORIWING_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, sarnGoriwing, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches le-401 at region distance 2', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (SARN_GORIWING_LE as string),
    );

    // Southern Mirkwood (Dol Guldur) → Heart of Mirkwood (Sarn Goriwing):
    // two consecutive regions, so regionDistance === 2.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('haven-to-haven movement from Dol Guldur does not include le-401 (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Sarn Goriwing')).toBe(false);
  });
});
