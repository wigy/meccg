/**
 * @module tw-380.test
 *
 * Card test: Carn Dûm (tw-380)
 * Type: hero-site (dark-hold)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell
 *  Playable: Items (minor, major, greater)
 *  Automatic-attacks: Orcs — 4 strikes with 7 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                |
 * | 2 | sitePath          | OK     | [wilderness, shadow] — Angmar via Rhudaur          |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool             |
 * | 4 | playableResources | OK     | [minor, major, greater] — matches card text        |
 * | 5 | automaticAttacks  | OK     | Orcs, 4 strikes, 7 prowess — matches card text     |
 * | 6 | resourceDraws     | OK     | 2                                                  |
 * | 7 | hazardDraws       | OK     | 3                                                  |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, major, greater               |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats  |
 *
 * Playable: YES
 * Certified: 2026-04-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RIVENDELL, LORIEN,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const CARN_DUM_HERO = 'tw-380' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Carn Dûm (tw-380)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Carn Dûm', () => {
    const state = buildSitePhaseState({
      site: CARN_DUM_HERO,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Carn Dûm', () => {
    const state = buildSitePhaseState({
      site: CARN_DUM_HERO,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at Carn Dûm', () => {
    const state = buildSitePhaseState({
      site: CARN_DUM_HERO,
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: CARN_DUM_HERO });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Carn Dûm ──────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Carn Dûm');
  });

  test('not reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Carn Dûm');
  });

  test('reachable from Rivendell via region movement at distance 2', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Carn Dûm',
    );

    expect(entry).toBeDefined();
    // Rhudaur → Angmar = 2 regions traversed
    expect(entry!.regionDistance).toBe(2);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 4 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({ site: CARN_DUM_HERO });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(4);
    expect(nextState.combat!.strikeProwess).toBe(7);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
