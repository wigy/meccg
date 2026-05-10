/**
 * @module tw-382.test
 *
 * Card test: Cirith Ungol (tw-382)
 * Type: hero-site (dark-hold)
 * Nearest Haven: Lórien
 * Region: Imlad Morgul
 * Playable: Items (minor, major, greater)
 * Automatic-attacks: Orcs — 4 strikes with 7 prowess
 * Effects: 0
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                               |
 * | 2 | sitePath          | OK     | [wilderness, border, free, wilderness, shadow] from Lórien        |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                               |
 * | 4 | region            | OK     | "Imlad Morgul"                                                    |
 * | 5 | playableResources | OK     | [minor, major, greater] — matches card text                       |
 * | 6 | automaticAttacks  | OK     | Orcs, 4 strikes, 7 prowess — matches card text                    |
 * | 7 | resourceDraws     | OK     | 3                                                                 |
 * | 8 | hazardDraws       | OK     | 4                                                                 |
 *
 * Engine Support:
 * | # | Feature               | Status      | Notes                               |
 * |---|-----------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow       | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability      | IMPLEMENTED | minor, major, greater               |
 * | 3 | Haven path movement   | IMPLEMENTED | Lórien starter movement reaches it  |
 * | 4 | Card draws            | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 5 | Automatic attacks     | IMPLEMENTED | Orcs combat initiated with stats    |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RIVENDELL, LORIEN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, SCROLL_OF_ISILDUR,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const CIRITH_UNGOL = 'tw-382' as CardDefinitionId;

describe('Cirith Ungol (tw-382)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Lórien is the nearest haven ──────────────────────────────────

  test('Lórien starter movement reaches Cirith Ungol', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_UNGOL as string),
    );

    expect(entry).toBeDefined();
  });

  test('Rivendell starter movement does NOT reach Cirith Ungol', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_UNGOL as string),
    );

    expect(entry).toBeUndefined();
  });

  // ─── Item playability: minor, major, greater ─────────────────────────────────

  test('minor item (Dagger of Westernesse) is offered at Cirith Ungol', () => {
    const state = buildSitePhaseState({
      site: CIRITH_UNGOL,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is offered at Cirith Ungol', () => {
    const state = buildSitePhaseState({
      site: CIRITH_UNGOL,
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is offered at Cirith Ungol', () => {
    const state = buildSitePhaseState({
      site: CIRITH_UNGOL,
      hand: [SCROLL_OF_ISILDUR],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: CIRITH_UNGOL });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 4 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({ site: CIRITH_UNGOL });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(4);
    expect(nextState.combat!.strikeProwess).toBe(7);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });
});
