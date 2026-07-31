/**
 * @module as-134.test
 *
 * Card test: Thrór's Map (as-134)
 * Type: minion-resource-item (minor)
 * Alignment: ringwraith
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
 * Fixture alignment: minion (ringwraith)
 *   - BURAT  (as-1):   troll, warrior+ranger  — bearer of the map
 *   - PERCHEN (as-4):  orc                    — second player's character
 *   - DANCING_SPIRE (as-143): minion ruins-and-lairs with Dragon auto-attack (2 strikes, 11 prowess)
 *   - DOL_GULDUR (le-367): minion haven (darkhaven) — used as non-Dragon site
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  viableActions,
  CardStatus,
  dispatch, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
  withSiteTapped,
  buildMinionSitePhaseState,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const THROORS_MAP = 'as-134' as CardDefinitionId;
const DANCING_SPIRE = 'as-143' as CardDefinitionId;  // Dragon — 2 strikes at 11 prowess
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // minion haven, no Dragon auto-attack
const BURAT = 'as-1' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;

describe("Thrór's Map (as-134)", () => {
  beforeEach(() => resetMint());

  test('untap-site is offered when bearer is at a tapped Dragon lair', () => {
    const state = withSiteTapped(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: BURAT, items: [THROORS_MAP] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
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
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: BURAT, items: [THROORS_MAP] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
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
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: BURAT, items: [THROORS_MAP] }] }], hand: [], siteDeck: [DANCING_SPIRE] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [PERCHEN] }], hand: [], siteDeck: [DOL_GULDUR] },
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
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DANCING_SPIRE, characters: [{ defId: BURAT, items: [THROORS_MAP] }] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [DANCING_SPIRE] },
      ],
    }));

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapAction = actions.find(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-site')!;
    expect(untapAction).toBeDefined();

    const next = dispatch(state, untapAction.action);

    expect(next.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    expectCharItemCount(next, RESOURCE_PLAYER, BURAT, 0);
    expectInDiscardPile(next, RESOURCE_PLAYER, THROORS_MAP);
  });

  test('untap-site is offered during the site phase play-resources step (bug: could not untap to play a second item)', () => {
    const state = buildMinionSitePhaseState({
      site: DANCING_SPIRE,
      characters: [{ defId: BURAT, items: [THROORS_MAP] }],
      siteStatus: CardStatus.Tapped,
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const untapActions = actions.filter(ea => (ea.action as ActivateGrantedAction).actionId === 'untap-site');
    expect(untapActions.length).toBe(1);

    const next = dispatch(state, untapActions[0].action);
    expect(next.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
  });
});
