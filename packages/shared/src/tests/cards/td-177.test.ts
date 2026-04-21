/**
 * @module td-177.test
 *
 * Card test: Gondmaeglom (td-177)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Lórien. Playable: Items (minor, major, gold ring).
 *  Automatic-attacks: Dragon — 1 strike with 14 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [wilderness, border, shadow] — matches {w}{b}{s}           |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                        |
 * | 4 | playableResources | OK     | [minor, major, gold-ring] — matches card text              |
 * | 5 | automaticAttacks  | OK     | Dragon, 1 strike, 14 prowess — matches card text           |
 * | 6 | resourceDraws     | OK     | 2                                                          |
 * | 7 | hazardDraws       | OK     | 2                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, major, gold-ring checked     |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats  |
 *
 * Playable: YES
 * Certified: 2026-04-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool, reduce,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import {
  LORIEN, DAGGER_OF_WESTERNESSE, GLAMDRING, PRECIOUS_GOLD_RING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const GONDMAEGLOM = 'td-177' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Gondmaeglom (td-177)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Gondmaeglom', () => {
    const state = buildSitePhaseState({
      site: GONDMAEGLOM,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Gondmaeglom', () => {
    const state = buildSitePhaseState({
      site: GONDMAEGLOM,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Gondmaeglom', () => {
    const state = buildSitePhaseState({
      site: GONDMAEGLOM,
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: GONDMAEGLOM });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Gondmaeglom ────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Gondmaeglom');
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Gondmaeglom',
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

    expect(starterNames).not.toContain('Gondmaeglom');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Dragon automatic attack triggers with 1 strike and 14 prowess', () => {
    const state = buildSitePhaseState({ site: GONDMAEGLOM });
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
});
