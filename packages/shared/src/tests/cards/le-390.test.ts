/**
 * @module le-390.test
 *
 * Card test: Minas Morgul (le-390)
 * Type: minion-site (haven)
 * Effects: 2 (site-rule auto-test-gold-ring rollModifier:-2;
 *             site-rule cancel-attacks)
 *
 * "Site Path From Dol Guldur: {d}{s}{d}{d}{s}
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
 * | 4 | havenPaths        | OK     | Dol Guldur (5 regions) — destination haven exists                 |
 * | 5 | path symmetry     | OK     | Reverse of Dol Guldur's "Minas Morgul" path matches this entry    |
 * | 6 | region            | OK     | "Imlad Morgul" — valid region in card pool                        |
 * | 7 | playableResources | OK     | Empty (correct for haven)                                         |
 * | 8 | automaticAttacks  | OK     | Empty (correct for haven)                                         |
 * | 9 | resourceDraws     | OK     | 2                                                                 |
 * |10 | hazardDraws       | OK     | 2                                                                 |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                 |
 * |---|---------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves the Dol Guldur link          |
 * |   |                                 |             | symmetrically                                         |
 * | 3 | Region movement                 | IMPLEMENTED | Sites reachable within 4 regions of Imlad Morgul      |
 * | 4 | Card draws                      | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase  |
 * | 5 | Gold ring auto-test on store    | IMPLEMENTED | site-rule auto-test-gold-ring fires a gold-ring-test  |
 * |   |                                 |             | pending resolution after corruption check; gold-ring  |
 * |   |                                 |             | is discarded regardless of roll (Rule 9.21/9.22)      |
 * | 6 | Cancel attacks at this site     | IMPLEMENTED | site-rule cancel-attacks marks creature hazard plays  |
 * |   |                                 |             | non-viable when the target company's effective site   |
 * |   |                                 |             | is Minas Morgul                                       |
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
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const THE_LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;
const ORC_PATROL = 'tw-074' as CardDefinitionId;

describe('Minas Morgul (le-390)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Minas Morgul (haven)', () => {
    const state = buildSitePhaseState({ site: MINAS_MORGUL });
    const viable = viableFor(state, PLAYER_1);

    // Havens list no playableResources and carry no site-rule effects that
    // grant playability, so the only legal action should be `pass`.
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Haven-to-haven starter movement ────────────────────────────────────────

  test('starter movement reaches Dol Guldur (haven-to-haven)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name)
      .sort();

    expect(starterHavens).toEqual(['Dol Guldur']);
  });

  test('starter movement does NOT reach hero havens', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    // Hero havens are not listed in Minas Morgul's havenPaths
    expect(starterNames).not.toContain('Rivendell');
    expect(starterNames).not.toContain('Lórien');
    expect(starterNames).not.toContain('Grey Havens');
    expect(starterNames).not.toContain('Edhellond');
  });

  // ─── Haven-to-site starter movement ─────────────────────────────────────────

  test('starter movement reaches all sites with nearestHaven Minas Morgul', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterSites = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType !== 'haven')
      .map(r => r.site.name)
      .sort();

    const expectedSites = allSites
      .filter(s => s.siteType !== 'haven' && s.nearestHaven === 'Minas Morgul')
      .map(s => s.name)
      .sort();

    expect(starterSites).toEqual(expectedSites);
    // Verify a few known keyed sites make it through
    expect(starterSites).toContain('Barad-dûr');
    expect(starterSites).toContain('Cirith Ungol');
    expect(starterSites).toContain('Mount Doom');
  });

  test('starter movement does not reach sites keyed to Dol Guldur', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    // Sites whose nearestHaven is Dol Guldur, not Minas Morgul
    expect(starterNames).not.toContain("Beorn's House");
    expect(starterNames).not.toContain("Thranduil's Halls");
  });

  // ─── Reverse starter movement (Dol Guldur → Minas Morgul) ───────────────────

  test('Dol Guldur has starter movement to Minas Morgul', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name);

    expect(starterHavens).toContain('Minas Morgul');
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Minas Morgul stays within 4 regions of Imlad Morgul', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);

    // Collapse to min region distance per site name
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // Any site reached by region movement must respect the 4-region cap
    for (const [, dist] of distMap) {
      expect(dist).toBeLessThanOrEqual(4);
    }
    // Sanity: some Gorgoroth/Udun-adjacent sites should be reachable by region
    expect(distMap.size).toBeGreaterThan(0);
  });

  test('region movement does not include sites beyond 4 regions', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const regionNames = new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    );

    // Grey Havens (Lindon) is far from Imlad Morgul — beyond 4 regions
    expect(regionNames.has('Grey Havens')).toBe(false);
    // Carn Dûm (Angmar) is also far
    expect(regionNames.has('Carn Dûm')).toBe(false);
  });

  // ─── Path symmetry with Dol Guldur ──────────────────────────────────────────

  test('Minas Morgul ↔ Dol Guldur haven paths are symmetric reverses', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;

    // By convention the key stores the path *from* the other haven *to* this one.
    const mmFromDg = minasMorgul.havenPaths?.['Dol Guldur'];
    const dgFromMm = dolGuldur.havenPaths?.['Minas Morgul'];

    expect(mmFromDg).toBeDefined();
    expect(dgFromMm).toBeDefined();

    // Reverse of the "from Dol Guldur to Minas Morgul" path must equal the
    // "from Minas Morgul to Dol Guldur" path stored on Dol Guldur.
    expect([...mmFromDg!].reverse()).toEqual(dgFromMm);
  });

  // ─── Site-rule declarations ─────────────────────────────────────────────────

  test('card definition declares the auto-test-gold-ring and cancel-attacks site rules', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    expect(minasMorgul.effects).toBeDefined();

    const autoTest = minasMorgul.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'auto-test-gold-ring'; rollModifier: number } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'auto-test-gold-ring',
    );
    expect(autoTest).toBeDefined();
    expect(autoTest!.rollModifier).toBe(-2);

    const cancelAttacks = minasMorgul.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'cancel-attacks' } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'cancel-attacks',
    );
    expect(cancelAttacks).toBeDefined();
  });

  // ─── Cancel-attacks engine behavior ─────────────────────────────────────────

  test('hazard creature (Orc-patrol) is non-viable against a minion company at Minas Morgul', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }],
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
    expect(all[0].reason).toMatch(/canceled at Minas Morgul/);
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

  test('The Least of Gold Rings is storable at Minas Morgul', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [{ defId: LIEUTENANT_OF_MORGUL, items: [THE_LEAST_OF_GOLD_RINGS] }],
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

  test('storing a gold ring at Minas Morgul enqueues a gold-ring-test with rollModifier -2', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MINAS_MORGUL,
            characters: [{ defId: LIEUTENANT_OF_MORGUL, items: [THE_LEAST_OF_GOLD_RINGS] }],
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
