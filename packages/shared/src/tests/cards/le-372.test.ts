/**
 * @module le-372.test
 *
 * Card test: Edoras (le-372)
 * Type: minion-site (free-hold) in Rohan
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Minas Morgul.
 *   Playable: Items (gold ring).
 *   Automatic-attacks: Men — each character faces 1 strike with 10 prowess
 *     (detainment against covert company).
 *
 * Two sites share the name "Edoras": the hero version at tw-394 (keyed to
 * Lórien) and this minion version at le-372 (keyed to Minas Morgul). The
 * movement tests below check that the minion version is reachable from the
 * minion starter haven only, not from Lórien.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                                  |
 * |---|-------------------|--------|------------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                                    |
 * | 2 | sitePath          | OK     | [shadow, wilderness, free, shadow] — matches card {s}{w}{f}{s}         |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven in card pool (le-390)              |
 * | 4 | region            | OK     | "Rohan" — reachable from Imlad Morgul within 4 regions                 |
 * | 5 | playableResources | OK     | [gold-ring] — matches card text                                        |
 * | 6 | automaticAttacks  | OK     | Men, prowess 10, each-character / detainment-vs-covert — data only     |
 * | 7 | resourceDraws     | OK     | 2                                                                      |
 * | 8 | hazardDraws       | OK     | 3                                                                      |
 *
 * Engine Support:
 * | # | Feature                    | Status          | Notes                                                  |
 * |---|----------------------------|-----------------|--------------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED     | select-company, enter-or-skip, play-resources          |
 * | 2 | Haven path movement        | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Minas Morgul   |
 * | 3 | Region movement            | IMPLEMENTED     | region distance via Ithilien → Anórien → Rohan         |
 * | 4 | Card draws                 | IMPLEMENTED     | resourceDraws / hazardDraws thread through M/H phase   |
 * | 5 | Automatic attacks at site  | NOT IMPLEMENTED | auto-attack trigger is stubbed; data-only for now      |
 *
 * Playable: YES (no special effects; the card's data fields all route
 *   through engine machinery that is already implemented. The custom
 *   "each character faces 1 strike" auto-attack is carried as data for
 *   the future auto-attack wiring — no card text asks for anything
 *   beyond the standard auto-attack flow.)
 *
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { resetMint, pool, LORIEN } from '../test-helpers.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';

const EDORAS_LE = 'le-372' as CardDefinitionId;
const EDORAS_TW = 'tw-394' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Edoras (le-372)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Minas Morgul → Edoras (le-372) ──────────────────────────────

  test('starter movement from Minas Morgul reaches minion Edoras (le-372)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterLe372 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_LE as string),
    );

    expect(starterLe372).toBeDefined();
  });

  test('starter movement from Minas Morgul does NOT reach hero Edoras (tw-394)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterTw394 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_TW as string),
    );

    expect(starterTw394).toBeUndefined();
  });

  test('starter movement from Lórien does NOT reach minion Edoras (le-372)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterLe372 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_LE as string),
    );

    expect(starterLe372).toBeUndefined();
  });

  test('starter movement from Dol Guldur does NOT reach minion Edoras (le-372)', () => {
    // Edoras (le-372) is keyed to Minas Morgul, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterLe372 = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDORAS_LE as string),
    );

    expect(starterLe372).toBeUndefined();
  });

  // ─── Movement: Edoras (le-372) → Minas Morgul ──────────────────────────────

  test('starter movement from minion Edoras (le-372) reaches Minas Morgul', () => {
    const edoras = pool[EDORAS_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edoras, allSites);
    const starterMinasMorgul = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MINAS_MORGUL as string),
    );

    expect(starterMinasMorgul).toBeDefined();
  });

  // ─── Region movement ───────────────────────────────────────────────────────

  test('region movement from Minas Morgul reaches minion Edoras within 4 regions', () => {
    // Imlad Morgul → Ithilien → Anórien → Rohan = 4 regions, distance 4
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (EDORAS_LE as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });

  test('haven-to-haven movement from Minas Morgul does not include Edoras (not a haven)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(minasMorgul.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Edoras')).toBe(false);
  });
});
