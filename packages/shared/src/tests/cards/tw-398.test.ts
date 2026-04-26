/**
 * @module tw-398.test
 *
 * Card test: Goblin-gate (tw-398)
 * Type: hero-site (shadow-hold)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell
 *  Playable: Items (minor, gold ring)
 *  Automatic-attacks: Orcs — 3 strikes with 6 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                               |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — High Pass                |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool              |
 * | 4 | playableResources | OK     | [minor, gold-ring] — matches card text (fixed)      |
 * | 5 | automaticAttacks  | OK     | Orcs, 3 strikes, 6 prowess — matches card text      |
 * | 6 | resourceDraws     | OK     | 1                                                   |
 * | 7 | hazardDraws       | OK     | 2                                                   |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, gold-ring only               |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats |
 *
 * Playable: YES
 * Certified: 2026-04-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RIVENDELL,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
  GLAMDRING, DAGGER_OF_WESTERNESSE, PRECIOUS_GOLD_RING,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const GOBLIN_GATE = 'tw-398' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Goblin-gate (tw-398)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Goblin-gate', () => {
    const state = buildSitePhaseState({
      site: GOBLIN_GATE,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold ring items are playable at Goblin-gate', () => {
    const state = buildSitePhaseState({
      site: GOBLIN_GATE,
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are not playable at Goblin-gate', () => {
    const state = buildSitePhaseState({
      site: GOBLIN_GATE,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: GOBLIN_GATE });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Goblin-gate ────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Goblin-gate');
  });

  test('reachable from Rivendell via region movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Goblin-gate',
    );

    expect(regionEntry).toBeDefined();
    // Rhudaur → Angmar/High Pass = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 3 strikes and 6 prowess', () => {
    const state = buildSitePhaseState({ site: GOBLIN_GATE });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(6);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
