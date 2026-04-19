/**
 * @module le-350.test
 *
 * Card test: Bag End (le-350)
 * Type: minion-site (free-hold)
 * Effects: 1 (site-rule: deny-item → non-wizard greater items)
 *
 * "Nearest Darkhaven: Carn Dûm.
 *  Playable: Information, Items (minor, major, greater*, gold ring) *—hero item only.
 *  Automatic-attacks (2): (1st) Hobbits — 5 strikes with 5 prowess;
 *                         (2nd) Dúnedain — 3 strikes with 11 prowess."
 *
 * The "*—hero item only" footnote is encoded as a `site-rule: deny-item` effect
 * that blocks any greater item whose alignment is not `wizard`. All current
 * non-wizard greater items (The Arkenstone, Thong of Fire) are also hoard
 * items whose own `item-play-site` restriction blocks them at Bag End before
 * the deny-item rule fires — so the deny-item rule is correct in principle
 * but has no observable effect against today's card pool. Its engine path
 * is exercised by Tolfalas (tw-433).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "free-hold" — valid                                     |
 * | 2 | sitePath          | OK     | [shadow, wilderness, free] — 3 regions                  |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven in card pool            |
 * | 4 | playableResources | OK     | information, minor, major, greater, gold-ring           |
 * | 5 | automaticAttacks  | OK     | Hobbits 5/5 then Dúnedain 3/11                          |
 * | 6 | resourceDraws     | OK     | 1                                                       |
 * | 7 | hazardDraws       | OK     | 3                                                       |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                                          |
 * |---|-------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, etc.            |
 * | 2 | Item playability              | IMPLEMENTED | minor, major, greater (restricted), gold-ring  |
 * | 3 | Haven path movement           | IMPLEMENTED | Carn Dûm ↔ Bag End via starter movement        |
 * | 4 | Automatic attacks (2)         | IMPLEMENTED | Hobbits 5/5 then Dúnedain 3/11                 |
 * | 5 | Greater-hero-only restriction | IMPLEMENTED | site-rule: deny-item via alignment filter      |
 *
 * Playable: YES
 * Certified: 2026-04-19
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions,
  dispatch,
} from '../test-helpers.js';
import {
  BAG_END_LE, CARN_DUM,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

describe('Bag End (le-350)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attacks (2) ──────────────────────────────────────────────────

  test('first automatic attack: Hobbits — 5 strikes with 5 prowess', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(5);
    expect(next.combat!.strikeProwess).toBe(5);
    expect(next.combat!.creatureRace).toBe('hobbit');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  test('second automatic attack: Dúnedain — 3 strikes with 11 prowess', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    let s = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(s.combat!.creatureRace).toBe('hobbit');
    s = { ...s, combat: null };

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikesTotal).toBe(3);
    expect(s.combat!.strikeProwess).toBe(11);
    expect(s.combat!.creatureRace).toBe('dunadan');
  });

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor hero item (Dagger of Westernesse) is playable at Bag End', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major hero item (Glamdring) is playable at Bag End', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      hand: [GLAMDRING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater hero item (The Mithril-coat) is playable at Bag End', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      hand: [THE_MITHRIL_COAT],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring hero item (Precious Gold Ring) is playable at Bag End', () => {
    const state = buildSitePhaseState({
      site: BAG_END_LE,
      hand: [PRECIOUS_GOLD_RING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement ──────────────────────────────────────────────────────────────

  test('starter movement from Carn Dûm reaches Bag End', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter' && r.site.id === BAG_END_LE)
      .map(r => r.site.name);

    expect(starterNames).toContain('Bag End');
  });

  test('starter movement from Bag End reaches Carn Dûm (back to nearest darkhaven)', () => {
    const bagEnd = pool[BAG_END_LE as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, bagEnd, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter' && r.site.id === CARN_DUM)
      .map(r => r.site.name);

    expect(starterNames).toContain('Carn Dûm');
  });
});
