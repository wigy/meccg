/**
 * @module le-367.test
 *
 * Card test: Dol Guldur (le-367)
 * Type: minion-site (haven)
 * Effects: 0 (two text-based special rules are not captured in DSL — see
 *   "Unimplemented special rules" below)
 *
 * "Site Path From Minas Morgul: {s}{d}{d}{s}{d}
 *  Site Path From Carn Dûm: {s}{d}{b}{d}
 *  Special: Any gold ring stored at this site is automatically tested
 *  (modify the roll by -2). Any attack against a minion company at this
 *  site is canceled."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                                   |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                                         |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                                         |
 * | 4 | havenPaths        | OK     | Minas Morgul (5 regions), Carn Dûm (4 regions) — both exist       |
 * | 5 | path symmetry     | OK     | Reverse path matches Minas Morgul's havenPaths entry (Carn Dûm    |
 * |   |                   |        | has a data-side inconsistency tracked separately with le-359)     |
 * | 6 | region            | OK     | "Southern Mirkwood" — valid region in card pool                   |
 * | 7 | playableResources | OK     | Empty (correct for haven)                                         |
 * | 8 | automaticAttacks  | OK     | Empty (correct for haven)                                         |
 * | 9 | resourceDraws     | OK     | 2                                                                 |
 * |10 | hazardDraws       | OK     | 2                                                                 |
 *
 * Engine Support:
 * | # | Feature                         | Status           | Notes                                                |
 * |---|---------------------------------|------------------|------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED      | select-company, enter-or-skip, play-resources        |
 * | 2 | Haven path movement             | IMPLEMENTED      | movement-map.ts resolves the Minas Morgul/Carn Dûm   |
 * |   |                                 |                  | links symmetrically                                  |
 * | 3 | Region movement                 | IMPLEMENTED      | Sites reachable within 4 regions of Southern Mirkwood|
 * | 4 | Card draws                      | IMPLEMENTED      | resourceDraws / hazardDraws thread through M/H phase |
 * | 5 | Gold ring auto-test on store    | NOT IMPLEMENTED  | Gold-ring items carry no `storable-at` effect yet,   |
 * |   |                                 |                  | so the "stored at site" trigger never fires; when    |
 * |   |                                 |                  | added, this site must auto-test with -2              |
 * | 6 | Cancel attacks at this site     | NOT IMPLEMENTED  | No DSL captures "cancel any attack against a minion  |
 * |   |                                 |                  | company at site X" — automatic attacks at havens are |
 * |   |                                 |                  | already absent by data, but hazard creatures played  |
 * |   |                                 |                  | against a resting minion company are not auto-canceled|
 *
 * Playable: PARTIALLY — the haven's movement / site-phase / draw machinery is
 *   fully wired. The two special-text rules are dormant until the engine
 *   gains gold-ring storage and a cancel-attacks-at-site mechanic. Neither
 *   rule is triggerable by any currently implemented action, so in practice
 *   the card behaves correctly today; marking PARTIALLY reflects that the
 *   text-level promises are not yet enforced by effects.
 *
 * Not certified (unimplemented special rules).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  viableFor,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Dol Guldur (le-367)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Dol Guldur (haven)', () => {
    const state = buildSitePhaseState({ site: DOL_GULDUR });
    const viable = viableFor(state, PLAYER_1);

    // Havens list no playableResources and carry no site-rule effects, so
    // the only legal action should be `pass`.
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Haven-to-haven starter movement ────────────────────────────────────────

  test('starter movement reaches Minas Morgul and Carn Dûm (haven-to-haven)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name)
      .sort();

    expect(starterHavens).toEqual(['Carn Dûm', 'Minas Morgul']);
  });

  test('starter movement does NOT reach hero havens', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    // Hero havens are not listed in Dol Guldur's havenPaths
    expect(starterNames).not.toContain('Rivendell');
    expect(starterNames).not.toContain('Lórien');
    expect(starterNames).not.toContain('Grey Havens');
    expect(starterNames).not.toContain('Edhellond');
  });

  // ─── Haven-to-site starter movement ─────────────────────────────────────────

  test('starter movement reaches all sites with nearestHaven Dol Guldur', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterSites = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType !== 'haven')
      .map(r => r.site.name)
      .sort();

    const expectedSites = allSites
      .filter(s => s.siteType !== 'haven' && s.nearestHaven === 'Dol Guldur')
      .map(s => s.name)
      .sort();

    expect(starterSites).toEqual(expectedSites);
    // Verify a few known keyed sites make it through
    expect(starterSites).toContain("Beorn's House");
    expect(starterSites).toContain("Thranduil's Halls");
    expect(starterSites).toContain('Moria');
    expect(starterSites).toContain('The Lonely Mountain');
  });

  test('starter movement does not reach sites keyed to Minas Morgul', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    // Sites whose nearestHaven is Minas Morgul, not Dol Guldur
    expect(starterNames).not.toContain('Barad-dûr');
    expect(starterNames).not.toContain('Edoras');
  });

  // ─── Reverse starter movement (keyed site → Dol Guldur) ─────────────────────

  test('Minas Morgul has starter movement to Dol Guldur', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name);

    expect(starterHavens).toContain('Dol Guldur');
  });

  test('Carn Dûm has starter movement to Dol Guldur', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name);

    expect(starterHavens).toContain('Dol Guldur');
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur stays within 4 regions of Southern Mirkwood', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);

    // Collapse to min region distance per site name
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // Southern Mirkwood neighbors (adjacent regions → distance 2)
    expect(distMap.get("Beorn's House")).toBe(2);       // Anduin Vales
    expect(distMap.get('Bandit Lair')).toBe(2);          // Brown Lands
    // Two-hop regions → distance 3
    expect(distMap.get("Thranduil's Halls")).toBe(3);    // Woodland Realm via Heart of Mirkwood
    // Southern Mirkwood ↔ Heart of Mirkwood are adjacent → distance 2
    // Any farther site must respect the 4-region cap
    for (const [, dist] of distMap) {
      expect(dist).toBeLessThanOrEqual(4);
    }
  });

  test('region movement does not include sites beyond 4 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionNames = new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    );

    // Grey Havens (Lindon) is far from Southern Mirkwood — beyond 4 regions
    expect(regionNames.has('Grey Havens')).toBe(false);
    // Edhellond (Anfalas) is also far
    expect(regionNames.has('Edhellond')).toBe(false);
  });

  // ─── Path symmetry with Minas Morgul ────────────────────────────────────────

  test('Dol Guldur ↔ Minas Morgul haven paths are symmetric reverses', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;

    // By convention the key stores the path *from* the other haven *to* this one.
    const dgFromMm = dolGuldur.havenPaths?.['Minas Morgul'];
    const mmFromDg = minasMorgul.havenPaths?.['Dol Guldur'];

    expect(dgFromMm).toBeDefined();
    expect(mmFromDg).toBeDefined();

    // Reverse of the "from Minas Morgul to Dol Guldur" path must equal the
    // "from Dol Guldur to Minas Morgul" path stored on Minas Morgul.
    expect([...dgFromMm!].reverse()).toEqual(mmFromDg);
  });
});
