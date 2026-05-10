/**
 * @module tw-371.test
 *
 * Card test: Amon Hen (tw-371)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 1 (on-event: character-wounded-by-self → force corruption check)
 *
 * "Nearest Haven: Lórien
 *  Playable: Information, Items (minor)
 *  Automatic-attacks: Undead — 1 strike with 6 prowess;
 *  each character wounded must make a corruption check"
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                         |
 * |---|-------------------|--------|-----------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                     |
 * | 2 | sitePath          | OK     | wilderness, border — matches card              |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool            |
 * | 4 | playableResources | OK     | information, minor — matches card text         |
 * | 5 | automaticAttacks  | OK     | Undead, 1 strike, 6 prowess                   |
 * | 6 | resourceDraws     | OK     | 1                                             |
 * | 7 | hazardDraws       | OK     | 1                                             |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                              |
 * |---|-------------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability              | IMPLEMENTED | minor checked                       |
 * | 3 | Haven path movement           | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Automatic attacks             | IMPLEMENTED | combat initiated with correct stats  |
 * | 5 | Wound → corruption check      | IMPLEMENTED | on-event: character-wounded-by-self  |
 *
 * Playable: YES
 * Certified: 2026-05-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  LORIEN,
  ARAGORN, EOWYN, DAGGER_OF_WESTERNESSE,
  resetMint, pool, CardStatus,
  buildSitePhaseState, setupAutoAttackStep, findCharInstanceId,
  runAutoAttackCombat,
  dispatch, expectCharStatus,
  viableFor, viableActions, RESOURCE_PLAYER,
  expectCharNotInPlay,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const AMON_HEN = 'tw-371' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Amon Hen (tw-371)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 1 strike and 6 prowess', () => {
    const state = buildSitePhaseState({ site: AMON_HEN });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(1);
    expect(nextState.combat!.strikeProwess).toBe(6);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound corruption check ────────────────────────────────────────────────

  test('wounded character gets corruption check after auto-attack', () => {
    const state = buildSitePhaseState({ site: AMON_HEN });
    const readyState = setupAutoAttackStep(state);

    // Stay untapped: prowess 6-3=3, roll 2 → 2+3=5 < 6 → wounded. Body check pass (5 <= 9).
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
    const state = buildSitePhaseState({ site: AMON_HEN });
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
    // Use Éowyn (prowess 2, corruptionModifier 0) with two Daggers to achieve 2 CP.
    // Amon Hen's Undead has prowess 6. Éowyn untapped: prowess 2+1+1(Daggers)-3(untap)=1.
    // Roll 2 + 1 = 3 < 6 → wounded. CP = 1 + 1 = 2, modifier 0.
    // Corruption check: roll 2 NOT > 2 → fails.
    const state = buildSitePhaseState({
      site: AMON_HEN,
      characters: [{ defId: EOWYN, items: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE] }],
    });
    const readyState = setupAutoAttackStep(state);

    // Wound Éowyn (roll 2 → total 3 < creature prowess 6)
    const result = runAutoAttackCombat(readyState, EOWYN, 2, 5, false);

    // Get the corruption check action
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check')[0].action;
    expect(ccAction.type).toBe('corruption-check');

    // Force low roll to fail corruption check (CP 2, modifier 0; roll 2 NOT > 2 → fail)
    const ccState = dispatch({ ...result.state, cheatRollTotal: 2 }, ccAction);

    // Character should be discarded or eliminated
    expect(ccState.pendingResolutions).toHaveLength(0);
    const eowynId = findCharInstanceId(result.state, RESOURCE_PLAYER, EOWYN);
    expectCharNotInPlay(ccState, RESOURCE_PLAYER, eowynId);
  });

  test('character that wins auto-attack strike does not get corruption check', () => {
    const state = buildSitePhaseState({ site: AMON_HEN });
    const readyState = setupAutoAttackStep(state);

    // High strike roll → Aragorn wins (roll 10 + prowess 6 = 16 > 6)
    const result = runAutoAttackCombat(readyState, ARAGORN, 10, null);
    expect(result.state.combat).toBeNull();

    // No corruption check should be pending
    expect(result.state.pendingResolutions).toHaveLength(0);

    // Normal automatic-attacks step resumes
    const viable = viableFor(result.state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor items playable at Amon Hen', () => {
    const state = buildSitePhaseState({
      site: AMON_HEN,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement ────────────────────────────────────────────────────────────

  test('starter movement from Lórien reaches Amon Hen', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Amon Hen');
  });

  test('starter movement from Amon Hen reaches Lórien (back to nearest haven)', () => {
    const amonHen = pool[AMON_HEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, amonHen, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Lórien');
  });
});
