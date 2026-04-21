/**
 * @module td-176.test
 *
 * Card test: Gold Hill (td-176)
 * Type: hero-site (ruins-and-lairs) in Withered Heath
 * Effects: 0 (no special rules beyond the standard site data fields)
 *
 * Text:
 *   Nearest Haven: Lórien.
 *   Playable: Items (minor, major, greater, gold ring).
 *   Automatic-attacks: Dragon — 1 strike with 15 prowess.
 *
 * Site data also marks this site as the `lairOf` Itangast (td-36) with the
 * `hoard` keyword — these are TD-expansion metadata fields consumed by other
 * cards (dragon playability gates, hoard-item lookups) and carry no rules
 * text of their own on Gold Hill.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                        |
 * |---|-------------------|--------|--------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                    |
 * | 2 | sitePath          | OK     | [wilderness, border, shadow, wilderness] — matches {w}{b}{s}{w} |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                          |
 * | 4 | region            | OK     | "Withered Heath" — valid region in card pool                 |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches card text       |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 15 prowess — matches card text             |
 * | 7 | resourceDraws     | OK     | 3                                                            |
 * | 8 | hazardDraws       | OK     | 3                                                            |
 *
 * Engine Support:
 * | # | Feature                  | Status      | Notes                                        |
 * |---|--------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow          | IMPLEMENTED | select-company, enter-or-skip, play-resources|
 * | 2 | Item playability         | IMPLEMENTED | minor, major, greater, gold-ring all allowed |
 * | 3 | Haven path movement      | IMPLEMENTED | movement-map.ts resolves nearestHaven        |
 * | 4 | Region movement          | IMPLEMENTED | Withered Heath within 4 regions of Lórien    |
 * | 5 | Card draws               | IMPLEMENTED | resourceDraws/hazardDraws used in M/H phase  |
 * | 6 | Automatic attack (1)     | IMPLEMENTED | Dragon 1×15 initiated with correct stats     |
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

const GOLD_HILL = 'td-176' as CardDefinitionId;

describe('Gold Hill (td-176)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: GOLD_HILL });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Automatic attack ───────────────────────────────────────────────────────

  test('automatic attack: Dragon — 1 strike with 15 prowess', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(15);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Movement: Lórien → Gold Hill ───────────────────────────────────────────

  test('starter movement from Lórien reaches Gold Hill', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOLD_HILL as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Rivendell does NOT reach Gold Hill', () => {
    // Gold Hill's nearestHaven is Lórien, so Rivendell's starter movement
    // should not include it.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOLD_HILL as string),
    );

    expect(starterEntry).toBeUndefined();
  });

  // ─── Movement: Gold Hill → Lórien ───────────────────────────────────────────

  test('starter movement from Gold Hill reaches Lórien', () => {
    const goldHill = pool[GOLD_HILL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, goldHill, allSites);
    const starterLorien = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );

    expect(starterLorien).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Lórien reaches Gold Hill (Withered Heath within 4)', () => {
    // Lórien is in Wold & Foothills; Gold Hill is in Withered Heath. Shortest
    // path: Wold & Foothills → Anduin Vales → Grey Mountain Narrows →
    // Withered Heath = 3 edges → regionDistance === 4 (the limit).
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (GOLD_HILL as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });
});
