/**
 * @module tw-383.test
 *
 * Card test: Dancing Spire (tw-383)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Haven: Lórien.
 *   Playable: Items (minor, major, greater, gold ring).
 *   Automatic-attacks: Dragon — 2 strikes with 11 prowess.
 *
 * The `hoard` keyword and `lairOf: "tw-26"` are metadata fields consumed by
 * other cards (hoard-item playability gates, Bairanax's site-playability
 * clause) and carry no rules text of their own on Dancing Spire.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                     |
 * |---|-------------------|--------|-----------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                 |
 * | 2 | sitePath          | OK     | [wilderness, border, shadow, wilderness] — matches {w}{b}{s}{w} |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                       |
 * | 4 | region            | OK     | "Withered Heath" — valid region                           |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches card text    |
 * | 6 | automaticAttacks  | OK     | Dragon, 2 strikes, 11 prowess — matches card text         |
 * | 7 | resourceDraws     | OK     | 3                                                         |
 * | 8 | hazardDraws       | OK     | 3                                                         |
 *
 * Engine Support:
 * | # | Feature                  | Status      | Notes                                         |
 * |---|--------------------------|-------------|-----------------------------------------------|
 * | 1 | Site phase flow          | IMPLEMENTED | select-company, enter-or-skip, play-resources |
 * | 2 | Item playability         | IMPLEMENTED | minor, major, greater, gold-ring all allowed  |
 * | 3 | Haven path movement      | IMPLEMENTED | movement-map.ts resolves nearestHaven         |
 * | 4 | Card draws               | IMPLEMENTED | resourceDraws/hazardDraws used in M/H phase   |
 * | 5 | Automatic attack         | IMPLEMENTED | Dragon 2×11 initiated with correct stats      |
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

const DANCING_SPIRE = 'tw-383' as CardDefinitionId;

describe('Dancing Spire (tw-383)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor items are playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: DANCING_SPIRE });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Automatic attack ────────────────────────────────────────────────────────

  test('automatic attack: Dragon — 2 strikes with 11 prowess', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Movement: Lórien ↔ Dancing Spire ───────────────────────────────────────

  test('starter movement from Lórien reaches Dancing Spire', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DANCING_SPIRE as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Dancing Spire reaches Lórien', () => {
    const dancingSpire = pool[DANCING_SPIRE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dancingSpire, allSites);
    const starterLorien = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );

    expect(starterLorien).toBeDefined();
  });

  test('starter movement from Rivendell does NOT reach Dancing Spire', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DANCING_SPIRE as string),
    );

    expect(starterEntry).toBeUndefined();
  });
});
