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
 * | 3 | Healing affects all     | IMPLEMENTED | chain-reducer extends wounded→well   |
 * | 4 | Card draws              | IMPLEMENTED | resourceDraws/hazardDraws used      |
 *
 * Playable: YES
 * Certified: 2026-04-06
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RIVENDELL, LORIEN, MORIA,
  ARAGORN, LEGOLAS, FRODO, HALFLING_STRENGTH,
  resetMint, pool, buildTestState, Phase, CardStatus,
  buildSitePhaseState,
  dispatch, resolveChain, expectCharStatus, findCharInstanceId, handCardId,
  viableFor, RESOURCE_PLAYER,
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
  // Old Forest does not heal by itself. The healing-affects-all site-rule means
  // that when a healing effect is used at this site, it affects ALL wounded
  // characters at the site, not just the one the healing card targeted.
  //
  // Halfling Strength (tw-253) is the healing card used here — its `heal`
  // play-option moves a wounded Hobbit "from wounded status to well and
  // untapped during his organization phase". The site-rule is indifferent to
  // where the healing came from (`chain-reducer` extends any wounded → well
  // transition), so an event drives it exactly as an item would; no healing
  // *item* exists in the current hero pool to use instead.

  test('healing at Old Forest extends to every wounded character at the site', () => {
    // Frodo (the Hobbit the card may target) and Aragorn are both wounded in a
    // company at Old Forest. Healing Frodo heals Aragorn too — note Aragorn is
    // not a Hobbit and so could never have been targeted by Halfling Strength
    // himself: the extension follows the site, not the healing card's own
    // targeting restrictions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: OLD_FOREST,
            characters: [
              { defId: FRODO, status: CardStatus.Inverted },
              { defId: ARAGORN, status: CardStatus.Inverted },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = resolveChain(dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: frodoId,
      optionId: 'heal',
    }));

    expectCharStatus(state, RESOURCE_PLAYER, FRODO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  test('healing at a site without the rule affects only the targeted character', () => {
    // The identical play at Rivendell — a site with no `healing-affects-all`
    // site-rule — leaves Aragorn wounded. This is the control that proves the
    // extension above comes from Old Forest and not from the healing card.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: FRODO, status: CardStatus.Inverted },
              { defId: ARAGORN, status: CardStatus.Inverted },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [OLD_FOREST],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);
    const hsInstance = handCardId(base, RESOURCE_PLAYER);

    const state = resolveChain(dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: frodoId,
      optionId: 'heal',
    }));

    expectCharStatus(state, RESOURCE_PLAYER, FRODO, CardStatus.Untapped);
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

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
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
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

    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
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
