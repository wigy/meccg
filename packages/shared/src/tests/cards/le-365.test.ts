/**
 * @module le-365.test
 *
 * Card test: Dimrill Dale (le-365)
 * Type: minion-site (ruins-and-lairs) in Redhorn Gate
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Information.
 *   Automatic-attacks: Orcs — 1 strike with 6 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                         |
 * | 2 | sitePath          | OK     | [dark, shadow, wilderness, wilderness] — matches card {d}{s}{w}{w}|
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367) in card pool           |
 * | 4 | region            | OK     | "Redhorn Gate" — valid region in card pool                        |
 * | 5 | playableResources | OK     | [information] — matches card text                                 |
 * | 6 | automaticAttacks  | OK     | Orcs, 1 strike, 6 prowess — data only                             |
 * | 7 | resourceDraws     | OK     | 2                                                                 |
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
 *   engine machinery that is already implemented. The Orc auto-attack is
 *   carried as data for the future auto-attack wiring — no card text
 *   asks for anything beyond the standard auto-attack flow.)
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

const DIMRILL_DALE_LE = 'le-365' as CardDefinitionId;
const DIMRILL_DALE_TW = 'tw-385' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Dimrill Dale (le-365)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → Dimrill Dale (LE) ───────────────────────────────

  test('starter movement from Dol Guldur reaches Dimrill Dale (le-365)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe365 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DIMRILL_DALE_LE as string),
    );

    expect(starterLe365).toBeDefined();
  });

  test('starter movement from Dol Guldur does NOT reach hero Dimrill Dale (tw-385)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterTw385 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DIMRILL_DALE_TW as string),
    );

    expect(starterTw385).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion Dimrill Dale (le-365)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe365 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DIMRILL_DALE_LE as string),
    );

    expect(starterLe365).toBeUndefined();
  });

  // ─── Movement: Dimrill Dale (LE) → Dol Guldur ───────────────────────────────

  test('starter movement from Dimrill Dale (le-365) reaches Dol Guldur', () => {
    const dimrillDale = pool[DIMRILL_DALE_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dimrillDale, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches le-365 within 4 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (DIMRILL_DALE_LE as string),
    );

    // Southern Mirkwood (Dol Guldur) → Anduin Vales → Wold & Foothills →
    // Redhorn Gate. That's 4 consecutive regions, so regionDistance === 4.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });

  test('haven-to-haven movement from Dol Guldur does not include le-365 (not a haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Dimrill Dale')).toBe(false);
  });
});
