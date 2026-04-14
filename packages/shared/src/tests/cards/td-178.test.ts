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
  EDHELLOND, DAGGER_OF_WESTERNESSE, GLAMDRING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const ISLE_OF_THE_ULOND = 'td-178' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Isle of the Ulond (td-178)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


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

});
