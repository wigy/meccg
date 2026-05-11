/**
 * @module tw-423.test
 *
 * Card test: Sarn Goriwing (tw-423)
 * Type: hero-site (shadow-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Orcs — 3 strikes with 5 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                            |
 * | 2 | sitePath          | OK     | [wilderness, border, wilderness, wilderness]      |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool              |
 * | 4 | region            | OK     | "Heart of Mirkwood"                              |
 * | 5 | playableResources | OK     | [minor, major] — matches card text               |
 * | 6 | automaticAttacks  | OK     | Orcs, 3 strikes, 5 prowess — matches card text   |
 * | 7 | resourceDraws     | OK     | 2                                                |
 * | 8 | hazardDraws       | OK     | 2                                                |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                               |
 * |---|---------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability    | IMPLEMENTED | minor, major via playableResources  |
 * | 3 | Haven path movement | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 5 | Automatic attacks   | IMPLEMENTED | Orcs combat initiated correctly     |
 *
 * Playable: YES
 * Certified: 2026-05-10
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
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const SARN_GORIWING = 'tw-423' as CardDefinitionId;

describe('Sarn Goriwing (tw-423)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at Sarn Goriwing', () => {
    const state = buildSitePhaseState({
      site: SARN_GORIWING,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Sarn Goriwing', () => {
    const state = buildSitePhaseState({
      site: SARN_GORIWING,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are not playable at Sarn Goriwing', () => {
    const state = buildSitePhaseState({
      site: SARN_GORIWING,
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (SARN_GORIWING as string),
    );

    expect(entry).toBeDefined();
  });

  // ─── Automatic attacks ────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 3 strikes and 5 prowess', () => {
    const state = buildSitePhaseState({ site: SARN_GORIWING });
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
    expect(nextState.combat!.strikeProwess).toBe(5);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });
});
