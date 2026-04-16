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
  resetMint, pool, buildTestState, Phase, CardStatus,
  buildSitePhaseState,
  dispatch, expectCharStatus,
  viableFor,
} from '../test-helpers.js';
import {
  OLD_FOREST,
  isSiteCard, buildMovementMap, getReachableSites,
} from '../../index.js';
import type { SiteCard } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Old Forest (tw-417)', () => {
  beforeEach(() => resetMint());

  // ─── Data validation ────────────────────────────────────────────────────────


  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Old Forest (empty playableResources)', () => {
    const state = buildSitePhaseState({ site: OLD_FOREST });
    const viable = viableFor(state, PLAYER_1);

    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
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

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    // Wounded characters stay wounded at non-haven sites
    expectCharStatus(nextState, 0, ARAGORN, CardStatus.Inverted);
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

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    expectCharStatus(nextState, 0, ARAGORN, CardStatus.Untapped);
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
