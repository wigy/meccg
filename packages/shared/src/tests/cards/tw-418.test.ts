/**
 * @module tw-418.test
 *
 * Card test: Ost-in-Edhil (tw-418)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 0
 *
 * "Nearest Haven: Rivendell. Playable: Items (minor, gold ring).
 *  Automatic-attacks: Wolves — 3 strikes with 5 prowess."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                           |
 * |---|-------------------|--------|-------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                       |
 * | 2 | sitePath          | OK     | [wilderness, wilderness] — matches card         |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool          |
 * | 4 | playableResources | OK     | [minor, gold-ring] — matches card text          |
 * | 5 | automaticAttacks  | OK     | Wolves, 3 strikes, 5 prowess — matches card text|
 * | 6 | resourceDraws     | OK     | 1                                               |
 * | 7 | hazardDraws       | OK     | 1                                               |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                               |
 * |---|-------------------------|-------------|--------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability        | IMPLEMENTED | minor, gold-ring checked by engine  |
 * | 3 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 * | 5 | Automatic attacks       | IMPLEMENTED | combat initiated with correct stats |
 *
 * Playable: YES
 * Certified: 2026-05-10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1,
  resetMint, pool,
  buildSitePhaseState,
  dispatch,
  setupAutoAttackStep,
  viableActions, viableFor,
} from '../test-helpers.js';
import {
  RIVENDELL,
  DAGGER_OF_WESTERNESSE, GLAMDRING, PRECIOUS_GOLD_RING,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

const OST_IN_EDHIL = 'tw-418' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ost-in-Edhil (tw-418)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL,
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Ost-in-Edhil', () => {
    const state = buildSitePhaseState({
      site: OST_IN_EDHIL,
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('pass is always available during play-resources step', () => {
    const state = buildSitePhaseState({ site: OST_IN_EDHIL });
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('no resources playable when hand is empty', () => {
    const state = buildSitePhaseState({ site: OST_IN_EDHIL });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Automatic attack ─────────────────────────────────────────────────────

  test('Wolves automatic attack triggers with 3 strikes and 5 prowess', () => {
    const state = buildSitePhaseState({ site: OST_IN_EDHIL });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(5);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('reachable from Rivendell via starter movement', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(OST_IN_EDHIL);
  });

  test('Rivendell is reachable from Ost-in-Edhil via starter movement (return to nearest haven)', () => {
    const ostInEdhil = pool[OST_IN_EDHIL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, ostInEdhil, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(RIVENDELL);
  });
});
