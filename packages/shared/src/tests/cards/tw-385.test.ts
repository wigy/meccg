/**
 * @module tw-385.test
 *
 * Card test: Dimrill Dale (tw-385)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Lórien
 *  Playable: Information
 *  Automatic-attacks: Orcs — 1 strike with 6 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches {w}{w}           |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                |
 * | 4 | playableResources | OK     | ["information"] — matches card text                |
 * | 5 | automaticAttacks  | OK     | Orcs, 1 strike, 6 prowess                         |
 * | 6 | resourceDraws     | OK     | 1                                                  |
 * | 7 | hazardDraws       | OK     | 1                                                  |
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
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const DIMRILL_DALE = 'tw-385' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Dimrill Dale (tw-385)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 1 strike and 6 prowess', () => {
    const state = buildSitePhaseState({ site: DIMRILL_DALE });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(6);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Play-resources step ──────────────────────────────────────────────────

  test('pass is available during play-resources step', () => {
    const state = buildSitePhaseState({ site: DIMRILL_DALE });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement ────────────────────────────────────────────────────────────

  test('starter movement from Lórien reaches Dimrill Dale', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dimrill Dale');
  });

  test('starter movement from Dimrill Dale reaches Lórien (back to nearest haven)', () => {
    const dimrillDale = pool[DIMRILL_DALE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dimrillDale, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Lórien');
  });
});
