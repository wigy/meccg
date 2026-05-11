/**
 * @module tw-431.test
 *
 * Card test: The Wind Throne (tw-431)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Lórien
 *  Playable: Information, Items (minor, major)
 *  Automatic-attacks: Orcs — 3 strikes with 7 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                             |
 * |---|-------------------|--------|---------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                         |
 * | 2 | sitePath          | OK     | [wilderness, border, shadow] — matches {w}{b}{s}  |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool               |
 * | 4 | playableResources | OK     | information, minor, major — matches card text     |
 * | 5 | automaticAttacks  | OK     | Orcs, 3 strikes, 7 prowess                        |
 * | 6 | resourceDraws     | OK     | 2                                                 |
 * | 7 | hazardDraws       | OK     | 2                                                 |
 *
 * Engine Support:
 * | # | Feature                     | Status      | Notes                               |
 * |---|-----------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow             | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability (minor/major)| IMPLEMENTED | both subtypes checked              |
 * | 3 | Information playability     | NOTE        | TODO in site.ts; no info cards yet  |
 * | 4 | Haven path movement         | IMPLEMENTED | movement-map.ts                     |
 * | 5 | Automatic attacks           | IMPLEMENTED | combat initiated with correct stats |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  ARAGORN, GIMLI, FARAMIR,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const THE_WIND_THRONE = 'tw-431' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('The Wind Throne (tw-431)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 3 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({
      site: THE_WIND_THRONE,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(7);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor items playable at The Wind Throne', () => {
    const state = buildSitePhaseState({
      site: THE_WIND_THRONE,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items playable at The Wind Throne', () => {
    const state = buildSitePhaseState({
      site: THE_WIND_THRONE,
      hand: [GLAMDRING],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement ────────────────────────────────────────────────────────────

  test('starter movement from Lórien reaches The Wind Throne', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('The Wind Throne');
  });

  test('starter movement from The Wind Throne reaches Lórien (back to nearest haven)', () => {
    const windThrone = pool[THE_WIND_THRONE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, windThrone, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Lórien');
  });
});
