/**
 * @module as-70.test
 *
 * Card test: Jewel of Beleriand (as-70)
 * Type: hero-resource-item (minor, wizard alignment, hoard)
 *
 * Printed text:
 *   "Hoard item. Tap this item and make a roll —if the result is greater
 *    than 6, the bearer untaps if tapped. Cannot be duplicated on a given
 *    character."
 *
 * Effects (data):
 *   1. item-play-site — playable only at sites whose keywords include "hoard"
 *   2. grant-action — tap-roll-untap-bearer (cost: tap self); apply:
 *      roll-then-apply threshold 7 ("greater than 6"), onSuccess sets the
 *      bearer's status to untapped.
 *   3. duplication-limit — scope "character", max 1.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN, LEGOLAS,
  MORIA, LORIEN,
  Phase, CardStatus,
  resetMint,
  buildTestState,
  buildSitePhaseState,
  viableActions,
  attachItemToChar,
  charIdAt,
  findCharInstanceId,
  setCharStatus,
  dispatch,
  dispatchResult,
  expectCharStatus,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, ActivateGrantedAction } from '../../index.js';

const JEWEL_OF_BELERIAND = 'as-70' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // Smaug's lair, hoard site

describe('Jewel of Beleriand (as-70)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: Hoard-item site restriction ───────────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [JEWEL_OF_BELERIAND],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GANDALF],
      hand: [JEWEL_OF_BELERIAND],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at a haven (Lórien)', () => {
    const state = buildSitePhaseState({
      site: LORIEN,
      characters: [GANDALF],
      hand: [JEWEL_OF_BELERIAND],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule: Cannot be duplicated on a given character ─────────────────────

  test('second Jewel of Beleriand cannot be played on a character who already bears one', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [
        { defId: GANDALF, items: [JEWEL_OF_BELERIAND] },
        ARAGORN,
      ],
      hand: [JEWEL_OF_BELERIAND],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const aragornId = charIdAt(state, RESOURCE_PLAYER, 0, 1);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId
        && ea.viable,
    );
    expect(onGandalf).toBeUndefined();

    const onAragorn = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === aragornId
        && ea.viable,
    );
    expect(onAragorn).toBeDefined();
  });

  test('first Jewel of Beleriand is playable on an unburdened bearer', () => {
    const state = buildSitePhaseState({
      site: LONELY_MOUNTAIN,
      characters: [GANDALF],
      hand: [JEWEL_OF_BELERIAND],
    });

    const gandalfId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    const onGandalf = plays.find(
      ea => ea.action.type === 'play-hero-resource'
        && ea.action.attachToCharacterId === gandalfId
        && ea.viable,
    );
    expect(onGandalf).toBeDefined();
  });

  // ─── Rule: Tap this item and make a roll — untap the bearer on > 6 ───────

  function orgStateWithJewel(bearerStatus: CardStatus) {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withJewel = attachItemToChar(base, RESOURCE_PLAYER, GANDALF, JEWEL_OF_BELERIAND);
    return setCharStatus(withJewel, RESOURCE_PLAYER, GANDALF, bearerStatus);
  }

  test('grant-action is available during bearer\'s organization phase', () => {
    const state = orgStateWithJewel(CardStatus.Tapped);
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const jewelActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'tap-roll-untap-bearer',
    );
    expect(jewelActions).toHaveLength(1);
  });

  test('roll greater than 6 taps the item and untaps a tapped bearer', () => {
    const state = orgStateWithJewel(CardStatus.Tapped);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const gandalfInPlay = state.players[RESOURCE_PLAYER].characters[gandalfId];
    const jewelInstId = gandalfInPlay.items[0].instanceId;
    expect(gandalfInPlay.items[0].status).toBe(CardStatus.Untapped);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'tap-roll-untap-bearer',
    )!.action;

    // Force a roll total of 7 (> 6).
    const result = dispatchResult({ ...state, cheatRollTotal: 7 }, action);
    const next = result.state;

    const jewelAfter = next.players[RESOURCE_PLAYER].characters[gandalfId].items
      .find(i => i.instanceId === jewelInstId)!;
    expect(jewelAfter.status).toBe(CardStatus.Tapped);
    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);
    expect(result.effects?.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  test('roll of 6 or less taps the item but leaves the bearer tapped', () => {
    const state = orgStateWithJewel(CardStatus.Tapped);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const jewelInstId = state.players[RESOURCE_PLAYER].characters[gandalfId].items[0].instanceId;

    const action = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'tap-roll-untap-bearer',
    )!.action;

    // Force a roll total of 6 (not > 6).
    const next = dispatch({ ...state, cheatRollTotal: 6 }, action);

    const jewelAfter = next.players[RESOURCE_PLAYER].characters[gandalfId].items
      .find(i => i.instanceId === jewelInstId)!;
    expect(jewelAfter.status).toBe(CardStatus.Tapped);
    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
  });

  test('tapped Jewel of Beleriand cannot be activated again', () => {
    const state = orgStateWithJewel(CardStatus.Tapped);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const gandalfInPlay = state.players[RESOURCE_PLAYER].characters[gandalfId];
    const jewelInstId = gandalfInPlay.items[0].instanceId;
    const tappedJewel = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [gandalfId as string]: {
              ...gandalfInPlay,
              items: gandalfInPlay.items.map(it =>
                it.instanceId === jewelInstId ? { ...it, status: CardStatus.Tapped } : it,
              ),
            },
          },
        },
        state.players[1],
      ] as const,
    };

    const actions = viableActions(tappedJewel, PLAYER_1, 'activate-granted-action');
    const jewelActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'tap-roll-untap-bearer',
    );
    expect(jewelActions).toHaveLength(0);
  });

  test('roll can be attempted even when the bearer is already untapped (no-op untap)', () => {
    const state = orgStateWithJewel(CardStatus.Untapped);
    const action = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'tap-roll-untap-bearer',
    )!.action;

    const next = dispatch({ ...state, cheatRollTotal: 7 }, action);
    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);
  });
});
