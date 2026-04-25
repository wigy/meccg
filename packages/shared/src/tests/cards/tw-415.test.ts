/**
 * @module tw-415.test
 *
 * Card test: Mount Gram (tw-415)
 * Type: hero-site (shadow-hold)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell
 *  Playable: Items (minor, major)
 *  Automatic-attacks: Orcs — 3 strikes with 6 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                    |
 * | 2 | sitePath          | OK     | [wilderness, shadow] — matches card text                 |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool                   |
 * | 4 | playableResources | OK     | [minor, major] — matches card text                       |
 * | 5 | automaticAttacks  | OK     | Orcs, 3 strikes, 6 prowess — matches card text           |
 * | 6 | resourceDraws     | OK     | 2                                                        |
 * | 7 | hazardDraws       | OK     | 3                                                        |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, major                        |
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
  RIVENDELL,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState } from '../../index.js';

const MOUNT_GRAM = 'tw-415' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Mount Gram (tw-415)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Mount Gram', () => {
    const state = buildSitePhaseState({
      site: MOUNT_GRAM,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Mount Gram', () => {
    const state = buildSitePhaseState({
      site: MOUNT_GRAM,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: MOUNT_GRAM });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Mount Gram ─────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Mount Gram');
  });

  test('not reachable from Lórien via starter movement', () => {
    const allSites = Object.values(pool).filter(isSiteCard);
    const lorien = allSites.find(s => s.name === 'Lórien')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Mount Gram');
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 3 strikes and 6 prowess', () => {
    const state = buildSitePhaseState({ site: MOUNT_GRAM });
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
