/**
 * @module tw-395.test
 *
 * Card test: Ettenmoors (tw-395)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell. Playable: Items (minor).
 *  Automatic-attacks: Troll — 1 strike with 9 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | ["wilderness"] — matches card text                 |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool             |
 * | 4 | playableResources | OK     | ["minor"] — matches card text                      |
 * | 5 | automaticAttacks  | OK     | Trolls, 1 strike, 9 prowess — matches card text    |
 * | 6 | resourceDraws     | OK     | 1                                                  |
 * | 7 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor items checked                 |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RIVENDELL,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  ETTENMOORS_HERO, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ettenmoors (tw-395)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Ettenmoors', () => {
    const state = buildSitePhaseState({
      site: ETTENMOORS_HERO,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: ETTENMOORS_HERO });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Ettenmoors ────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Ettenmoors');
  });

  test('reachable from Rivendell via region movement at distance 1 (same region)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Ettenmoors',
    );

    expect(regionEntry).toBeDefined();
    // Ettenmoors is in Rhudaur — same region as Rivendell
    expect(regionEntry!.regionDistance).toBe(1);
  });

  test('not reachable from Grey Havens via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Ettenmoors');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Troll automatic attack triggers with 1 strike and 9 prowess', () => {
    const state = buildSitePhaseState({ site: ETTENMOORS_HERO });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(9);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
