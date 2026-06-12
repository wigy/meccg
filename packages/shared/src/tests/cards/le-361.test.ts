/**
 * @module le-361.test
 *
 * Card test: Cirith Gorgor (le-361)
 * Type: minion-site (dark-hold) in Udûn
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Minas Morgul.
 *
 * The card text describes only the nearest darkhaven; there is no Playable
 * line and no Automatic-attacks line. The canonical database (LE-361) has
 * playable "" and autoAttack "", so this site offers no playable resources
 * and triggers no automatic attacks — it is a pure travel/draw site on the
 * approach to Mordor.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — matches {D}                              |
 * | 2 | sitePath          | OK     | [shadow, dark, dark] — matches {s}{d}{d}               |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven (le-390) in pool   |
 * | 4 | region            | OK     | "Udûn" — valid region in card pool                     |
 * | 5 | playableResources | OK     | [] — matches empty `playable` in canonical data        |
 * | 6 | automaticAttacks  | OK     | [] — matches empty `autoAttack` in canonical data      |
 * | 7 | resourceDraws     | OK     | 2                                                      |
 * | 8 | hazardDraws       | OK     | 1                                                      |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                            |
 * |---|---------------------|-------------|--------------------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, play-resources    |
 * | 2 | Haven path movement | IMPLEMENTED | movement-map.ts resolves Minas Morgul ↔ le-361   |
 * | 3 | Region movement     | IMPLEMENTED | Imlad Morgul → Gorgoroth → Udûn (regionDistance 3)|
 * | 4 | Card draws          | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H    |
 *
 * Playable: YES (no special effects; every data field routes through engine
 *   machinery that is already implemented. There is no Playable line, no
 *   auto-attack, and no special text rule, so nothing is deferred.)
 *
 * Certified: 2026-06-12
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const CIRITH_GORGOR = 'le-361' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

describe('Cirith Gorgor (le-361)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Minas Morgul → Cirith Gorgor ─────────────────────────────────

  test('starter movement from Minas Morgul reaches Cirith Gorgor (le-361)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_GORGOR as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Lórien does NOT reach minion Cirith Gorgor (le-361)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_GORGOR as string),
    );

    expect(starter).toBeUndefined();
  });

  // ─── Movement: Cirith Gorgor → Minas Morgul ─────────────────────────────────

  test('starter movement from Cirith Gorgor (le-361) reaches Minas Morgul', () => {
    const cirithGorgor = pool[CIRITH_GORGOR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, cirithGorgor, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Region movement ─────────────────────────────────────────────────────────

  test('region movement from Minas Morgul reaches le-361 at regionDistance 3', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (CIRITH_GORGOR as string),
    );

    // Imlad Morgul (Minas Morgul) → Gorgoroth → Udûn (Cirith Gorgor).
    // regionDistance counts all regions traversed including both endpoints.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('haven-to-haven movement from Minas Morgul does not include le-361 (not a haven)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(minasMorgul.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Cirith Gorgor')).toBe(false);
  });
});
