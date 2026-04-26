/**
 * @module tw-416.test
 *
 * Card test: Mount Gundabad (tw-416)
 * Type: hero-site (shadow-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien Playable: Items (minor, major, greater)
 *  Automatic-attacks: Orcs — 2 strikes with 8 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                      |
 * | 2 | sitePath          | OK     | [wilderness, border, dark] — Wold & Foothills→Anduin Vales→Gundabad |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                        |
 * | 4 | playableResources | OK     | [minor, major, greater] — matches card text                |
 * | 5 | automaticAttacks  | OK     | Orcs, 2 strikes, 8 prowess — matches card text             |
 * | 6 | resourceDraws     | OK     | 2                                                          |
 * | 7 | hazardDraws       | OK     | 3                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
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
  LORIEN,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const MOUNT_GUNDABAD = 'tw-416' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Mount Gundabad (tw-416)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Mount Gundabad', () => {
    const state = buildSitePhaseState({
      site: MOUNT_GUNDABAD,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Mount Gundabad', () => {
    const state = buildSitePhaseState({
      site: MOUNT_GUNDABAD,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at Mount Gundabad', () => {
    const state = buildSitePhaseState({
      site: MOUNT_GUNDABAD,
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: MOUNT_GUNDABAD });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Mount Gundabad ─────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Mount Gundabad');
  });

  test('reachable from Lórien via region movement at distance 3', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Mount Gundabad',
    );

    expect(regionEntry).toBeDefined();
    // Wold & Foothills → Anduin Vales → Gundabad = 3 regions traversed
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('not reachable from Grey Havens via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Mount Gundabad');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 2 strikes and 8 prowess', () => {
    const state = buildSitePhaseState({ site: MOUNT_GUNDABAD });
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
