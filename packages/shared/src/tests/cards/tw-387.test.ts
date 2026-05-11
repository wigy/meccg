/**
 * @module tw-387.test
 *
 * Card test: Dol Guldur (tw-387)
 * Type: hero-site (dark-hold)
 * Effects: 0
 *
 * "Nearest Haven: Lórien
 *  Playable: Items (minor, major, greater)
 *  Automatic-attacks (2): (1st) Orcs — 3 strikes with 7 prowess
 *                         (2nd) Trolls — 2 strikes with 8 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                           |
 * |---|-------------------|--------|-------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                             |
 * | 2 | sitePath          | OK     | [wilderness, border, dark] — Southern Mirkwood  |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool             |
 * | 4 | playableResources | OK     | [minor, major, greater] — matches card text     |
 * | 5 | automaticAttacks  | OK     | Orcs 3/7, Trolls 2/8 — matches card text        |
 * | 6 | resourceDraws     | OK     | 2                                               |
 * | 7 | hazardDraws       | OK     | 4                                               |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                               |
 * |---|---------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability    | IMPLEMENTED | minor, major, greater               |
 * | 3 | Haven path movement | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement     | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws          | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks   | IMPLEMENTED | combat initiated with correct stats |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN, RIVENDELL,
  resetMint, pool,
  buildSitePhaseState,
  setupAutoAttackStep,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const DOL_GULDUR_HERO = 'tw-387' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Dol Guldur (tw-387)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Dol Guldur', () => {
    const state = buildSitePhaseState({
      site: DOL_GULDUR_HERO,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Dol Guldur', () => {
    const state = buildSitePhaseState({
      site: DOL_GULDUR_HERO,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at Dol Guldur', () => {
    const state = buildSitePhaseState({
      site: DOL_GULDUR_HERO,
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: DOL_GULDUR_HERO });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Movement to Dol Guldur ────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Dol Guldur');
  });

  test('not reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).not.toContain('Dol Guldur');
  });

  test('reachable from Lórien via region movement at distance 3', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'region' && r.site.name === 'Dol Guldur',
    );

    expect(entry).toBeDefined();
    // wilderness → border → dark = 3 regions traversed
    expect(entry!.regionDistance).toBe(3);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('first automatic attack (Orcs) triggers with 3 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({ site: DOL_GULDUR_HERO });
    const readyState = setupAutoAttackStep(state);

    const afterFirst = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(afterFirst.combat).toBeDefined();
    expect(afterFirst.combat!.strikesTotal).toBe(3);
    expect(afterFirst.combat!.strikeProwess).toBe(7);
    expect(afterFirst.combat!.creatureRace).toBe('orc');
    expect(afterFirst.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('second automatic attack (Trolls) triggers with 2 strikes and 8 prowess after Orcs resolved', () => {
    const state = buildSitePhaseState({ site: DOL_GULDUR_HERO });
    const readyState = setupAutoAttackStep(state);

    const afterFirst = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    // Null out combat to simulate the first attack having been resolved
    const betweenAttacks = { ...afterFirst, combat: null };
    const siteStateBetween = betweenAttacks.phaseState as SitePhaseState;
    expect(siteStateBetween.automaticAttacksResolved).toBe(1);

    const afterSecond = dispatch(betweenAttacks, { type: 'pass', player: PLAYER_1 });
    expect(afterSecond.combat).toBeDefined();
    expect(afterSecond.combat!.strikesTotal).toBe(2);
    expect(afterSecond.combat!.strikeProwess).toBe(8);
    expect(afterSecond.combat!.creatureRace).toBe('troll');
    expect(afterSecond.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── No special effects ───────────────────────────────────────────────────

});
