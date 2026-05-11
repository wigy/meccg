/**
 * @module tw-436.test
 *
 * Card test: Weathertop (tw-436)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell
 *  Playable: Information
 *  Automatic-attacks: Wolves — 2 strikes with 6 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches {w}{w}           |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool             |
 * | 4 | region            | OK     | "Arthedain" — valid region                         |
 * | 5 | playableResources | OK     | ["information"] — matches card text                |
 * | 6 | automaticAttacks  | OK     | Wolves, 2 strikes, 6 prowess                       |
 * | 7 | resourceDraws     | OK     | 1                                                  |
 * | 8 | hazardDraws       | OK     | 1                                                  |
 *
 * Engine Support:
 * | # | Feature                | Status      | Notes                                                 |
 * |---|------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow        | IMPLEMENTED | select-company, enter-or-skip, etc.                   |
 * | 2 | Information playability| NOTE        | TODO in site.ts; no information cards in pool yet     |
 * | 3 | Haven path movement    | IMPLEMENTED | movement-map.ts                                       |
 * | 4 | Automatic attacks      | IMPLEMENTED | combat initiated with correct stats                   |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const WEATHERTOP = 'tw-436' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Weathertop (tw-436)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Wolves automatic attack triggers with 2 strikes and 6 prowess', () => {
    const state = buildSitePhaseState({ site: WEATHERTOP });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(6);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Play-resources step ──────────────────────────────────────────────────

  test('pass is available during play-resources step', () => {
    const state = buildSitePhaseState({ site: WEATHERTOP });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement ────────────────────────────────────────────────────────────

  test('starter movement from Rivendell reaches Weathertop', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Weathertop');
  });

  test('starter movement from Weathertop reaches Rivendell (back to nearest haven)', () => {
    const weathertop = pool[WEATHERTOP as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, weathertop, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Rivendell');
  });
});
