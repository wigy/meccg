/**
 * @module td-160.test
 *
 * Card test: Twice-baked Cakes (td-160)
 * Type: hero-resource-item (subtype "special")
 * Effects: 2 (item-play-site, grant-action extra-region-movement)
 *
 * "Playable only at a Free-hold [{F}] or Border-hold [{B}]. May also be
 *  played if the site is tapped. Discard during organization phase to
 *  allow its bearer's company to play two additional region cards."
 *
 * | # | Effect Type    | Status | Notes                                         |
 * |---|----------------|--------|------------------------------------------------|
 * | 1 | item-play-site | OK     | filter: free-hold / border-hold; allowTapped   |
 * |   |                |        | bypasses the tapped-site gate                  |
 * | 2 | grant-action   | OK     | discard during organization → +2 max region    |
 * |   |                |        | distance (increment-company-extra-region-      |
 * |   |                |        | distance, amount: 2)                           |
 *
 * Playable: YES
 *
 * Fixtures:
 *  - Minas Tirith (tw-412): free-hold.
 *  - Bree (tw-378): border-hold.
 *  - Moria: ruins-and-lairs — the play restriction must reject it.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, recomputeDerived,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH, BREE,
  viableActions, viableActionsForHandCard, getCharacter,
  CardStatus, Phase,
  dispatch, expectCharItemCount, expectInDiscardPile,
  attachItemToChar,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const TWICE_BAKED_CAKES = 'td-160' as CardDefinitionId;

describe('Twice-baked Cakes (td-160)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: item-play-site playability ────────────────────────────────

  test('playable at an untapped Free-hold (Minas Tirith)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MINAS_TIRITH,
      hand: [TWICE_BAKED_CAKES],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWICE_BAKED_CAKES);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at an untapped Border-hold (Bree)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: BREE,
      hand: [TWICE_BAKED_CAKES],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWICE_BAKED_CAKES);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a TAPPED Free-hold (allowTapped bypasses the tapped-site gate)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MINAS_TIRITH,
      hand: [TWICE_BAKED_CAKES],
      siteStatus: CardStatus.Tapped,
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWICE_BAKED_CAKES);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Ruins & Lairs site (Moria)', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: MORIA,
      hand: [TWICE_BAKED_CAKES],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, TWICE_BAKED_CAKES);
    expect(offered).toHaveLength(0);
  });

  // ─── Card stat: corruption points ────────────────────────────────────────

  test('bearing Twice-baked Cakes adds 1 corruption point to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withItem = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TWICE_BAKED_CAKES));
    expect(getCharacter(withItem, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(1);
  });

  // ─── Effect 2: extra-region-movement grant-action ────────────────────────

  test('extra-region-movement grant-action available during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [TWICE_BAKED_CAKES] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(1);
  });

  test('activating extra-region-movement discards Twice-baked Cakes and sets extraRegionDistance to 2', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [TWICE_BAKED_CAKES] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement')!;
    expect(extraAction).toBeDefined();

    const next = dispatch(state, extraAction.action);

    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, TWICE_BAKED_CAKES);
    expect(next.players[0].companies[0].extraRegionDistance).toBe(2);
  });

  test('extra-region-movement NOT available when company already has planned movement', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [TWICE_BAKED_CAKES] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const moveActions = viableActions(state, PLAYER_1, 'plan-movement');
    expect(moveActions.length).toBeGreaterThan(0);
    const afterMove = dispatch(state, moveActions[0].action);

    const actions = viableActions(afterMove, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(0);
  });

  test('extra-region-movement NOT available during movement/hazard phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [{ defId: ARAGORN, items: [TWICE_BAKED_CAKES] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const extraActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'extra-region-movement');
    expect(extraActions.length).toBe(0);
  });
});
