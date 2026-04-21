/**
 * @module td-179.test
 *
 * Card test: Ovir Hollow (td-179)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Lórien. Playable: Items (minor, major).
 *  Automatic-attacks: Dragon — 1 strike with 12 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [wilderness, border, shadow] — matches {w}{b}{s}           |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                        |
 * | 4 | region            | OK     | "Grey Mountain Narrows"                                    |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                         |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 12 prowess — matches card text           |
 * | 7 | resourceDraws     | OK     | 2                                                          |
 * | 8 | hazardDraws       | OK     | 2                                                          |
 * | 9 | lairOf            | OK     | "td-3" (Bairanax) — Dragon lair                            |
 * |10 | keywords          | OK     | ["hoard"] — hoard items may be played here                 |
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
 * | 7 | Hoard keyword           | IMPLEMENTED | site.keywords $includes "hoard"     |
 * | 8 | Dragon lair suppression | IMPLEMENTED | manifestations.ts lairOf handling   |
 *
 * Playable: YES
 * Certified: 2026-04-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  resetMint, pool, reduce,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  DAGGER_OF_WESTERNESSE, GLAMDRING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const OVIR_HOLLOW = 'td-179' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ovir Hollow (td-179)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Ovir Hollow', () => {
    const state = buildSitePhaseState({
      site: OVIR_HOLLOW,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Ovir Hollow', () => {
    const state = buildSitePhaseState({
      site: OVIR_HOLLOW,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: OVIR_HOLLOW });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Ovir Hollow ────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Ovir Hollow');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Ovir Hollow',
    );

    expect(regionEntry).toBeDefined();
  });

  test('not reachable from Grey Havens via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const greyHavens = allSites.find(s => s.name === 'Grey Havens')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, greyHavens, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Ovir Hollow');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Dragon automatic attack triggers with 1 strike and 12 prowess', () => {
    const state = buildSitePhaseState({ site: OVIR_HOLLOW });
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
    expect(result.state.combat!.strikeProwess).toBe(12);
    expect(result.state.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
