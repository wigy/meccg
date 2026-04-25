/**
 * @module tw-409.test
 *
 * Card test: Lossadan Cairn (tw-409)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 2 (on-event: character-wounded-by-self → force corruption check;
 *             site-rule: deny-item → any special item without "palantir" keyword)
 *
 * "Nearest Haven: Rivendell. Playable: Items (minor, major, greater*),
 *  *—Palantíri Only. Automatic-attacks: Undead — 2 strikes with 8 prowess;
 *  each character wounded must make a corruption check."
 *
 * Site Structural Checks:
 * | # | Property                | Status | Notes                                        |
 * |---|-------------------------|--------|----------------------------------------------|
 * | 1 | siteType                | OK     | "ruins-and-lairs" — valid                    |
 * | 2 | sitePath                | OK     | wilderness×3 — matches card                  |
 * | 3 | nearestHaven            | OK     | "Rivendell" — valid haven in card pool       |
 * | 4 | playableResources       | OK     | minor, major, special (Palantíri are special)|
 * | 5 | site-rule deny-item     | OK     | special items denied unless palantir keyword |
 * | 6 | automaticAttacks        | OK     | Undead, 2 strikes, 8 prowess                 |
 * | 7 | resourceDraws           | OK     | 2                                             |
 * | 8 | hazardDraws             | OK     | 2                                             |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                                |
 * |---|-------------------------------|-------------|--------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, etc.  |
 * | 2 | Item playability              | IMPLEMENTED | minor, major, special (restricted)   |
 * | 3 | Haven path movement           | IMPLEMENTED | movement-map.ts                      |
 * | 4 | Automatic attacks             | IMPLEMENTED | combat initiated with correct stats  |
 * | 5 | Wound → corruption check      | IMPLEMENTED | on-event: character-wounded-by-self  |
 * | 6 | Special item restriction      | IMPLEMENTED | site-rule: deny-item + DSL condition |
 *
 * Playable: YES
 * Certified: 2026-04-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RIVENDELL,
  ARAGORN, GIMLI, FARAMIR,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep, findCharInstanceId,
  viableActions, viableFor,
  dispatch, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { CardDefinitionId, SiteCard } from '../../index.js';

const LOSSADAN_CAIRN = 'tw-409' as CardDefinitionId;
const LESSER_RING = 'tw-266' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Lossadan Cairn (tw-409)', () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 2 strikes and 8 prowess', () => {
    const state = buildSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(2);
    expect(nextState.combat!.strikeProwess).toBe(8);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound corruption check ────────────────────────────────────────────────

  test('wounded character gets corruption check after auto-attack', () => {
    const initialState = buildSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [ARAGORN, GIMLI],
    });
    const readyState = setupAutoAttackStep(initialState);

    // Trigger auto-attack
    let state = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    // Defender assigns 2 strikes to 2 characters
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });

    // Choose strike order: resolve Aragorn first
    let orderActions = viableActions(state, PLAYER_1, 'choose-strike-order');
    expect(orderActions.length).toBeGreaterThan(0);
    const aragornOrder = orderActions.find(a => 'characterId' in a.action && a.action.characterId === aragornId);
    expect(aragornOrder).toBeDefined();
    state = dispatch(state, aragornOrder!.action);

    // Resolve Aragorn's strike without tapping: prowess 6-3=3, roll 2 → 5 < 8 → wound
    const resolveActions = viableActions({ ...state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const aragornResolve = resolveActions.find(a => 'tapToFight' in a.action && !a.action.tapToFight);
    expect(aragornResolve).toBeDefined();
    state = dispatch({ ...state, cheatRollTotal: 2 }, aragornResolve!.action);

    // Body check for Aragorn: roll 5, body 9 → survives (wounded)
    if (state.combat?.phase === 'body-check') {
      const bodyActions = viableActions(state, PLAYER_2, 'body-check-roll');
      expect(bodyActions.length).toBeGreaterThan(0);
      state = dispatch({ ...state, cheatRollTotal: 5 }, bodyActions[0].action);
    }

    // Resolve Gimli's strike with a high roll → wins
    orderActions = viableActions(state, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      state = dispatch(state, orderActions[0].action);
    }
    const gimliResolve = viableActions({ ...state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(gimliResolve.length).toBeGreaterThan(0);
    state = dispatch({ ...state, cheatRollTotal: 12 }, gimliResolve[0].action);

    // Combat should be done
    expect(state.combat).toBeNull();

    // Wound corruption check should be pending for Aragorn
    const pending = state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);

    const viable = viableFor(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('characters that win auto-attack strikes do not get corruption check', () => {
    const initialState = buildSitePhaseState({
      site: LOSSADAN_CAIRN,
      characters: [ARAGORN, GIMLI],
    });
    const readyState = setupAutoAttackStep(initialState);

    // Trigger auto-attack
    let state = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    // Assign both strikes
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });

    // Resolve both strikes with high rolls — everyone wins
    for (let i = 0; i < 2; i++) {
      const orderActions = viableActions(state, PLAYER_1, 'choose-strike-order');
      if (orderActions.length > 0) {
        state = dispatch(state, orderActions[0].action);
      }
      const resolveActions = viableActions({ ...state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      expect(resolveActions.length).toBeGreaterThan(0);
      state = dispatch({ ...state, cheatRollTotal: 12 }, resolveActions[0].action);
    }

    // Combat done, no corruption checks
    expect(state.combat).toBeNull();
    expect(state.pendingResolutions).toHaveLength(0);

    const viable = viableFor(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor and major items are playable at Lossadan Cairn', () => {
    const state = buildSitePhaseState({
      site: LOSSADAN_CAIRN,
      hand: [GLAMDRING, DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('non-Palantír special items are denied at Lossadan Cairn', () => {
    // Lesser Ring has subtype "special" and no "palantir" keyword
    const state = buildSitePhaseState({
      site: LOSSADAN_CAIRN,
      hand: [LESSER_RING],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const notPlayable = actions.filter(a => !a.viable && a.action.type === 'not-playable');
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
    expect(notPlayable[0].reason).toContain('Lossadan Cairn');
  });

  test('greater (non-special) items are not playable at Lossadan Cairn', () => {
    // The Mithril-coat has subtype "greater" which is not in playableResources
    const state = buildSitePhaseState({
      site: LOSSADAN_CAIRN,
      hand: [THE_MITHRIL_COAT],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const notPlayable = actions.filter(a => !a.viable && a.action.type === 'not-playable');
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Rivendell reaches Lossadan Cairn', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Lossadan Cairn');
  });

  test('starter movement from Lossadan Cairn reaches Rivendell (nearest haven)', () => {
    const lossadanCairn = pool[LOSSADAN_CAIRN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lossadanCairn, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Rivendell');
  });
});
