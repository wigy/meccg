/**
 * @module le-351.test
 *
 * Card test: Bandit Lair (le-351)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Darkhaven: Dol Guldur. Playable: Items (minor, gold ring).
 *  Automatic-attacks: Men — 3 strikes with 6 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [dark, shadow] — matches card text                         |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven in card pool             |
 * | 4 | playableResources | OK     | [minor, gold-ring] — matches card text                     |
 * | 5 | automaticAttacks  | OK     | Men, 3 strikes, 6 prowess — matches card text              |
 * | 6 | resourceDraws     | OK     | 1                                                          |
 * | 7 | hazardDraws       | OK     | 1                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, gold-ring playable; major not |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats  |
 *
 * Playable: YES
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  DAGGER_OF_WESTERNESSE, GLAMDRING, PRECIOUS_GOLD_RING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const BANDIT_LAIR_LE = 'le-351' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Bandit Lair (le-351)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Bandit Lair', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR_LE,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Bandit Lair', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR_LE,
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Bandit Lair', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR_LE,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: BANDIT_LAIR_LE });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Bandit Lair ──────────────────────────────────────────────

  test('reachable from Dol Guldur via starter movement', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(BANDIT_LAIR_LE);
  });

  test('reachable from Dol Guldur via region movement', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === BANDIT_LAIR_LE,
    );

    expect(regionEntry).toBeDefined();
    // Southern Mirkwood (Dol Guldur) → Brown Lands = 2 regions traversed
    expect(regionEntry!.regionDistance).toBe(2);
  });

  test('not reachable from Minas Morgul via starter movement', () => {
    // Bandit Lair's nearest darkhaven is Dol Guldur, not Minas Morgul.
    const allSites = Object.values(pool).filter(isSiteCard);
    const minasMorgul = allSites.find(
      s => s.name === 'Minas Morgul' && s.siteType === 'haven',
    )!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(BANDIT_LAIR_LE);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Men automatic attack triggers with 3 strikes and 6 prowess', () => {
    const state = buildSitePhaseState({ site: BANDIT_LAIR_LE });
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
});
