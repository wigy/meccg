/**
 * @module tw-430.test
 *
 * Card test: The White Towers (tw-430)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell
 *  Automatic-attacks: Wolves — 2 strikes with 6 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches {w}{w}          |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool             |
 * | 4 | region            | OK     | "Arthedain"                                        |
 * | 5 | playableResources | OK     | [] — no playable resources                         |
 * | 6 | automaticAttacks  | OK     | Wolves 2 strikes 6 prowess — matches card text     |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                    |
 * |---|---------------------|-------------|------------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc.      |
 * | 2 | Automatic attacks   | IMPLEMENTED | site-phase auto-attack initiates combat  |
 * | 3 | Starter movement    | IMPLEMENTED | movement-map.ts                          |
 * | 4 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used           |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS,
  resetMint, pool,
  buildSitePhaseState,
  viableFor,
  setupAutoAttackStep,
  dispatch,
} from '../test-helpers.js';
import {
  RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const THE_WHITE_TOWERS = 'tw-430' as CardDefinitionId;

describe('The White Towers (tw-430)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at The White Towers', () => {
    const state = buildSitePhaseState({ site: THE_WHITE_TOWERS });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Wolves automatic attack triggers with 2 strikes and 6 prowess', () => {
    const state = buildSitePhaseState({ site: THE_WHITE_TOWERS, characters: [ARAGORN, LEGOLAS] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(6);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('The White Towers');
  });

  test('region distance from Rivendell is 2 (Arthedain adjacent to Rhudaur)', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'The White Towers',
    );

    expect(entry).toBeDefined();
    expect(entry!.regionDistance).toBe(2);
  });
});
