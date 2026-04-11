/**
 * @module tw-400.test
 *
 * Card test: Henneth Annûn (tw-400)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * No card text — standard site with no special rules.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                                   |
 * | 2 | sitePath          | OK     | [wilderness, border, free, wilderness] — 4 regions      |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                     |
 * | 4 | playableResources | OK     | [] — no resources playable (matches empty text)         |
 * | 5 | automaticAttacks  | OK     | [] — no automatic attacks (matches empty text)          |
 * | 6 | resourceDraws     | OK     | 2                                                       |
 * | 7 | hazardDraws       | OK     | 2                                                       |
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
 * Certified: 2026-04-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  resetMint, pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  HENNETH_ANNUN, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Henneth Annûn (tw-400)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a border-hold with correct structural properties', () => {
    const def = pool[HENNETH_ANNUN as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('border-hold');
    expect(def.sitePath).toEqual(['wilderness', 'border', 'free', 'wilderness']);
    expect(def.nearestHaven).toBe('Lórien');
    expect(def.region).toBe('Ithilien');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('nearest haven Lórien exists in the card pool', () => {
    const lorienDef = pool[LORIEN as string];
    expect(lorienDef).toBeDefined();
    expect(isSiteCard(lorienDef)).toBe(true);
    if (!isSiteCard(lorienDef)) return;
    expect(lorienDef.siteType).toBe('haven');
  });

  test('site path regions are valid types', () => {
    const def = pool[HENNETH_ANNUN as string];
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

  test('no resources playable at Henneth Annûn', () => {
    const state = buildSitePhaseState({ site: HENNETH_ANNUN });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    // No playable resources — only pass should be available
    const playActions = viable.filter(a => a.action.type === 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('minor items are not playable (no playableResources)', () => {
    const state = buildSitePhaseState({
      site: HENNETH_ANNUN,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = computeLegalActions(state, PLAYER_1);

    const playActions = actions.filter(
      a => a.viable && a.action.type === 'play-hero-resource',
    );
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: HENNETH_ANNUN });
    const actions = computeLegalActions(state, PLAYER_1);

    const passActions = actions.filter(a => a.viable && a.action.type === 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Henneth Annûn ──────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Henneth Annûn');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Henneth Annûn',
    );

    expect(regionEntry).toBeDefined();
  });

  test('not reachable from Grey Havens via starter movement', () => {
    // Henneth Annûn's nearest haven is Lórien, not Grey Havens
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Henneth Annûn');
  });

  // ─── No special effects ───────────────────────────────────────────────────

  test('has no special effects (empty text)', () => {
    const def = pool[HENNETH_ANNUN as string];
    if (!isSiteCard(def)) return;

    expect(def.text).toBe('');
    expect((def as unknown as Record<string, unknown>).effects).toBeUndefined();
  });
});
