/**
 * @module le-397.test
 *
 * Card test: Ost-in-Edhil (le-397)
 * Type: minion-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Darkhaven: Carn Dûm. Playable: Items (minor, gold ring).
 *  Automatic-attacks: Wolves — 3 strikes with 5 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — matches {R} in cards.json              |
 * | 2 | sitePath          | OK     | [shadow, wilderness, wilderness] — matches {s}{w}{w}        |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion haven (le-359) in card pool      |
 * | 4 | playableResources | OK     | [minor, gold-ring] — matches "Items (minor, gold ring)"     |
 * | 5 | automaticAttacks  | OK     | Wolves, 3 strikes, 5 prowess — matches card text           |
 * | 6 | resourceDraws     | OK     | 2                                                          |
 * | 7 | hazardDraws       | OK     | 2                                                          |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, gold-ring playable; major not |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | reachable within region distance    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats  |
 *
 * Playable: YES
 * Certified: 2026-06-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  viableActions,
} from '../test-helpers.js';
import {
  DAGGER_OF_WESTERNESSE, GLAMDRING, PRECIOUS_GOLD_RING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, SitePhaseState, CardDefinitionId } from '../../index.js';

const OST_IN_EDHIL_LE = 'le-397' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

// Minion items — only referenced in this test file, so declared locally
// per the `card-ids.ts` constants policy in CLAUDE.md.
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;        // minor, ringwraith, playableAt includes ruins-and-lairs
const HIGH_HELM = 'le-313' as CardDefinitionId;                // major, ringwraith, playableAt includes ruins-and-lairs
const BLACK_MACE = 'le-299' as CardDefinitionId;               // greater, ringwraith
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;      // gold-ring, ringwraith, no site restriction

describe('Ost-in-Edhil (le-397)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('minor items are playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL_LE,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL_LE,
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL_LE,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: OST_IN_EDHIL_LE });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Minion item playability ───────────────────────────────────────────────
  // Ost-in-Edhil's playable list is "Items (minor, gold ring)" — the engine
  // checks only site/subtype compatibility (and the item's own playableAt)
  // at this level, so the tests put minion items into PLAYER_1's hand to
  // verify the site's subtype gate fires correctly regardless of carrier.

  test('minor minion item (Saw-toothed Blade) is playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL_LE,
      hand: [SAW_TOOTHED_BLADE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring minion item (The Least of Gold Rings) is playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL_LE,
      hand: [LEAST_OF_GOLD_RINGS],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major minion item (High Helm) is NOT playable at Ost-in-Edhil', () => {
    // High Helm's own `playableAt` includes ruins-and-lairs, so the site is
    // compatible from the item's side. Ost-in-Edhil's `playableResources`
    // omits "major", so the site-side gate is what blocks the play.
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL_LE,
      hand: [HIGH_HELM],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  test('greater minion item (Black Mace) is NOT playable at Ost-in-Edhil', () => {
    // Ost-in-Edhil's `playableResources` omits "greater"; Black Mace's own
    // `playableAt` (shadow-hold/dark-hold) also excludes ruins-and-lairs,
    // so either gate alone is sufficient to block the play.
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL_LE,
      hand: [BLACK_MACE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── Movement to Ost-in-Edhil ──────────────────────────────────────────────

  test('reachable from Carn Dûm via starter movement', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(OST_IN_EDHIL_LE);
  });

  test('reachable from Carn Dûm via region movement', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === OST_IN_EDHIL_LE,
    );

    expect(regionEntry).toBeDefined();
    // Angmar (Carn Dûm) → Hollin (Ost-in-Edhil) = 3 regions traversed.
    expect(regionEntry!.regionDistance).toBe(3);
  });

  test('not reachable from Minas Morgul via starter movement', () => {
    // Ost-in-Edhil's nearest darkhaven is Carn Dûm, not Minas Morgul.
    const allSites = Object.values(pool).filter(isSiteCard);
    const minasMorgul = allSites.find(
      s => s.name === 'Minas Morgul' && s.siteType === 'haven',
    )!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(OST_IN_EDHIL_LE);
  });

  // ─── Automatic attacks ──────────────────────────────────────────────────────

  test('Wolves automatic attack triggers with 3 strikes and 5 prowess', () => {
    const state = buildSitePhaseState({ site: OST_IN_EDHIL_LE });
    const autoAttackState: SitePhaseState = {
      ...state.phaseState,
      step: 'automatic-attacks',
      siteEntered: false,
      automaticAttacksResolved: 0,
    };
    const readyState = { ...state, phaseState: autoAttackState };

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(5);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });
});
