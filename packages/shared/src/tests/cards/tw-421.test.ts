/**
 * @module tw-421.test
 *
 * Card test: Rivendell (tw-421)
 * Type: hero-site (haven)
 * Effects: 0
 *
 * "Site Path From Lórien: Wilderness/Border-land/Wilderness/Wilderness.
 *  Site Path From Grey Havens: Free-domain/Wilderness/Wilderness."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                          |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                                |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                                |
 * | 4 | havenPaths        | OK     | Lórien (4 regions), Grey Havens (3 regions) — both exist |
 * | 5 | path symmetry     | OK     | Reverse paths match in Lórien and Grey Havens data       |
 * | 6 | playableResources | OK     | Empty (correct for haven)                                |
 * | 7 | automaticAttacks  | OK     | Empty (correct for haven)                                |
 * | 8 | resourceDraws     | OK     | 2                                                        |
 * | 9 | hazardDraws       | OK     | 2                                                        |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 3 | Region movement         | IMPLEMENTED | 12 sites reachable within 4 regions |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-03-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, pool,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase,
  GREY_HAVENS,
  ETTENMOORS_HERO, THE_WHITE_TOWERS_HERO, BARROW_DOWNS, OLD_FOREST, BAG_END,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SitePhaseState, CardDefinitionId, SiteCard } from '../../index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Advance state to site phase with the given company already selected. */
function buildSitePhaseState(opts: {
  site: CardDefinitionId;
  siteStatus?: CardStatus;
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: opts.site, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
    phase: Phase.Site,
  });

  // Set up site phase state at play-resources step
  const company = state.players[0].companies[0];
  if (opts.siteStatus) {
    (company.currentSite as { status: CardStatus }).status = opts.siteStatus;
  }

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    declaredOnGuardAttacks: [],
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
  };
  return { ...state, phaseState: sitePhaseState };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Rivendell (tw-421)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a haven with correct structural properties', () => {
    const def = pool[RIVENDELL as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('haven');
    expect(def.sitePath).toEqual([]);
    expect(def.nearestHaven).toBe('');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('haven paths to Lórien match card text', () => {
    const def = pool[RIVENDELL as string];
    if (!isSiteCard(def)) return;

    // Card text: "Site Path From Lórien: Wilderness/Border-land/Wilderness/Wilderness"
    // havenPaths stores the path FROM Rivendell TO Lórien
    // The reverse path is on the Lórien card
    expect(def.havenPaths).toBeDefined();
    expect(def.havenPaths!['Lórien']).toEqual(['wilderness', 'border', 'wilderness', 'wilderness']);
  });

  test('haven paths to Grey Havens match card text', () => {
    const def = pool[RIVENDELL as string];
    if (!isSiteCard(def)) return;

    // Card text: "Site Path From Grey Havens: Free-domain/Wilderness/Wilderness"
    expect(def.havenPaths).toBeDefined();
    expect(def.havenPaths!['Grey Havens']).toEqual(['free', 'wilderness', 'wilderness']);
  });

  test('haven paths are symmetric with destination havens', () => {
    const rivendellDef = pool[RIVENDELL as string];
    const lorienDef = pool[LORIEN as string];
    const ghDef = pool[GREY_HAVENS as string];
    if (!isSiteCard(rivendellDef) || !isSiteCard(lorienDef) || !isSiteCard(ghDef)) return;

    // Rivendell→Lórien path reversed should equal Lórien→Rivendell path
    const rivToLor = rivendellDef.havenPaths!['Lórien'];
    const lorToRiv = lorienDef.havenPaths!['Rivendell'];
    expect(lorToRiv).toEqual([...rivToLor].reverse());

    // Rivendell→Grey Havens path reversed should equal Grey Havens→Rivendell path
    const rivToGH = rivendellDef.havenPaths!['Grey Havens'];
    const ghToRiv = ghDef.havenPaths!['Rivendell'];
    expect(ghToRiv).toEqual([...rivToGH].reverse());
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Rivendell (haven)', () => {
    const state = buildSitePhaseState({ site: RIVENDELL });
    const actions = computeLegalActions(state, PLAYER_1);

    // Only action should be pass (no items/allies/factions playable at a haven)
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('no automatic attacks at Rivendell', () => {
    const def = pool[RIVENDELL as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  test('does not connect to Edhellond directly', () => {
    const def = pool[RIVENDELL as string];
    if (!isSiteCard(def)) return;

    // Rivendell only has paths to Lórien and Grey Havens, not Edhellond
    expect(def.havenPaths!['Edhellond']).toBeUndefined();
  });

  // ─── Movement from Rivendell ────────────────────────────────────────────────

  test('starter movement reaches Lórien and Grey Havens (haven-to-haven)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterHavens = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType === 'haven')
      .map(r => r.site.name)
      .sort();

    expect(starterHavens).toEqual(['Grey Havens', 'Lórien']);
  });

  test('starter movement reaches all sites with nearestHaven Rivendell', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterSites = reachable
      .filter(r => r.movementType === 'starter' && r.site.siteType !== 'haven')
      .map(r => r.site.name)
      .sort();

    // All TW hero sites with nearestHaven "Rivendell"
    const expectedSites = [
      pool[ETTENMOORS_HERO as string],
      pool[THE_WHITE_TOWERS_HERO as string],
      pool[BARROW_DOWNS as string],
      pool[OLD_FOREST as string],
      pool[BAG_END as string],
    ].map(d => d.name).sort();

    expect(starterSites).toEqual(expectedSites);
  });

  test('starter movement does not reach Edhellond', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Edhellond');
  });

  test('region movement reaches all sites within 4 regions of Rhudaur', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionNames = [...new Set(
      reachable
        .filter(r => r.movementType === 'region')
        .map(r => r.site.name),
    )].sort();

    // Rivendell is in Rhudaur. Region movement (max 4 regions) reaches:
    // dist 1 (same region): Ettenmoors (Rhudaur)
    // dist 2 (adjacent): Barrow-downs, Old Forest (Cardolan), The White Towers, Weathertop (Arthedain)
    // dist 3: Bag End (The Shire), Grey Havens (Lindon), Moria, The Under-gates (Redhorn Gate), Eagles' Eyrie (Anduin Vales)
    // dist 4: Lórien (Wold & Foothills), Dol Guldur (Southern Mirkwood)
    expect(regionNames).toEqual([
      'Bag End',
      'Barrow-downs',
      'Dol Guldur',
      "Eagles' Eyrie",
      'Ettenmoors',
      'Grey Havens',
      'Lórien',
      'Moria',
      'Old Forest',
      'The Under-gates',
      'The White Towers',
      'Weathertop',
    ]);
  });

  test('region movement distances are correct', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);

    // Build a map of site name -> minimum region distance
    const distMap = new Map<string, number>();
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      const existing = distMap.get(r.site.name);
      if (existing === undefined || r.regionDistance! < existing) {
        distMap.set(r.site.name, r.regionDistance!);
      }
    }

    // Same region (Rhudaur)
    expect(distMap.get('Ettenmoors')).toBe(1);
    // Adjacent regions
    expect(distMap.get('Barrow-downs')).toBe(2);
    expect(distMap.get('The White Towers')).toBe(2);
    expect(distMap.get('Weathertop')).toBe(2);
    // 3 regions away
    expect(distMap.get('Moria')).toBe(3);
    expect(distMap.get('Bag End')).toBe(3);
    expect(distMap.get('Grey Havens')).toBe(3);
    // 4 regions away (max)
    expect(distMap.get('Lórien')).toBe(4);
    expect(distMap.get('Dol Guldur')).toBe(4);
  });
});
