/**
 * @module td-174.test
 *
 * Card test: Dale (td-174)
 * Type: hero-site (border-hold) in Northern Rhovanion
 * Effects: none
 *
 * Text:
 *   Nearest Haven: Lórien
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                     |
 * |---|-------------------|--------|-----------------------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid, matches {B} in cards.json          |
 * | 2 | sitePath          | OK     | [wilderness, border, border, wilderness] — matches {w}{b}{b}{w} |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                       |
 * | 4 | region            | OK     | "Northern Rhovanion" — valid region in card pool          |
 * | 5 | playableResources | OK     | [] — no items playable (no "Playable:" line in card text) |
 * | 6 | automaticAttacks  | OK     | [] — none                                                 |
 * | 7 | resourceDraws     | OK     | 2                                                         |
 * | 8 | hazardDraws       | OK     | 2                                                         |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                                        |
 * |---|-------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, play-resources |
 * | 2 | Item playability (none) | IMPLEMENTED | empty playableResources → no items playable  |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts → nearestHaven = Lórien      |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  LORIEN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildSitePhaseState,
  viableActions,
} from '../test-helpers.js';
import { isSiteCard, buildMovementMap, getReachableSites } from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const DALE = 'td-174' as CardDefinitionId;

describe('Dale (td-174)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability: nothing is playable at Dale ────────────────────────

  test('minor items are NOT playable at Dale (no playableResources)', () => {
    const state = buildSitePhaseState({
      site: DALE,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('major items are NOT playable at Dale', () => {
    const state = buildSitePhaseState({
      site: DALE,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('greater items are NOT playable at Dale', () => {
    const state = buildSitePhaseState({
      site: DALE,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('gold-ring items are NOT playable at Dale', () => {
    const state = buildSitePhaseState({
      site: DALE,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  // ─── Movement: Lórien ↔ Dale ──────────────────────────────────────────────

  test('starter movement from Lórien reaches Dale', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DALE as string),
    );
    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Dale reaches Lórien', () => {
    const dale = pool[DALE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dale, allSites);
    const starterLorien = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );
    expect(starterLorien).toBeDefined();
  });
});
