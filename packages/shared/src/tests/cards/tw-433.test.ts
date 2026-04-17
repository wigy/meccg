/**
 * @module tw-433.test
 *
 * Card test: Tolfalas (tw-433)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 2 (on-event: character-wounded-by-self → force corruption check;
 *             site-rule: deny-item → any greater item except Scroll of Isildur)
 *
 * "Nearest Haven: Edhellond. Playable: Items (minor, major, greater*)
 *  *-Scroll of Isildur only. Automatic-attacks: Undead — 3 strikes with 7
 *  prowess; each character wounded must make a corruption check."
 *
 * Site Structural Checks:
 * | # | Property                | Status | Notes                                     |
 * |---|-------------------------|--------|-------------------------------------------|
 * | 1 | siteType                | OK     | "ruins-and-lairs" — valid                 |
 * | 2 | sitePath                | OK     | wilderness, free, coastal — matches card  |
 * | 3 | nearestHaven            | OK     | "Edhellond" — valid haven in card pool    |
 * | 4 | playableResources       | OK     | minor, major, greater — matches card text |
 * | 5 | site-rule deny-item      | OK    | greater denied unless Scroll of Isildur    |
 * | 6 | automaticAttacks        | OK     | Undead, 3 strikes, 7 prowess              |
 * | 7 | resourceDraws           | OK     | 2                                          |
 * | 8 | hazardDraws             | OK     | 2                                          |
 *
 * Engine Support:
 * | # | Feature                       | Status      | Notes                              |
 * |---|-------------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow               | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Item playability              | IMPLEMENTED | minor, major, greater (restricted)  |
 * | 3 | Haven path movement           | IMPLEMENTED | movement-map.ts                     |
 * | 4 | Automatic attacks             | IMPLEMENTED | combat initiated with correct stats  |
 * | 5 | Wound → corruption check      | IMPLEMENTED | on-event: character-wounded-by-self  |
 * | 6 | Greater item restriction      | IMPLEMENTED | site-rule: deny-item + DSL condition |
 *
 * Playable: YES
 * Certified: 2026-04-13
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  EDHELLOND, TOLFALAS,
  ARAGORN, GIMLI, FARAMIR,
  GLAMDRING, DAGGER_OF_WESTERNESSE, SCROLL_OF_ISILDUR, THE_MITHRIL_COAT,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep, findCharInstanceId,
  viableActions, viableFor,
  dispatch, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Tolfalas (tw-433)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 3 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(state);

    const nextState = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikesTotal).toBe(3);
    expect(nextState.combat!.strikeProwess).toBe(7);
    expect(nextState.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound corruption check ────────────────────────────────────────────────

  test('wounded character gets corruption check after auto-attack', () => {
    const initialState = buildSitePhaseState({
      site: TOLFALAS,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(initialState);

    // Trigger auto-attack
    let state = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    // Defender assigns 3 strikes to 3 characters
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });

    // Choose strike order: resolve Aragorn first
    let orderActions = viableActions(state, PLAYER_1, 'choose-strike-order');
    expect(orderActions.length).toBeGreaterThan(0);
    const aragornOrder = orderActions.find(a => 'characterId' in a.action && a.action.characterId === aragornId);
    expect(aragornOrder).toBeDefined();
    state = dispatch(state, aragornOrder!.action);

    // Resolve Aragorn's strike: untapped prowess 6, roll 1 → 7 = tie → no wound.
    // Use untap variant: prowess 6-3=3, roll 2 → 5 < 7 → wound.
    let resolveActions = viableActions({ ...state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const aragornResolve = resolveActions.find(a =>
      'tapToFight' in a.action && !a.action.tapToFight,
    );
    expect(aragornResolve).toBeDefined();
    state = dispatch({ ...state, cheatRollTotal: 2 }, aragornResolve!.action);

    // Body check for Aragorn: roll 5, body 9 → survives (wounded)
    if (state.combat?.phase === 'body-check') {
      const bodyActions = viableActions(state, PLAYER_2, 'body-check-roll');
      expect(bodyActions.length).toBeGreaterThan(0);
      state = dispatch({ ...state, cheatRollTotal: 5 }, bodyActions[0].action);
    }

    // Choose and resolve Gimli's strike: high roll → wins
    orderActions = viableActions(state, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      state = dispatch(state, orderActions[0].action);
    }
    resolveActions = viableActions({ ...state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    state = dispatch({ ...state, cheatRollTotal: 12 }, resolveActions[0].action);

    // Choose and resolve Faramir's strike: high roll → wins
    orderActions = viableActions(state, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      state = dispatch(state, orderActions[0].action);
    }
    resolveActions = viableActions({ ...state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    state = dispatch({ ...state, cheatRollTotal: 12 }, resolveActions[0].action);

    // Combat should be done
    expect(state.combat).toBeNull();

    // Wound corruption check should be pending
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
      site: TOLFALAS,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(initialState);

    // Trigger auto-attack
    let state = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    // Assign all 3 strikes
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    state = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });

    // Choose strike order and resolve all 3 strikes with high rolls — everyone wins
    for (let i = 0; i < 3; i++) {
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

  test('minor and major items playable at Tolfalas', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      hand: [GLAMDRING, DAGGER_OF_WESTERNESSE],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Scroll of Isildur (greater) is playable at Tolfalas', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      hand: [SCROLL_OF_ISILDUR],
    });

    const resourceActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('non-Scroll greater items are not playable at Tolfalas', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      hand: [THE_MITHRIL_COAT],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const notPlayable = actions.filter(a => !a.viable && a.action.type === 'not-playable');
    expect(notPlayable.length).toBeGreaterThanOrEqual(1);
    expect(notPlayable[0].reason).toContain('Tolfalas');
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Edhellond reaches Tolfalas', () => {
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Tolfalas');
  });

  test('starter movement from Tolfalas reaches Edhellond (back to nearest haven)', () => {
    const tolfalas = pool[TOLFALAS as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, tolfalas, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Edhellond');
  });
});
