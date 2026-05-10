/**
 * @module tw-427.test
 *
 * Card test: Stone-circle (tw-427)
 * Type: hero-site (ruins-and-lairs)
 * Region: Old Pûkel Gap
 * Nearest Haven: Edhellond
 * Playable: Information, Items (minor)
 * Automatic-attacks: Pûkel-creature — 1 strike with 9 prowess
 * Effects: none (no special text rules)
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                     |
 * |---|-------------------|--------|-----------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                 |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches {w}{w}                 |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool (tw-393)           |
 * | 4 | region            | OK     | "Old Pûkel Gap"                                           |
 * | 5 | playableResources | OK     | [information, minor] — matches card text                  |
 * | 6 | automaticAttacks  | OK     | Pûkel-creature, 1 strike, 9 prowess                       |
 * | 7 | resourceDraws     | OK     | 1                                                         |
 * | 8 | hazardDraws       | OK     | 1                                                         |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                                                  |
 * |---|-------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, play-resources          |
 * | 2 | Item playability (minor)      | IMPLEMENTED | playableResources gates minor subtype at this site     |
 * | 3 | Haven path movement           | IMPLEMENTED | Edhellond → Stone-circle via starter movement          |
 * | 4 | Card draws                    | IMPLEMENTED | resourceDraws / hazardDraws thread through M/H phase   |
 * | 5 | Automatic attacks             | IMPLEMENTED | site-phase auto-attack initiates Pûkel-creature combat |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GLAMDRING, DAGGER_OF_WESTERNESSE,
  EDHELLOND,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch,
  viableActions,
  runAutoAttackCombat,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const STONE_CIRCLE = 'tw-427' as CardDefinitionId;

describe('Stone-circle (tw-427)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Pûkel-creature automatic attack triggers with 1 strike and 9 prowess', () => {
    const state = buildSitePhaseState({ site: STONE_CIRCLE });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(9);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('character wins Pûkel-creature auto-attack — no corruption check queued', () => {
    const state = buildSitePhaseState({ site: STONE_CIRCLE });
    const readyState = setupAutoAttackStep(state);

    // Aragorn taps (prowess 6) + roll 12 = 18 > 9 → wins
    const result = runAutoAttackCombat(readyState, ARAGORN, 12, null);
    expect(result.state.combat).toBeNull();

    // No corruption check — Stone-circle has no wound→corruption-check rule
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  test('character wounded by Pûkel-creature auto-attack — no corruption check (no such rule)', () => {
    const state = buildSitePhaseState({ site: STONE_CIRCLE });
    const readyState = setupAutoAttackStep(state);

    // Aragorn untapped (prowess 3) + roll 2 = 5 < 9 → wounded; body roll 5 ≤ 9 → survives
    const result = runAutoAttackCombat(readyState, ARAGORN, 2, 5, false, PLAYER_1, PLAYER_2);
    expect(result.state.combat).toBeNull();

    // Stone-circle does NOT have "each character wounded must make a corruption check"
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor items are playable at Stone-circle', () => {
    const state = buildSitePhaseState({
      site: STONE_CIRCLE,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Stone-circle', () => {
    const state = buildSitePhaseState({
      site: STONE_CIRCLE,
      hand: [GLAMDRING],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    // Glamdring is a major item; Stone-circle only lists information and minor
    expect(resourceActions.every(a => a.action.type === 'not-playable')).toBe(true);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Edhellond reaches Stone-circle', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (STONE_CIRCLE as string),
    );

    expect(entry).toBeDefined();
  });

  test('starter movement from Stone-circle reaches Edhellond (nearest haven)', () => {
    const stoneCircle = pool[STONE_CIRCLE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, stoneCircle, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDHELLOND as string),
    );

    expect(entry).toBeDefined();
  });
});
