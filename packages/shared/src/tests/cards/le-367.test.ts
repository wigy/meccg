/**
 * @module le-367.test
 *
 * Card test: Dol Guldur (le-367)
 * Type: minion-site (haven)
 * Effects: 2 (site-rule auto-test-gold-ring rollModifier:-2;
 *             site-rule cancel-attacks)
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
 * | # | Feature                         | Status      | Notes                                                 |
 * |---|---------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Minas Morgul/Carn Dûm    |
 * |   |                                 |             | links symmetrically                                   |
 * | 3 | Region movement                 | IMPLEMENTED | Sites reachable within 4 regions of Southern Mirkwood |
 * | 4 | Card draws                      | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase  |
 * | 5 | Gold ring auto-test on store    | IMPLEMENTED | site-rule auto-test-gold-ring fires a gold-ring-test  |
 * |   |                                 |             | pending resolution after corruption check; gold-ring  |
 * |   |                                 |             | is discarded regardless of roll (Rule 9.21/9.22)      |
 * | 6 | Cancel attacks at this site     | IMPLEMENTED | site-rule cancel-attacks marks creature hazard plays  |
 * |   |                                 |             | non-viable when the target company's effective site   |
 * |   |                                 |             | is Dol Guldur                                         |
 *
 * Certified: 2026-04-20
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, MORIA,
  resetMint, pool,
  buildSitePhaseState, buildTestState, dispatch,
  viableFor, viableActions, makeMHState,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, computeLegalActions, Phase,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, StoreItemAction, GameState } from '../../index.js';

const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const LIEUTENANT_OF_DOL_GULDUR = 'le-21' as CardDefinitionId;
const THE_LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;
const ORC_PATROL = 'tw-074' as CardDefinitionId;

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

  // ─── Site-rule declarations ─────────────────────────────────────────────────

  test('card definition declares the auto-test-gold-ring and cancel-attacks site rules', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    expect(dolGuldur.effects).toBeDefined();

    const autoTest = dolGuldur.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'auto-test-gold-ring'; rollModifier: number } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'auto-test-gold-ring',
    );
    expect(autoTest).toBeDefined();
    expect(autoTest!.rollModifier).toBe(-2);

    const cancelAttacks = dolGuldur.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'cancel-attacks' } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'cancel-attacks',
    );
    expect(cancelAttacks).toBeDefined();
  });

  // ─── Cancel-attacks engine behavior ─────────────────────────────────────────

  test('hazard creature (Orc-patrol) is non-viable against a minion company at Dol Guldur', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [LIEUTENANT_OF_DOL_GULDUR] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(mhState, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/canceled at Dol Guldur/);
  });

  test('cancel-attacks reason is NOT cited when the target company is at a non-cancel-attacks site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const plays = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard');
    // Whatever the viability, no action should be blocked with the
    // cancel-attacks reason (Moria has no such rule).
    for (const ea of plays) {
      expect(ea.reason ?? '').not.toMatch(/canceled at/);
    }
  });

  // ─── Auto-test-gold-ring engine behavior ────────────────────────────────────

  test('The Least of Gold Rings is storable at Dol Guldur', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: DOL_GULDUR,
            characters: [{ defId: LIEUTENANT_OF_DOL_GULDUR, items: [THE_LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const stores = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction);
    expect(stores).toHaveLength(1);
    expect(stores[0].player).toBe(PLAYER_1);
  });

  test('storing a gold ring at Dol Guldur enqueues a gold-ring-test with rollModifier -2', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: DOL_GULDUR,
            characters: [{ defId: LIEUTENANT_OF_DOL_GULDUR, items: [THE_LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const store = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item')
      .map(ea => ea.action as StoreItemAction)[0];
    const afterStore = dispatch(state, store);

    // Gold ring moved to out-of-play pile (stored)
    expect(afterStore.players[0].outOfPlayPile).toHaveLength(1);
    expect(afterStore.players[0].outOfPlayPile[0].definitionId).toBe(THE_LEAST_OF_GOLD_RINGS);

    // Corruption check AND gold-ring-test both pending
    const ringTest = afterStore.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeDefined();
    const kind = ringTest!.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    expect(kind.rollModifier).toBe(-2);
    expect(kind.goldRingInstanceId).toBe(store.itemInstanceId);
  });
});
