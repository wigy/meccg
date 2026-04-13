/**
 * @module tw-433.test
 *
 * Card test: Tolfalas (tw-433)
 * Type: hero-site (ruins-and-lairs)
 * Effects: 2 (on-event: character-wounded-by-self → force corruption check;
 *             site-rule: restrict-item-subtype → greater limited to Scroll of Isildur)
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
 * | 5 | site-rule restriction    | OK    | greater restricted to Scroll of Isildur   |
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
 * | 6 | Greater item restriction      | IMPLEMENTED | site-rule: restrict-item-subtype     |
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
  resetMint, pool, reduce,
  buildSitePhaseState, setupAutoAttackStep, findCharInstanceId,
  viableActions,
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

  test('is a ruins-and-lairs with correct structural properties', () => {
    const def = pool[TOLFALAS as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('ruins-and-lairs');
    expect(def.sitePath).toEqual(['wilderness', 'free', 'coastal']);
    expect(def.nearestHaven).toBe('Edhellond');
    expect(def.region).toBe('Mouths of the Anduin');
    expect(def.playableResources).toEqual(['minor', 'major', 'greater']);
    expect(def.automaticAttacks).toEqual([
      { creatureType: 'Undead', strikes: 3, prowess: 7 },
    ]);
    expect(def.resourceDraws).toBe(2);
    expect(def.hazardDraws).toBe(2);
  });

  test('has on-event character-wounded-by-self effect', () => {
    const def = pool[TOLFALAS as string];
    if (!isSiteCard(def)) return;

    expect(def.effects).toBeDefined();
    expect(def.effects).toHaveLength(2);
    expect(def.effects![0]).toEqual({
      type: 'on-event',
      event: 'character-wounded-by-self',
      apply: { type: 'force-check', check: 'corruption' },
      target: 'wounded-character',
    });
  });

  test('has site-rule restrict-item-subtype effect limiting greater to Scroll of Isildur', () => {
    const def = pool[TOLFALAS as string];
    if (!isSiteCard(def)) return;

    expect(def.effects).toBeDefined();
    expect(def.effects![1]).toEqual({
      type: 'site-rule',
      rule: 'restrict-item-subtype',
      subtype: 'greater',
      allowedNames: ['Scroll of Isildur'],
    });
  });

  test('nearestHaven Edhellond exists in card pool', () => {
    const edhellond = pool[EDHELLOND as string];
    expect(edhellond).toBeDefined();
    expect(isSiteCard(edhellond)).toBe(true);
    if (!isSiteCard(edhellond)) return;
    expect(edhellond.siteType).toBe('haven');
  });

  test('site path has valid region types', () => {
    const def = pool[TOLFALAS as string];
    if (!isSiteCard(def)) return;

    const validRegionTypes = [
      'wilderness', 'border', 'free', 'coastal', 'shadow', 'dark',
      'double-wilderness', 'double-shadow-land', 'double-coastal-sea',
    ];
    for (const region of def.sitePath) {
      expect(validRegionTypes).toContain(region);
    }
  });

  // ─── Automatic attack ──────────────────────────────────────────────────────

  test('Undead automatic attack triggers with 3 strikes and 7 prowess', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(state);

    const result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    expect(result.state.combat!.strikesTotal).toBe(3);
    expect(result.state.combat!.strikeProwess).toBe(7);
    expect(result.state.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Wound corruption check ────────────────────────────────────────────────

  test('wounded character gets corruption check after auto-attack', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(state);

    // Trigger auto-attack
    let result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const aragornId = findCharInstanceId(result.state, 0, ARAGORN);
    const gimliId = findCharInstanceId(result.state, 0, GIMLI);
    const faramirId = findCharInstanceId(result.state, 0, FARAMIR);

    // Defender assigns 3 strikes to 3 characters
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });
    expect(result.error).toBeUndefined();

    // Choose strike order: resolve Aragorn first
    let orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
    expect(orderActions.length).toBeGreaterThan(0);
    const aragornOrder = orderActions.find(a => 'characterId' in a.action && a.action.characterId === aragornId);
    expect(aragornOrder).toBeDefined();
    result = reduce(result.state, aragornOrder!.action);
    expect(result.error).toBeUndefined();

    // Resolve Aragorn's strike: untapped prowess 6, roll 1 → 7 = tie → no wound.
    // Use untap variant: prowess 6-3=3, roll 2 → 5 < 7 → wound.
    let resolveActions = viableActions({ ...result.state, cheatRollTotal: 2 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const aragornResolve = resolveActions.find(a =>
      'tapToFight' in a.action && !a.action.tapToFight,
    );
    expect(aragornResolve).toBeDefined();
    result = reduce({ ...result.state, cheatRollTotal: 2 }, aragornResolve!.action);
    expect(result.error).toBeUndefined();

    // Body check for Aragorn: roll 5, body 9 → survives (wounded)
    if (result.state.combat?.phase === 'body-check') {
      const bodyActions = viableActions(result.state, PLAYER_2, 'body-check-roll');
      expect(bodyActions.length).toBeGreaterThan(0);
      result = reduce({ ...result.state, cheatRollTotal: 5 }, bodyActions[0].action);
      expect(result.error).toBeUndefined();
    }

    // Choose and resolve Gimli's strike: high roll → wins
    orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      result = reduce(result.state, orderActions[0].action);
      expect(result.error).toBeUndefined();
    }
    resolveActions = viableActions({ ...result.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    result = reduce({ ...result.state, cheatRollTotal: 12 }, resolveActions[0].action);
    expect(result.error).toBeUndefined();

    // Choose and resolve Faramir's strike: high roll → wins
    orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
    if (orderActions.length > 0) {
      result = reduce(result.state, orderActions[0].action);
      expect(result.error).toBeUndefined();
    }
    resolveActions = viableActions({ ...result.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    result = reduce({ ...result.state, cheatRollTotal: 12 }, resolveActions[0].action);
    expect(result.error).toBeUndefined();

    // Combat should be done
    expect(result.state.combat).toBeNull();

    // Wound corruption check should be pending
    const pending = result.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);

    const actions = computeLegalActions(result.state, PLAYER_1);
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('characters that win auto-attack strikes do not get corruption check', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      characters: [ARAGORN, GIMLI, FARAMIR],
    });
    const readyState = setupAutoAttackStep(state);

    // Trigger auto-attack
    let result = reduce(readyState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const aragornId = findCharInstanceId(result.state, 0, ARAGORN);
    const gimliId = findCharInstanceId(result.state, 0, GIMLI);
    const faramirId = findCharInstanceId(result.state, 0, FARAMIR);

    // Assign all 3 strikes
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: gimliId });
    expect(result.error).toBeUndefined();
    result = reduce(result.state, { type: 'assign-strike', player: PLAYER_1, characterId: faramirId });
    expect(result.error).toBeUndefined();

    // Choose strike order and resolve all 3 strikes with high rolls — everyone wins
    for (let i = 0; i < 3; i++) {
      const orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
      if (orderActions.length > 0) {
        result = reduce(result.state, orderActions[0].action);
        expect(result.error).toBeUndefined();
      }
      const resolveActions = viableActions({ ...result.state, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      expect(resolveActions.length).toBeGreaterThan(0);
      result = reduce({ ...result.state, cheatRollTotal: 12 }, resolveActions[0].action);
      expect(result.error).toBeUndefined();
    }

    // Combat done, no corruption checks
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);

    const actions = computeLegalActions(result.state, PLAYER_1);
    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor and major items playable at Tolfalas', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      hand: [GLAMDRING, DAGGER_OF_WESTERNESSE],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const resourceActions = actions.filter(a => a.viable && a.action.type === 'play-hero-resource');
    expect(resourceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Scroll of Isildur (greater) is playable at Tolfalas', () => {
    const state = buildSitePhaseState({
      site: TOLFALAS,
      hand: [SCROLL_OF_ISILDUR],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const resourceActions = actions.filter(a => a.viable && a.action.type === 'play-hero-resource');
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
    expect(notPlayable[0].reason).toContain('Scroll of Isildur');
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
