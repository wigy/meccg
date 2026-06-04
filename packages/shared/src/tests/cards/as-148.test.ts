/**
 * @module as-148.test
 *
 * Card test: Gold Hill (as-148)
 * Type: minion-site (ruins-and-lairs) in Withered Heath
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur
 *   Playable: Items (minor, major, greater, gold ring)
 *   Automatic-attacks: Dragon — 1 strike with 15 prowess
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                               |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness, wilderness]               |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)              |
 * | 4 | region            | OK     | "Withered Heath" — valid region                         |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches text       |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike / 15 prowess                           |
 * | 7 | resourceDraws     | OK     | 2                                                       |
 * | 8 | hazardDraws       | OK     | 2                                                       |
 *
 * Engine Support:
 * | # | Feature                    | Status      | Notes                                          |
 * |---|----------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow            | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Starter movement           | IMPLEMENTED | nearestHaven → Dol Guldur (le-367)             |
 * | 3 | Region movement            | IMPLEMENTED | Withered Heath is 4 regions from Dol Guldur    |
 * | 4 | Item playability           | IMPLEMENTED | playableResources gates items at site          |
 * | 5 | Auto-attack (Dragon)       | IMPLEMENTED | Dragon 1/15 triggers combat                    |
 *
 * Playable: YES (no special effects; all data fields are routed through
 *   engine machinery that is already implemented.)
 *
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, pool, LORIEN, PLAYER_1,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch, viableActions,
  ARAGORN, DAGGER_OF_WESTERNESSE, GLAMDRING, SCROLL_OF_ISILDUR, PRECIOUS_GOLD_RING,
} from '../test-helpers.js';
import {
  isSiteCard,
  buildMovementMap,
  getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const ASTERNAK = 'le-1' as CardDefinitionId;
const GOLD_HILL = 'as-148' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Gold Hill (as-148)', () => {
  beforeEach(() => resetMint());

  // ─── Movement: Dol Guldur → Gold Hill ──────────────────────────────────────

  test('starter movement from Dol Guldur reaches Gold Hill (as-148)', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOLD_HILL as string),
    );

    expect(starter).toBeDefined();
  });

  // ─── Movement: Gold Hill → Dol Guldur ──────────────────────────────────────

  test('starter movement from Gold Hill (as-148) reaches Dol Guldur', () => {
    const goldHill = pool[GOLD_HILL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, goldHill, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Lórien does NOT reach Gold Hill (as-148)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterGoldHill = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (GOLD_HILL as string),
    );

    expect(starterGoldHill).toBeUndefined();
  });

  // ─── Movement: region distance ──────────────────────────────────────────────

  test('region movement from Dol Guldur reaches Gold Hill within 4 regions', () => {
    // Path: Southern Mirkwood → Southern Rhovanion → Northern Rhovanion → Withered Heath (4 regions, 3 edges)
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (GOLD_HILL as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });

  // ─── Automatic attack: Dragon — 1 strike with 15 prowess ────────────────────

  test('auto-attack initiates Dragon combat with 1 strike at prowess 15', () => {
    const state = buildSitePhaseState({ site: GOLD_HILL, characters: [ASTERNAK] });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(15);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability: minor, major, greater, gold-ring ─────────────────────

  test('minor item (Dagger of Westernesse) is playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [SCROLL_OF_ISILDUR],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item (Precious Gold Ring) is playable at Gold Hill', () => {
    const state = buildSitePhaseState({
      site: GOLD_HILL,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });
});
