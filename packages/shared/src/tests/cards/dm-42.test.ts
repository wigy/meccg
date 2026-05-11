/**
 * @module dm-42.test
 *
 * Card test: Urlurtsu Nurn (dm-42)
 * Type: hero-site (dark-hold) in Nurn
 * Nearest Haven: Edhellond
 * Playable: Information, Items (minor, major)
 * Automatic-attacks: Orcs — 4 strikes with 7 prowess
 * Effects: 0 (no special rules beyond standard site data fields)
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                           |
 * |---|-------------------|--------|-----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                             |
 * | 2 | sitePath          | OK     | [wilderness, free, coastal-sea, wilderness, shadow, dark]       |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool                         |
 * | 4 | region            | OK     | "Nurn" — valid region                                           |
 * | 5 | playableResources | OK     | [information, minor, major] — matches card text (fixed from []) |
 * | 6 | automaticAttacks  | OK     | Orcs 4/7 — matches card text                                    |
 * | 7 | resourceDraws     | OK     | 3                                                               |
 * | 8 | hazardDraws       | OK     | 5                                                               |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                                                     |
 * |---|-------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, play-resources             |
 * | 2 | Minor/major item playability  | IMPLEMENTED | via playableResources                                     |
 * | 3 | Information playability       | NOTE        | No information cards in pool; engine check present        |
 * | 4 | Haven path movement           | IMPLEMENTED | Edhellond → Urlurtsu Nurn via starter movement            |
 * | 5 | Automatic attack              | IMPLEMENTED | Orcs 4 strikes 7 prowess                                  |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  EDHELLOND, RIVENDELL,
  GLAMDRING, DAGGER_OF_WESTERNESSE, SCROLL_OF_ISILDUR,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const URLURTSU_NURN = 'dm-42' as CardDefinitionId;

describe('Urlurtsu Nurn (dm-42)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Orcs automatic attack triggers with 4 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({ site: URLURTSU_NURN, characters: [ARAGORN] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).not.toBeNull();
    expect(nextState.combat!.strikesTotal).toBe(4);
    expect(nextState.combat!.strikeProwess).toBe(7);
    expect(nextState.combat!.creatureRace).toBe('orc');
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is offered at Urlurtsu Nurn', () => {
    const state = buildSitePhaseState({
      site: URLURTSU_NURN,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is offered at Urlurtsu Nurn', () => {
    const state = buildSitePhaseState({
      site: URLURTSU_NURN,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Scroll of Isildur) is NOT offered at Urlurtsu Nurn', () => {
    const state = buildSitePhaseState({
      site: URLURTSU_NURN,
      characters: [ARAGORN],
      hand: [SCROLL_OF_ISILDUR],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── Movement ────────────────────────────────────────────────────────────

  test('Edhellond starter movement reaches Urlurtsu Nurn', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (URLURTSU_NURN as string),
    );
    expect(entry).toBeDefined();
  });

  test('Rivendell starter movement does NOT reach Urlurtsu Nurn', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (URLURTSU_NURN as string),
    );
    expect(entry).toBeUndefined();
  });

  test('starter movement from Urlurtsu Nurn reaches Edhellond', () => {
    const urlurtsuNurn = pool[URLURTSU_NURN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, urlurtsuNurn, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (EDHELLOND as string),
    );
    expect(entry).toBeDefined();
  });
});
