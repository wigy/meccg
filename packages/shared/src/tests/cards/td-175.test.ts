/**
 * @module td-175.test
 *
 * Card test: Framsburg (td-175)
 * Type: hero-site (ruins-and-lairs) in Anduin Vales
 * Effects: 0 (special rule defers to an unimplemented engine mechanic)
 *
 * Text:
 *   Nearest Haven: Lórien.
 *   Playable: Items (minor).
 *   Automatic-attacks: When a company enters this site, opponent may play
 *     one creature from his hand that is treated in all ways as the site's
 *     automatic-attack (if defeated, creature is discarded). It must
 *     normally be playable keyed to a Ruins & Lairs [{R}], Shadow-hold
 *     [{S}], single Wilderness [{w}], or Shadow-land [{s}].
 *   Special: Contains a hoard.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                       |
 * |---|-------------------|--------|-------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                   |
 * | 2 | sitePath          | OK     | [wilderness, border] — matches {w}{b}                       |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                         |
 * | 4 | region            | OK     | "Anduin Vales" — valid region adjacent to Wold & Foothills  |
 * | 5 | playableResources | OK     | [minor] — matches card text                                 |
 * | 6 | automaticAttacks  | OK     | empty — dynamic auto-attack deferred (see special rule)     |
 * | 7 | resourceDraws     | OK     | 1                                                           |
 * | 8 | hazardDraws       | OK     | 2                                                           |
 * | 9 | keywords          | OK     | ["hoard"] — "Contains a hoard" / gates hoard items          |
 *
 * Engine Support:
 * | # | Feature                          | Status          | Notes                                                 |
 * |---|----------------------------------|-----------------|-------------------------------------------------------|
 * | 1 | Site phase flow                  | IMPLEMENTED     | select-company, enter-or-skip, play-resources         |
 * | 2 | Item playability (minor)         | IMPLEMENTED     | minor allowed; major/greater/gold-ring rejected       |
 * | 3 | Hoard keyword gating             | IMPLEMENTED     | site.keywords $includes "hoard" allows hoard items    |
 * | 4 | Haven path movement              | IMPLEMENTED     | movement-map.ts resolves nearestHaven ↔ Lórien        |
 * | 5 | Region movement                  | IMPLEMENTED     | Anduin Vales adjacent to Wold & Foothills → dist 2    |
 * | 6 | Card draws                       | IMPLEMENTED     | resourceDraws 1 / hazardDraws 2                       |
 * | 7 | Dynamic opponent-chosen          | NOT IMPLEMENTED | engine has no mechanic for the hazard player to       |
 * |   | auto-attack from hand            |                 | play a hand creature as the site's auto-attack with   |
 * |   |                                  |                 | the {R}/{S}/{w}/{s} keying filter. `automaticAttacks` |
 * |   |                                  |                 | is empty; company currently enters without a forced   |
 * |   |                                  |                 | attack. Revisit when the engine supports              |
 * |   |                                  |                 | player-authored auto-attacks from hand.               |
 *
 * Playable: YES — no DSL effects are required for the current engine.
 *   The dynamic auto-attack rule is deferred to a future engine feature.
 *
 * Certified: 2026-04-21
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

const FRAMSBURG = 'td-175' as CardDefinitionId;
const ADAMANT_HELMET = 'td-96' as CardDefinitionId;

describe('Framsburg (td-175)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Framsburg (only minor allowed)', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('greater items are NOT playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('gold-ring items are NOT playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('hoard minor item (Adamant Helmet) is playable at Framsburg (site contains a hoard)', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: FRAMSBURG });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('no fixed automatic attack fires at Framsburg (dynamic auto-attack unimplemented)', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });

  // ─── Movement: Lórien → Framsburg ───────────────────────────────────────────

  test('starter movement from Lórien reaches Framsburg', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (FRAMSBURG as string),
    );

    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Rivendell does NOT reach Framsburg', () => {
    // Framsburg's nearestHaven is Lórien, so Rivendell's starter movement
    // should not include it.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (FRAMSBURG as string),
    );

    expect(starterEntry).toBeUndefined();
  });

  // ─── Movement: Framsburg → Lórien ───────────────────────────────────────────

  test('starter movement from Framsburg reaches Lórien', () => {
    const framsburg = pool[FRAMSBURG as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, framsburg, allSites);
    const starterLorien = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );

    expect(starterLorien).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Lórien reaches Framsburg (Anduin Vales adjacent to Wold & Foothills)', () => {
    // Lórien is in Wold & Foothills; Framsburg is in Anduin Vales — adjacent
    // regions → 1 edge → regionDistance === 2.
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (FRAMSBURG as string),
    );

    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });
});
