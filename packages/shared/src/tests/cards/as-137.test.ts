/**
 * @module as-137.test
 *
 * Card test: Cirith Gorgor (as-137)
 * Type: hero-site (dark-hold) in Udûn
 * Nearest Haven: Lórien
 * Playable: Items (minor, major, greater)
 * Automatic-attacks (2): (1st) Orcs — 5 strikes with 8 prowess; (2nd) Trolls — 2 strikes with 10 prowess
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                                |
 * |---|-------------------|--------|----------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                                  |
 * | 2 | sitePath          | OK     | [wilderness, shadow, free, wilderness, shadow, dark, dark]           |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                                  |
 * | 4 | region            | OK     | "Udûn" — valid region                                                |
 * | 5 | playableResources | OK     | [minor, major, greater] — matches card text                          |
 * | 6 | automaticAttacks  | OK     | Orcs 5/8, Trolls 2/10 — matches card text                           |
 * | 7 | resourceDraws     | OK     | 3                                                                    |
 * | 8 | hazardDraws       | OK     | 5                                                                    |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                                               |
 * |---|-------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, play-resources        |
 * | 2 | Item playability              | IMPLEMENTED | minor, major, greater via playableResources          |
 * | 3 | Haven path movement           | IMPLEMENTED | Lórien → Cirith Gorgor via starter movement          |
 * | 4 | Card draws                    | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase |
 * | 5 | Automatic attacks (both)      | IMPLEMENTED | site-phase auto-attack initiates Orc and Troll combats |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  LORIEN, RIVENDELL,
  DAGGER_OF_WESTERNESSE, GLAMDRING, SCROLL_OF_ISILDUR,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, SitePhaseState } from '../../index.js';

const CIRITH_GORGOR = 'as-137' as CardDefinitionId;

describe('Cirith Gorgor (as-137)', () => {
  beforeEach(() => resetMint());

  // ─── Site path: reachable from nearest haven Lórien ─────────────────────────

  test('Lórien starter movement reaches Cirith Gorgor', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_GORGOR as string),
    );

    expect(entry).toBeDefined();
  });

  test('Rivendell starter movement does NOT reach Cirith Gorgor', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_GORGOR as string),
    );

    expect(entry).toBeUndefined();
  });

  // ─── Item playability: minor, major, greater ─────────────────────────────────
  // playableResources = [minor, major, greater]; the legal-action layer consults
  // this list when proposing play-hero-resource actions.

  test('minor item (Dagger of Westernesse) is offered at Cirith Gorgor', () => {
    const state = buildSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is offered at Cirith Gorgor', () => {
    const state = buildSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is offered at Cirith Gorgor', () => {
    const state = buildSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ARAGORN],
      hand: [SCROLL_OF_ISILDUR],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('1st automatic attack: Orcs — 5 strikes with 8 prowess', () => {
    const state = buildSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(5);
    expect(next.combat!.strikeProwess).toBe(8);
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('2nd automatic attack: Trolls — 2 strikes with 10 prowess', () => {
    const state = buildSitePhaseState({
      site: CIRITH_GORGOR,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);
    // Simulate the first attack already resolved by advancing the counter.
    const stateAfterFirst = {
      ...readyState,
      phaseState: {
        ...(readyState.phaseState),
        automaticAttacksResolved: 1,
      } as SitePhaseState,
    };

    const next = dispatch(stateAfterFirst, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });
});
