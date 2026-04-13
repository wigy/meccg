/**
 * @module td-178.test
 *
 * Card test: Isle of the Ulond (td-178)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Edhellond. Playable: Information, Items (minor, major).
 *  Automatic-attacks: Dragon — 1 strike with 14 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [wilderness, coastal, coastal] — matches card text         |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool                     |
 * | 4 | playableResources | OK     | [information, minor, major] — matches card text            |
 * | 5 | automaticAttacks  | OK     | Dragon, 1 strike, 14 prowess — matches card text           |
 * | 6 | resourceDraws     | OK     | 2                                                          |
 * | 7 | hazardDraws       | OK     | 2                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, major checked                |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats  |
 *
 * Playable: YES
 * Certified: 2026-04-13
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool, reduce,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  ISLE_OF_THE_ULOND, EDHELLOND, DAGGER_OF_WESTERNESSE, GLAMDRING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Isle of the Ulond (td-178)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a ruins-and-lairs with correct structural properties', () => {
    const def = pool[ISLE_OF_THE_ULOND as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('ruins-and-lairs');
    expect(def.sitePath).toEqual(['wilderness', 'coastal', 'coastal']);
    expect(def.nearestHaven).toBe('Edhellond');
    expect(def.region).toBe('Andrast Coast');
    expect(def.playableResources).toEqual(['information', 'minor', 'major']);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('nearest haven Edhellond exists in the card pool', () => {
    const edhellondDef = pool[EDHELLOND as string];
    expect(edhellondDef).toBeDefined();
    expect(isSiteCard(edhellondDef)).toBe(true);
    if (!isSiteCard(edhellondDef)) return;
    expect(edhellondDef.siteType).toBe('haven');
  });

  test('automatic attack matches card text', () => {
    const def = pool[ISLE_OF_THE_ULOND as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(1);
    expect(def.automaticAttacks[0]).toEqual({
      creatureType: 'Dragon',
      strikes: 1,
      prowess: 14,
    });
  });

  test('site path regions are valid types', () => {
    const def = pool[ISLE_OF_THE_ULOND as string];
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

  test('minor items are playable at Isle of the Ulond', () => {
    const state = buildSitePhaseState({
      site: ISLE_OF_THE_ULOND,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Isle of the Ulond', () => {
    const state = buildSitePhaseState({
      site: ISLE_OF_THE_ULOND,
      hand: [GLAMDRING],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are not playable at Isle of the Ulond', () => {
    const def = pool[ISLE_OF_THE_ULOND as string];
    if (!isSiteCard(def)) return;

    expect(def.playableResources).not.toContain('greater');
  });

  test('gold ring items are not playable at Isle of the Ulond', () => {
    const def = pool[ISLE_OF_THE_ULOND as string];
    if (!isSiteCard(def)) return;

    expect(def.playableResources).not.toContain('gold-ring');
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: ISLE_OF_THE_ULOND });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Isle of the Ulond ──────────────────────────────────────────

  test('reachable from Edhellond via starter movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Isle of the Ulond');
  });

  test('reachable from Edhellond via region movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Isle of the Ulond',
    );

    expect(regionEntry).toBeDefined();
  });

  test('not reachable from Rivendell via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const rivendell = allSites.find(s => s.name === 'Rivendell')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Isle of the Ulond');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Dragon automatic attack triggers with 1 strike and 14 prowess', () => {
    const state = buildSitePhaseState({ site: ISLE_OF_THE_ULOND });
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
    expect(result.state.combat!.strikesTotal).toBe(1);
    expect(result.state.combat!.strikeProwess).toBe(14);
    expect(result.state.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects beyond standard site properties', () => {
    const def = pool[ISLE_OF_THE_ULOND as string];
    if (!isSiteCard(def)) return;

    expect(def.text).toContain('Nearest Haven: Edhellond');
    expect(def.text).toContain('Items (minor, major)');
    expect(def.text).toContain('Dragon');
    expect(def.text).toContain('1 strike with 14 prowess');
  });
});
