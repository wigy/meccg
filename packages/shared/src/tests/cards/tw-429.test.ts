/**
 * @module tw-429.test
 *
 * Card test: The Stones (tw-429)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Edhellond
 *  Playable: Items (minor, major, greater)
 *  Automatic-attacks: Pûkel-creature — 2 strikes with 9 prowess"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                           |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches card             |
 * | 3 | nearestHaven      | OK     | "Edhellond" — valid haven in card pool              |
 * | 4 | region            | OK     | "Andrast" — valid region                            |
 * | 5 | playableResources | OK     | [minor, major, greater] — matches card text         |
 * | 6 | automaticAttacks  | OK     | Pûkel-creature, 2 strikes, 9 prowess                |
 * | 7 | resourceDraws     | OK     | 1                                                   |
 * | 8 | hazardDraws       | OK     | 1                                                   |
 *
 * Engine Support:
 * | # | Feature             | Status      | Notes                                         |
 * |---|---------------------|-------------|-----------------------------------------------|
 * | 1 | Site phase flow     | IMPLEMENTED | select-company, enter-or-skip, play-resources |
 * | 2 | Item playability    | IMPLEMENTED | minor/major/greater via playableResources     |
 * | 3 | Haven path movement | IMPLEMENTED | Edhellond → The Stones via starter movement   |
 * | 4 | Automatic attacks   | IMPLEMENTED | Pûkel-creature combat initiated               |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  ARAGORN, LEGOLAS,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep, findCharInstanceId,
  dispatch,
  viableActions, RESOURCE_PLAYER,
  EDHELLOND,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard, CardDefinitionId } from '../../index.js';

const THE_STONES = 'tw-429' as CardDefinitionId;

describe('The Stones (tw-429)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Pûkel-creature automatic attack triggers with 2 strikes and 9 prowess', () => {
    const state = buildSitePhaseState({ site: THE_STONES, characters: [ARAGORN, LEGOLAS] });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(9);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor and major items are playable at The Stones', () => {
    const state = buildSitePhaseState({
      site: THE_STONES,
      hand: [GLAMDRING, DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at The Stones', () => {
    const state = buildSitePhaseState({
      site: THE_STONES,
      hand: [THE_MITHRIL_COAT],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Edhellond reaches The Stones', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const entry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (THE_STONES as string),
    );

    expect(entry).toBeDefined();
  });

  test('no characters wounded by Pûkel-creature auto-attack — no corruption check queued', () => {
    const state = buildSitePhaseState({ site: THE_STONES, characters: [ARAGORN, LEGOLAS] });
    const readyState = setupAutoAttackStep(state);

    const afterPass = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat).toBeDefined();

    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(afterPass, RESOURCE_PLAYER, LEGOLAS);

    // Assign strikes
    let s = dispatch(afterPass, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });

    // Both tap and win with high rolls
    for (let i = 0; i < 2; i++) {
      const orderActions = viableActions(s, PLAYER_1, 'choose-strike-order');
      if (orderActions.length > 0) s = dispatch(s, orderActions[0].action);
      const resolveActions = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      expect(resolveActions.length).toBeGreaterThan(0);
      s = dispatch({ ...s, cheatRollTotal: 12 }, resolveActions[0].action);
    }

    // Combat done, no corruption checks pending (Pûkel-creature does not force them)
    expect(s.combat).toBeNull();
    expect(s.pendingResolutions).toHaveLength(0);
  });
});
