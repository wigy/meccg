/**
 * @module tw-375.test
 *
 * Card test: Barrow-downs (tw-375)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 1 (on-event: character-wounded-by-self → force corruption check)
 *
 * "Playable: Items (minor, major). Automatic-attacks: Undead — 1 strike
 *  with 8 prowess; each character wounded must make a corruption check."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                         |
 * |---|-------------------|--------|-----------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                     |
 * | 2 | sitePath          | OK     | wilderness, wilderness — matches card          |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool         |
 * | 4 | playableResources | OK     | minor, major — matches card text               |
 * | 5 | automaticAttacks  | OK     | Undead, 1 strike, 8 prowess                    |
 * | 6 | resourceDraws     | OK     | 1                                              |
 * | 7 | hazardDraws       | OK     | 2                                              |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                              |
 * |---|-------------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability              | IMPLEMENTED | minor, major checked                |
 * | 3 | Haven path movement           | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Automatic attacks             | IMPLEMENTED | combat initiated with correct stats  |
 * | 5 | Wound → corruption check      | IMPLEMENTED | on-event: character-wounded-by-self  |
 *
 * Playable: YES
 * Certified: 2026-04-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RIVENDELL,
  ARAGORN, GLAMDRING, DAGGER_OF_WESTERNESSE,
  resetMint, pool, CardStatus,
  buildSitePhaseState, setupAutoAttackStep, findCharInstanceId,
  runAutoAttackCombat,
  dispatch, expectCharStatus,
  viableFor, viableActions, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  BARROW_DOWNS,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Barrow-downs (tw-375)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 1 strike and 8 prowess', () => {
    const state = buildSitePhaseState({ site: BARROW_DOWNS });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound corruption check ────────────────────────────────────────────────

  test('wounded character gets corruption check after auto-attack', () => {
    const state = buildSitePhaseState({ site: BARROW_DOWNS });
    const readyState = setupAutoAttackStep(state);

    // Stay untapped: prowess 6-3=3, roll 2 → 2+3=5 < 8 → wounded. Body check pass (5 <= 9).
    const result = runAutoAttackCombat(readyState, ARAGORN, 2, 5, false);
    expect(result.state.combat).toBeNull();

    // Wound corruption check should be pending in the unified queue
    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;

    const aragornId = findCharInstanceId(result.state, RESOURCE_PLAYER, ARAGORN);
    expect(pending[0].kind.characterId).toBe(aragornId);

    // Legal actions should offer corruption-check
    const viable = viableFor(result.state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('corruption check after wound passes with high roll', () => {
    const state = buildSitePhaseState({ site: BARROW_DOWNS });
    const readyState = setupAutoAttackStep(state);

    // Wound Aragorn
    const result = runAutoAttackCombat(readyState, ARAGORN, 2, 5, false);

    // Get the corruption check action
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;

    // Force high roll to pass corruption check (Aragorn has 0 CP with no items)
    const ccState = dispatch({ ...result.state, cheatRollTotal: 12 }, ccAction);

    // Corruption check passed — character still in play, queue cleared
    expect(ccState.pendingResolutions).toHaveLength(0);

    expectCharStatus(ccState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('corruption check after wound fails — character discarded', () => {
    // Give Aragorn items so he has corruption points
    const state = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }],
    });
    const readyState = setupAutoAttackStep(state);

    // Wound Aragorn
    const result = runAutoAttackCombat(readyState, ARAGORN, 2, 5, false);

    // Get the corruption check action
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    expect(ccAction.type).toBe('corruption-check');

    // Force low roll to fail corruption check
    // Aragorn + Glamdring (2 CP) + Dagger (1 CP) = 3 CP total
    // Roll of 2 + modifier → total <= CP means fail
    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    // Character should be discarded or eliminated
    expect(ccState.pendingResolutions).toHaveLength(0);
    const aragornId = findCharInstanceId(result.state, RESOURCE_PLAYER, ARAGORN);
    expect(ccState.players[0].characters[aragornId as string]).toBeUndefined();
  });

  test('character that wins auto-attack strike does not get corruption check', () => {
    const state = buildSitePhaseState({ site: BARROW_DOWNS });
    const readyState = setupAutoAttackStep(state);

    // High strike roll → Aragorn wins (roll 10 + prowess 6 = 16 > 8)
    const result = runAutoAttackCombat(readyState, ARAGORN, 10, null);
    expect(result.state.combat).toBeNull();

    // No corruption check should be pending
    expect(result.state.pendingResolutions).toHaveLength(0);

    // Normal automatic-attacks step resumes
    const viable = viableFor(result.state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor and major items playable at Barrow-downs', () => {
    const state = buildSitePhaseState({
      site: BARROW_DOWNS,
      hand: [GLAMDRING, DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Rivendell reaches Barrow-downs', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Barrow-downs');
  });

  test('starter movement from Barrow-downs reaches Rivendell (back to nearest haven)', () => {
    const barrowDowns = pool[BARROW_DOWNS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, barrowDowns, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Rivendell');
  });
});
