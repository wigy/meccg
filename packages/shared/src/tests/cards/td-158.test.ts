/**
 * @module td-158.test
 *
 * Card test: Thrór's Map (td-158)
 * Type: hero-resource-item (minor)
 *
 * "Unique. Discard Thrór's Map to untap a site with a Dragon automatic-attack."
 *
 * Effect:
 * | # | Effect Type  | Status      | Notes                                                     |
 * |---|--------------|-------------|-----------------------------------------------------------|
 * | 1 | grant-action | OK          | discard to untap-site; gated on site.isTapped + Dragon    |
 *
 * Conditions:
 *   - Bearer's company must be at a tapped site that has a Dragon auto-attack.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  CardStatus,
  dispatch, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
  withSiteTapped,
  buildSitePhaseState,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const THROORS_MAP = 'td-158' as CardDefinitionId;
// tw-381: Caves of Ûlund — Dragon auto-attack, 1 strike at 13 prowess
const CAVES_OF_ULUND = 'tw-381' as CardDefinitionId;

describe("Thrór's Map (td-158)", () => {
  beforeEach(() => resetMint());

  test('untap-site is offered when bearer is at a tapped Dragon lair', () => {
    const state = withSiteTapped(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: CAVES_OF_ULUND, characters: [{ defId: ARAGORN, items: [THROORS_MAP] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }));

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-site');
    expect(untapActions.length).toBe(1);
  });

  test('untap-site is NOT offered when site is untapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: CAVES_OF_ULUND, characters: [{ defId: ARAGORN, items: [THROORS_MAP] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-site');
    expect(untapActions.length).toBe(0);
  });

  test('untap-site is NOT offered when site has no Dragon auto-attack', () => {
    const state = withSiteTapped(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [THROORS_MAP] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }));

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-site');
    expect(untapActions.length).toBe(0);
  });

  test('activating untap-site discards the map and untaps the Dragon lair', () => {
    const state = withSiteTapped(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: CAVES_OF_ULUND, characters: [{ defId: ARAGORN, items: [THROORS_MAP] }] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    }));

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-site')!;
    expect(untapAction).toBeDefined();

    const next = dispatch(state, untapAction.action);

    expect(next.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, ARAGORN, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, THROORS_MAP);
  });

  test('untap-site is offered during the site phase play-resources step (bug: could not untap to play a second item)', () => {
    const state = withSiteTapped(buildSitePhaseState({
      site: CAVES_OF_ULUND,
      characters: [{ defId: ARAGORN, items: [THROORS_MAP] }],
    }));

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-site');
    expect(untapActions.length).toBe(1);

    const next = dispatch(state, untapActions[0].action);
    expect(next.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });
});
