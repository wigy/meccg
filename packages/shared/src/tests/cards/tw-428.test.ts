/**
 * @module tw-428.test
 *
 * Card test: The Lonely Mountain (tw-428)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Haven: Lórien.
 *   Playable: Items (minor, major, greater, gold ring).
 *   Automatic-attacks: Dragon — 1 strike with 14 prowess.
 *
 * The `hoard` keyword and `lairOf: "tw-90"` (Smaug) are metadata fields
 * consumed by other cards (hoard-item playability gates, Smaug's
 * site-playability clause) and carry no rules text of their own on
 * The Lonely Mountain.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                      |
 * | 2 | sitePath          | OK     | [wilderness, border, border, wilderness]                       |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                            |
 * | 4 | region            | OK     | "Northern Rhovanion" — valid region                            |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches card text         |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike, 14 prowess — matches card text               |
 * | 7 | resourceDraws     | OK     | 2                                                              |
 * | 8 | hazardDraws       | OK     | 2                                                              |
 * | 9 | lairOf            | OK     | "tw-90" (Smaug) — Dragon lair                                  |
 * |10 | keywords          | OK     | ["hoard"] — hoard items may be played here                     |
 *
 * Engine Support:
 * | # | Feature                  | Status      | Notes                                         |
 * |---|--------------------------|-------------|-----------------------------------------------|
 * | 1 | Site phase flow          | IMPLEMENTED | select-company, enter-or-skip, play-resources |
 * | 2 | Item playability         | IMPLEMENTED | minor, major, greater, gold-ring all allowed  |
 * | 3 | Haven path movement      | IMPLEMENTED | movement-map.ts resolves nearestHaven         |
 * | 4 | Card draws               | IMPLEMENTED | resourceDraws/hazardDraws used in M/H phase   |
 * | 5 | Automatic attack         | IMPLEMENTED | Dragon 1×14 initiated with correct stats      |
 * | 6 | Hoard keyword            | IMPLEMENTED | site.keywords $includes "hoard"               |
 * | 7 | Dragon lair suppression  | IMPLEMENTED | manifestations.ts lairOf handling             |
 *
 * Playable: YES
 * Certified: 2026-05-10
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
  LORIEN, RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const THE_LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

describe('The Lonely Mountain (tw-428)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor items are playable at The Lonely Mountain', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at The Lonely Mountain', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at The Lonely Mountain', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at The Lonely Mountain', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: THE_LONELY_MOUNTAIN });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Automatic attack ────────────────────────────────────────────────────────

  test('automatic attack: Dragon — 1 strike with 14 prowess', () => {
    const state = buildSitePhaseState({
      site: THE_LONELY_MOUNTAIN,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(14);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Movement: Lórien ↔ The Lonely Mountain ─────────────────────────────────

  test('starter movement from Lórien reaches The Lonely Mountain', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THE_LONELY_MOUNTAIN as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from The Lonely Mountain reaches Lórien', () => {
    const lonelyMountain = pool[THE_LONELY_MOUNTAIN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lonelyMountain, allSites);
    const starterLorien = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );

    expect(starterLorien).toBeDefined();
  });

  test('starter movement from Rivendell does NOT reach The Lonely Mountain', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THE_LONELY_MOUNTAIN as string),
    );

    expect(starterEntry).toBeUndefined();
  });
});
