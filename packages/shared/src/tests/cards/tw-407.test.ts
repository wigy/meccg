/**
 * @module tw-407.test
 *
 * Card test: Lond Galen (tw-407)
 * Type: hero-site (border-hold)
 * Effects: 0
 *
 * No special text. No automatic attacks. No playable resources.
 * "Nearest Haven: Edhellond."
 * Site Path: Wilderness
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                               |
 * | 2 | sitePath          | OK     | [wilderness] — matches card text                    |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool              |
 * | 4 | playableResources | OK     | Empty — no playable resources                       |
 * | 5 | automaticAttacks  | OK     | Empty — no automatic attacks                        |
 * | 6 | resourceDraws     | OK     | 1                                                   |
 * | 7 | hazardDraws       | OK     | 1                                                   |
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
  resetMint, pool,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  LOND_GALEN, EDHELLOND,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

describe('Lond Galen (tw-407)', () => {
  beforeEach(() => resetMint());

  test('is a border-hold with correct structural properties', () => {
    const def = pool[LOND_GALEN as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('border-hold');
    expect(def.sitePath).toEqual(['wilderness']);
    expect(def.nearestHaven).toBe('Edhellond');
    expect(def.region).toBe('Anfalas');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(1);
    expect(def.hazardDraws).toBe(1);
  });

  test('nearest haven Edhellond exists in the card pool', () => {
    const edhellondDef = pool[EDHELLOND as string];
    expect(edhellondDef).toBeDefined();
    expect(isSiteCard(edhellondDef)).toBe(true);
    if (!isSiteCard(edhellondDef)) return;
    expect(edhellondDef.siteType).toBe('haven');
  });

  test('site path regions are valid types', () => {
    const def = pool[LOND_GALEN as string];
    if (!isSiteCard(def)) return;

    const validTypes = new Set([
      'wilderness', 'border', 'free', 'coastal', 'shadow',
      'dark', 'double-wilderness', 'double-shadow-land', 'double-coastal-sea',
    ]);
    for (const region of def.sitePath) {
      expect(validTypes.has(region)).toBe(true);
    }
  });

  test('no resources playable at Lond Galen', () => {
    const state = buildSitePhaseState({ site: LOND_GALEN });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('no automatic attacks', () => {
    const def = pool[LOND_GALEN as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  test('reachable from Edhellond via starter movement', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Lond Galen');
  });

  test('has no special effects', () => {
    const def = pool[LOND_GALEN as string];
    if (!isSiteCard(def)) return;

    expect(def.effects).toEqual([]);
    expect(def.text).toBe('Nearest Haven: Edhellond.');
  });
});
