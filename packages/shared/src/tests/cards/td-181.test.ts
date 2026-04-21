/**
 * @module td-181.test
 *
 * Card test: Zarak Dûm (td-181)
 * Type: hero-site (ruins-and-lairs) in Angmar
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Haven: Rivendell.
 *   Playable: Items (minor, major).
 *   Automatic-attacks: Dragon — 1 strike with 11 prowess.
 *
 * Site data also marks this site as the `lairOf` Scorba (td-63) with the
 * `hoard` keyword — these are TD-expansion metadata fields consumed by other
 * cards (Scorba's playability gate, hoard-item lookups) and carry no rules
 * text of their own on Zarak Dûm.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                |
 * |---|-------------------|--------|------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                            |
 * | 2 | sitePath          | OK     | [wilderness, shadow] — matches card text {w}{s}      |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool               |
 * | 4 | region            | OK     | "Angmar" — valid region in card pool                 |
 * | 5 | playableResources | OK     | [minor, major] — matches card text                   |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 11 prowess — matches card text     |
 * | 7 | resourceDraws     | OK     | 2                                                    |
 * | 8 | hazardDraws       | OK     | 3                                                    |
 *
 * Engine Support:
 * | # | Feature                  | Status      | Notes                                        |
 * |---|--------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow          | IMPLEMENTED | select-company, enter-or-skip, play-resources|
 * | 2 | Item playability         | IMPLEMENTED | minor, major allowed; greater/gold-ring not  |
 * | 3 | Haven path movement      | IMPLEMENTED | movement-map.ts resolves nearestHaven        |
 * | 4 | Region movement          | IMPLEMENTED | Angmar reachable within 4 regions of Rhudaur |
 * | 5 | Card draws               | IMPLEMENTED | resourceDraws/hazardDraws used in M/H phase  |
 * | 6 | Automatic attack (1)     | IMPLEMENTED | Dragon 1×11 initiated with correct stats     |
 *
 * Playable: YES
 * Certified: 2026-04-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, ARAGORN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import {
  RIVENDELL, LORIEN,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const ZARAK_DUM = 'td-181' as CardDefinitionId;

describe('Zarak Dûm (td-181)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Zarak Dûm', () => {
    const state = buildSitePhaseState({
      site: ZARAK_DUM,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Zarak Dûm', () => {
    const state = buildSitePhaseState({
      site: ZARAK_DUM,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are NOT playable at Zarak Dûm (not in playableResources)', () => {
    const state = buildSitePhaseState({
      site: ZARAK_DUM,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('gold-ring items are NOT playable at Zarak Dûm (not in playableResources)', () => {
    const state = buildSitePhaseState({
      site: ZARAK_DUM,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: ZARAK_DUM });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Automatic attack ───────────────────────────────────────────────────────

  test('automatic attack: Dragon — 1 strike with 11 prowess', () => {
    const state = buildSitePhaseState({
      site: ZARAK_DUM,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Movement: Rivendell → Zarak Dûm ────────────────────────────────────────

  test('starter movement from Rivendell reaches Zarak Dûm', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ZARAK_DUM as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Lórien does NOT reach Zarak Dûm', () => {
    // Zarak Dûm's nearestHaven is Rivendell, so Lórien's starter movement
    // should not include it.
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (ZARAK_DUM as string),
    );

    expect(starterEntry).toBeUndefined();
  });

  // ─── Movement: Zarak Dûm → Rivendell ────────────────────────────────────────

  test('starter movement from Zarak Dûm reaches Rivendell', () => {
    const zarakDum = pool[ZARAK_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, zarakDum, allSites);
    const starterRivendell = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (RIVENDELL as string),
    );

    expect(starterRivendell).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Rivendell reaches Zarak Dûm (Angmar adjacent to Rhudaur)', () => {
    // Rivendell is in Rhudaur; Zarak Dûm is in Angmar — adjacent regions →
    // 1 edge → regionDistance === 2.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (ZARAK_DUM as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });
});
