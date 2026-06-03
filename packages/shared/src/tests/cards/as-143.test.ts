/**
 * @module as-143.test
 *
 * Card test: Dancing Spire (as-143)
 * Type: minion-site (ruins-and-lairs) in Withered Heath
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Text:
 *   Nearest Darkhaven: Dol Guldur
 *   Playable: Items (minor, major, greater, gold ring)
 *   Automatic-attacks: Dragon — 2 strikes with 11 prowess
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                          |
 * | 2 | sitePath          | OK     | [dark, wilderness, wilderness, wilderness]          |
 * | 3 | nearestHaven      | OK     | "Dol Guldur" — valid minion haven (le-367)         |
 * | 4 | region            | OK     | "Withered Heath"                                   |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring]                 |
 * | 6 | automaticAttacks  | OK     | Dragon, 2 strikes / 11 prowess                     |
 * | 7 | resourceDraws     | OK     | 2                                                  |
 * | 8 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature                   | Status      | Notes                                          |
 * |---|---------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow           | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | Haven path movement       | IMPLEMENTED | movement-map.ts — Dol Guldur ↔ Dancing Spire   |
 * | 3 | Item playability          | IMPLEMENTED | playableResources gates item subtypes          |
 * | 4 | Automatic attacks at site | IMPLEMENTED | Dragon auto-attack triggers combat             |
 *
 * Playable: YES
 * Certified: 2026-06-04
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions,
  dispatch,
} from '../test-helpers.js';
import {
  isSiteCard,
  buildMovementMap,
  getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const DANCING_SPIRE = 'as-143' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const ASTERNAK = 'le-1' as CardDefinitionId;

// Minion items — no site-specific play restrictions
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;   // minor
const SABLE_SHIELD = 'le-341' as CardDefinitionId;       // major
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId;  // greater
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // gold-ring

describe('Dancing Spire (as-143)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Dragon — 2 strikes with 11 prowess ───────────────────

  test('automatic attack: Dragon — 2 strikes with 11 prowess', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ASTERNAK],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.creatureRace).toBe('dragon');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Strange Rations) is playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ASTERNAK],
      hand: [STRANGE_RATIONS],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Sable Shield) is playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ASTERNAK],
      hand: [SABLE_SHIELD],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ASTERNAK],
      hand: [SCROLL_OF_ISILDUR],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item (The Least of Gold Rings) is playable at Dancing Spire', () => {
    const state = buildSitePhaseState({
      site: DANCING_SPIRE,
      characters: [ASTERNAK],
      hand: [LEAST_OF_GOLD_RINGS],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Movement: Dol Guldur ↔ Dancing Spire ──────────────────────────────────

  test('starter movement from Dol Guldur reaches Dancing Spire', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DANCING_SPIRE as string),
    );

    expect(starter).toBeDefined();
  });

  test('starter movement from Dancing Spire reaches Dol Guldur', () => {
    const dancingSpire = pool[DANCING_SPIRE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dancingSpire, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (DOL_GULDUR as string),
    );

    expect(starter).toBeDefined();
  });

  test('region movement from Dol Guldur reaches Dancing Spire', () => {
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (DANCING_SPIRE as string),
    );

    expect(regionEntry).toBeDefined();
  });
});
