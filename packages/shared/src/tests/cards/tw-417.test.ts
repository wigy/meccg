/**
 * @module tw-417.test
 *
 * Card test: Old Forest (tw-417)
 * Type: hero-site (border-hold)
 * Effects: 1 (site-rule: healing-affects-all)
 *
 * "Healing effects affect all characters at the site."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                         |
 * |---|-------------------|--------|-----------------------------------------------|
 * | 1 | siteType          | OK     | "border-hold" — valid                         |
 * | 2 | sitePath          | OK     | wilderness, wilderness — matches card          |
 * | 3 | nearestHaven      | OK     | "Rivendell" — valid haven in card pool         |
 * | 4 | playableResources | OK     | Empty                                          |
 * | 5 | automaticAttacks  | OK     | Empty                                          |
 * | 6 | resourceDraws     | OK     | 1                                              |
 * | 7 | hazardDraws       | OK     | 1                                              |
 *
 * Engine Support:
 * | # | Feature                 | Status      | Notes                              |
 * |---|-------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow         | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | Haven path movement     | IMPLEMENTED | movement-map.ts                     |
 * | 3 | Healing affects all     | TODO        | needs healing items to test          |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-04-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RIVENDELL, LORIEN, MORIA,
  ARAGORN, LEGOLAS,
  resetMint, pool, buildTestState, reduce, Phase, CardStatus,
  buildSitePhaseState,
} from '../test-helpers.js';
import {
  computeLegalActions,
  OLD_FOREST,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Old Forest (tw-417)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────

  test('is a border-hold with correct structural properties', () => {
    const def = pool[OLD_FOREST as string];
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-site');
    expect(isSiteCard(def)).toBe(true);
    if (!isSiteCard(def)) return;

    expect(def.siteType).toBe('border-hold');
    expect(def.sitePath).toEqual(['wilderness', 'wilderness']);
    expect(def.nearestHaven).toBe('Rivendell');
    expect(def.region).toBe('Cardolan');
    expect(def.playableResources).toEqual([]);
    expect(def.automaticAttacks).toEqual([]);
    expect(def.resourceDraws).toBe(1);
    expect(def.hazardDraws).toBe(1);
  });

  test('has healing-affects-all site-rule effect', () => {
    const def = pool[OLD_FOREST as string];
    if (!isSiteCard(def)) return;

    expect(def.effects).toBeDefined();
    expect(def.effects).toHaveLength(1);
    expect(def.effects![0]).toEqual({ type: 'site-rule', rule: 'healing-affects-all' });
  });

  test('nearestHaven Rivendell exists in card pool', () => {
    const rivendell = pool[RIVENDELL as string];
    expect(rivendell).toBeDefined();
    expect(isSiteCard(rivendell)).toBe(true);
    if (!isSiteCard(rivendell)) return;
    expect(rivendell.siteType).toBe('haven');
  });

  test('site path has valid region types', () => {
    const def = pool[OLD_FOREST as string];
    if (!isSiteCard(def)) return;

    const validRegionTypes = [
      'wilderness', 'border', 'free', 'coastal', 'shadow', 'dark',
      'double-wilderness', 'double-shadow-land', 'double-coastal-sea',
    ];
    for (const region of def.sitePath) {
      expect(validRegionTypes).toContain(region);
    }
  });

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Old Forest (empty playableResources)', () => {
    const state = buildSitePhaseState({ site: OLD_FOREST });
    const actions = computeLegalActions(state, PLAYER_1);

    const viable = actions.filter(a => a.viable);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  test('no automatic attacks at Old Forest', () => {
    const def = pool[OLD_FOREST as string];
    if (!isSiteCard(def)) return;

    expect(def.automaticAttacks).toHaveLength(0);
  });

  // ─── Healing ────────────────────────────────────────────────────────────────
  // Old Forest does not heal by itself. The healing-affects-all rule means
  // that when a healing effect (e.g. from an item) is used at this site,
  // it affects ALL characters at the site, not just one.

  test.todo('healing effect from item at Old Forest affects all characters');

  test.todo('healing effect at non-Old-Forest site affects only one character');

  test('wounded character at Old Forest does NOT heal during untap (not a haven)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: OLD_FOREST, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const charId = result.state.players[0].companies[0].characters[0] as string;
    // Wounded characters stay wounded at non-haven sites
    expect(result.state.players[0].characters[charId].status).toBe(CardStatus.Inverted);
  });

  test('tapped character at Old Forest untaps normally', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: OLD_FOREST, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const result = reduce(state, { type: 'untap', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    const charId = result.state.players[0].companies[0].characters[0] as string;
    expect(result.state.players[0].characters[charId].status).toBe(CardStatus.Untapped);
  });

  // ─── Movement ─────────────────────────────────────────────────────────────

  test('starter movement from Rivendell reaches Old Forest', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Old Forest');
  });

  test('starter movement from Old Forest reaches Rivendell (back to nearest haven)', () => {
    const oldForest = pool[OLD_FOREST as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, oldForest, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Rivendell');
  });
});
