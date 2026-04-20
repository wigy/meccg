/**
 * @module le-373.test
 *
 * Card test: Ettenmoors (le-373)
 * Type: minion-site (ruins-and-lairs) in Rhudaur
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Carn Dûm.
 *   Playable: Items (minor).
 *   Automatic-attacks (2):
 *     (1st) Troll — 1 strike with 9 prowess;
 *     (2nd) Wolves — 2 strikes with 8 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                         |
 * | 2 | sitePath          | OK     | [shadow, wilderness] — matches card {s}{w}                        |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven in card pool (le-359)             |
 * | 4 | region            | OK     | "Rhudaur" — valid region in card pool                             |
 * | 5 | playableResources | OK     | [minor] — matches card text                                       |
 * | 6 | automaticAttacks  | OK     | Trolls 1×9 + Wolves 2×8 — data only (auto-attack combat stubbed)  |
 * | 7 | resourceDraws     | OK     | 1                                                                 |
 * | 8 | hazardDraws       | OK     | 1                                                                 |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                                   |
 * |---|----------------------------|-----------------|---------------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources           |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Carn Dûm        |
 * | 3 | Region movement            | IMPLEMENTED     | Rhudaur is adjacent to Angmar (Carn Dûm)                |
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase    |
 * | 5 | Automatic attacks at site  | NOT IMPLEMENTED | auto-attack trigger is stubbed; data-only for now       |
 *
 * Playable: YES (no special effects; all data fields are routed through
 *   engine machinery that is already implemented. The two auto-attacks
 *   are carried as data for the future auto-attack wiring — no card
 *   text asks for anything beyond the standard auto-attack flow.)
 *
 * Certified: 2026-04-20
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const ETTENMOORS_LE = 'le-373' as CardDefinitionId;
const ETTENMOORS_TW = 'tw-395' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Ettenmoors (le-373)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Carn Dûm → Ettenmoors (LE) ───────────────────────────────────

  test('starter movement from Carn Dûm reaches minion Ettenmoors (le-373)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterLe373 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ETTENMOORS_LE as string),
    );

    expect(starterLe373).toBeDefined();
  });

  test('starter movement from Carn Dûm does NOT reach hero Ettenmoors (tw-395)', () => {
    // The hero Ettenmoors's nearestHaven is Rivendell, not Carn Dûm.
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterTw395 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ETTENMOORS_TW as string),
    );

    expect(starterTw395).toBeUndefined();
  });

  test('starter movement from Dol Guldur does NOT reach minion Ettenmoors (le-373)', () => {
    // le-373's nearestHaven is Carn Dûm, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe373 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ETTENMOORS_LE as string),
    );

    expect(starterLe373).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion Ettenmoors (le-373)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe373 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ETTENMOORS_LE as string),
    );

    expect(starterLe373).toBeUndefined();
  });

  // ─── Movement: Ettenmoors → Carn Dûm ────────────────────────────────────────

  test('starter movement from minion Ettenmoors (le-373) reaches Carn Dûm', () => {
    const ettenmoors = pool[ETTENMOORS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, ettenmoors, allSites);
    const starterCarnDum = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CARN_DUM as string),
    );

    expect(starterCarnDum).toBeDefined();
  });

  test('starter movement from minion Ettenmoors (le-373) does NOT reach Dol Guldur', () => {
    const ettenmoors = pool[ETTENMOORS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, ettenmoors, allSites);
    const starterDolGuldur = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starterDolGuldur).toBeUndefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Carn Dûm reaches le-373 with distance 2', () => {
    // Carn Dûm is in Angmar; Ettenmoors is in Rhudaur.
    // Angmar and Rhudaur are adjacent → 1 edge → regionDistance === 2.
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (ETTENMOORS_LE as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('haven-to-haven movement from Carn Dûm does not include le-373 (not a haven)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(carnDum.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Ettenmoors')).toBe(false);
  });
});
