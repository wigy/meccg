/**
 * @module tw-419.test
 *
 * Card test: Pelargir (tw-419)
 * Type: hero-site (free-hold)
 * Effects: 0
 *
 * No special rules — standard site with text "Nearest Haven: Edhellond."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                |
 * | 2 | sitePath          | OK     | [wilderness, border, free] — 3 regions             |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool             |
 * | 4 | playableResources | OK     | [] — no resources playable                         |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks                          |
 * | 6 | resourceDraws     | OK     | 2                                                  |
 * | 7 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 3 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-04-13
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  EDHELLOND,
  resetMint, pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  PELARGIR, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Pelargir (tw-419)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a free-hold with correct structural properties', () => {
    const def = pool[PELARGIR as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('free-hold');
    expect(def.sitePath).toEqual(['wilderness', 'border', 'free']);
    expect(def.nearestHaven).toBe('Edhellond');
    expect(def.region).toBe('Lebennin');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
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

  test('site path regions are valid types', () => {
    const def = pool[PELARGIR as string];
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

  test('no resources playable at Pelargir', () => {
    const state = buildSitePhaseState({ site: PELARGIR });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('minor items are not playable (no playableResources)', () => {
    const state = buildSitePhaseState({
      site: PELARGIR,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const playActions = actions.filter(
      a => a.viable && a.action.type === 'play-hero-resource',
    );
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: PELARGIR });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Pelargir ──────────────────────────────────────────────────

  test('reachable from Edhellond via starter movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Pelargir');
  });

  test('starter movement from Pelargir reaches Edhellond (back to nearest haven)', () => {
    const pelargir = pool[PELARGIR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, pelargir, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Edhellond');
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects', () => {
    const def = pool[PELARGIR as string];
    if (!isSiteCard(def)) return;

    expect(def.effects).toEqual([]);
  });
});
