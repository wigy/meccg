/**
 * @module tw-373.test
 *
 * Card test: Bandit Lair (tw-373)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Lórien. Playable: Items (minor, gold ring).
 *  Automatic-attacks: Men — 3 strikes with 6 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                           |
 * | 2 | sitePath          | OK     | [wilderness, shadow] — matches card                 |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool (tw-408)        |
 * | 4 | playableResources | OK     | [minor, gold-ring] — matches card text              |
 * | 5 | automaticAttacks  | OK     | Men, 3 strikes, 6 prowess — matches card text       |
 * | 6 | resourceDraws     | OK     | 1                                                   |
 * | 7 | hazardDraws       | OK     | 2                                                   |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|--------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, gold-ring checked by engine  |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Region movement         | IMPLEMENTED | sites reachable within 4 regions    |
 * | 5 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 6 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats |
 *
 * Playable: YES
 * Certified: 2026-05-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  setupAutoAttackStep,
  viableActions, viableFor,
} from '../test-helpers.js';
import {
  BANDIT_LAIR, LORIEN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, PRECIOUS_GOLD_RING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Bandit Lair (tw-373)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at Bandit Lair', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Bandit Lair', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Bandit Lair', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: BANDIT_LAIR });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Men automatic attack triggers with 3 strikes and 6 prowess', () => {
    const state = buildSitePhaseState({ site: BANDIT_LAIR });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(6);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('reachable from Lórien via starter movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(BANDIT_LAIR);
  });

  test('reachable from Lórien via region movement', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === BANDIT_LAIR,
    );

    expect(regionEntry).toBeDefined();
  });

  test('not reachable from Rivendell via starter movement', () => {
    // Bandit Lair's nearest haven is Lórien, not Rivendell.
    const allSites = Object.values(pool).filter(isSiteCard);
    const rivendell = allSites.find(s => s.name === 'Rivendell' && s.siteType === 'haven')!;
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(BANDIT_LAIR);
  });

  test('no resources playable when hand is empty', () => {
    const state = buildSitePhaseState({ site: BANDIT_LAIR });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });
});
