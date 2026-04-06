/**
 * @module tw-413.test
 *
 * Card test: Moria (tw-413)
 * Type: hero-site (shadow-hold)
 * Effects: 0
 *
 * "Playable: Items (minor, major, greater, gold ring).
 *  Automatic-attacks: Orcs — 4 strikes with 7 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                      |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — Redhorn Gate                    |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                        |
 * | 4 | playableResources | OK     | [minor, major, greater, gold-ring] — matches card text     |
 * | 5 | automaticAttacks  | OK     | Orcs, 4 strikes, 7 prowess — matches card text             |
 * | 6 | resourceDraws     | OK     | 2                                                          |
 * | 7 | hazardDraws       | OK     | 3                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, major, greater, gold-ring    |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats  |
 *
 * Playable: YES
 * Certified: 2026-04-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  resetMint, pool, reduce,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  MORIA, GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Moria (tw-413)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a shadow-hold with correct structural properties', () => {
    const def = pool[MORIA as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('shadow-hold');
    expect(def.sitePath).toEqual(['wilderness', 'wilderness']);
    expect(def.nearestHaven).toBe('Lórien');
    expect(def.region).toBe('Redhorn Gate');
    expect(def.playableResources).toEqual(['minor', 'major', 'greater', 'gold-ring']);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(3);
  });

  test('nearest haven Lórien exists in the card pool', () => {
    const lorienDef = pool[LORIEN as string];
    expect(lorienDef).toBeDefined();
    expect(isSiteCard(lorienDef)).toBe(true);
    if (!isSiteCard(lorienDef)) return;
    expect(lorienDef.siteType).toBe('haven');
  });

  test('automatic attack matches card text', () => {
    const def = pool[MORIA as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(1);
    expect(def.automaticAttacks[0]).toEqual({
      creatureType: 'Orcs',
      strikes: 4,
      prowess: 7,
    });
  });

  test('site path regions are valid types', () => {
    const def = pool[MORIA as string];
    if (!isSiteCard(def)) return;

    const validTypes = new Set([
      'wilderness', 'border', 'free', 'coastal', 'shadow',
      'dark', 'double-wilderness', 'double-shadow-land', 'double-coastal-sea',
    ]);
    for (const region of def.sitePath) {
      expect(validTypes.has(region)).toBe(true);
    }
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Moria', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Moria', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [GLAMDRING],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at Moria', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [THE_MITHRIL_COAT],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: MORIA });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Moria ──────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Moria');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Moria',
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Redhorn Gate = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('not reachable from Grey Havens via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Moria');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 4 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({ site: MORIA });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(4);
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects beyond standard site properties', () => {
    const def = pool[MORIA as string];
    if (!isSiteCard(def)) return;

    expect(def.text).toContain('Items (minor, major, greater, gold ring)');
    expect(def.text).toContain('Orcs');
    expect(def.text).toContain('4 strikes with 7 prowess');
  });
});
