/**
 * @module tw-422.test
 *
 * Card test: Ruined Signal Tower (tw-422)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Spiders — 2 strikes with 8 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                |
 * | 2 | sitePath          | OK     | [wilderness, wilderness, wilderness] — matches card text |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool                   |
 * | 4 | playableResources | OK     | [minor, major] — matches card text                       |
 * | 5 | automaticAttacks  | OK     | Spiders, 2 strikes, 8 prowess — matches card text        |
 * | 6 | resourceDraws     | OK     | 2                                                        |
 * | 7 | hazardDraws       | OK     | 2                                                        |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, major                        |
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
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const RUINED_SIGNAL_TOWER = 'tw-422' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ruined Signal Tower (tw-422)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Ruined Signal Tower', () => {
    const state = buildSitePhaseState({
      site: RUINED_SIGNAL_TOWER,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Ruined Signal Tower', () => {
    const state = buildSitePhaseState({
      site: RUINED_SIGNAL_TOWER,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: RUINED_SIGNAL_TOWER });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Ruined Signal Tower ───────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Ruined Signal Tower');
  });

  test('starter movement from Ruined Signal Tower reaches Rivendell', () => {
    const tower = pool[RUINED_SIGNAL_TOWER as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, tower, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Rivendell');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Spiders automatic attack triggers with 2 strikes and 8 prowess', () => {
    const state = buildSitePhaseState({ site: RUINED_SIGNAL_TOWER });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
