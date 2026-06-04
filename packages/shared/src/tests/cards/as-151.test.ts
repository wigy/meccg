/**
 * @module as-151.test
 *
 * Card test: Irerock (as-151)
 * Type: minion-site (ruins-and-lairs) in Withered Heath
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur.
 *   Playable: Items (minor, major, greater, gold ring).
 *   Automatic-attacks: Dragon — 1 strike with 14 prowess.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness, wilderness]          |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)         |
 * | 4 | region            | OK     | "Withered Heath"                                   |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring] — matches text  |
 * | 6 | automaticAttacks  | OK     | Dragon, 1 strike / 14 prowess                      |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature                   | Status      | Notes                                        |
 * |---|---------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow           | IMPLEMENTED | select-company, enter-or-skip, play-resources|
 * | 2 | Item playability          | IMPLEMENTED | site.ts enforces playableResources           |
 * | 3 | Haven path movement       | IMPLEMENTED | Dol Guldur (le-367) ↔ Irerock starter        |
 * | 4 | Region movement           | IMPLEMENTED | Southern Mirkwood → Withered Heath (dist 4)  |
 * | 5 | Automatic attacks at site | IMPLEMENTED | Dragon 1/14 triggers combat via pass         |
 *
 * Playable: YES
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT, GLAMDRING, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions,
  dispatch,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const IREROCK = 'as-151' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Irerock (as-151)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Dragon 1/14 ──────────────────────────────────────────

  test('automatic attack: Dragon — 1 strike with 14 prowess', () => {
    const state = buildSitePhaseState({
      site: IREROCK,
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

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at Irerock', () => {
    const state = buildSitePhaseState({
      site: IREROCK,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major item (Glamdring) is playable at Irerock', () => {
    const state = buildSitePhaseState({
      site: IREROCK,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater item (The Mithril-coat) is playable at Irerock', () => {
    const state = buildSitePhaseState({
      site: IREROCK,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring item (Precious Gold Ring) is playable at Irerock', () => {
    const state = buildSitePhaseState({
      site: IREROCK,
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Starter movement: Dol Guldur ↔ Irerock ─────────────────────────────────

  test('starter movement from Dol Guldur reaches Irerock', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (IREROCK as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Irerock reaches Dol Guldur', () => {
    const irerock = pool[IREROCK as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, irerock, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starter).toBeDefined();
  });

  test('Irerock is not a haven and does not appear in Dol Guldur havenToHaven links', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const havenLinks = buildMovementMap(pool).havenToHaven.get(dolGuldur.name);

    expect(havenLinks).toBeDefined();
    expect(havenLinks!.has('Irerock')).toBe(false);
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Dol Guldur reaches Irerock within 4 regions', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (IREROCK as string),
    );

    // Southern Mirkwood (Dol Guldur) → Heart of Mirkwood → Northern Rhovanion
    // → Withered Heath (Irerock): 3 edges = distance 4.
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(4);
  });
});
