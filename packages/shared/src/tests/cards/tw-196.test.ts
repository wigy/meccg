/**
 * @module tw-196.test
 *
 * Card test: Beautiful Gold Ring (tw-196)
 * Type: hero-resource-item (subtype: gold-ring)
 * MP: 1, Corruption: 1
 *
 * "Discard Beautiful Gold Ring when tested. If tested, make a roll to
 *  determine which ring card may be immediately played:
 *  • The One Ring (12+); • a Dwarven Ring (10,11,12+);
 *  • a Magic Ring (1,2,3,4,5,6,7); • a Lesser Ring (any result)."
 *
 * Engine support:
 * | # | Feature                                 | Status      | Notes                                         |
 * |---|-----------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Discard when tested (gold-ring-test)    | IMPLEMENTED | global for all gold-ring items                |
 * | 2 | Roll to determine which ring to play    | IMPLEMENTED | ring-test-table → ring-play-offer             |
 *
 * The ring-replacement table (12+ One Ring, 10–12+ Dwarven, 1–7 Magic,
 * any Lesser) is the `ring-test-table` effect: the `gold-ring-test` pending
 * resolution maps the roll total to eligible ring categories and enqueues a
 * `ring-play-offer` listing the special rings the player may play immediately.
 * Gandalf's `test-gold-ring` grant routes through that resolution, so the
 * table applies on the Wizard-tap path as well as the site auto-test paths.
 *
 * Fixture alignment: hero (wizard), using Gandalf (tw-156) and Frodo at Rivendell.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, FRODO, ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  buildTestState, resetMint,
  findCharInstanceId, viableActions,
  attachItemToChar, getCharacter, dispatch, dispatchResult,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, ActivateGrantedAction } from '../../index.js';

const BEAUTIFUL_GOLD_RING = 'tw-196' as CardDefinitionId;

describe('Beautiful Gold Ring (tw-196)', () => {
  beforeEach(() => resetMint());

  test('bearer gains 1 effective corruption point while ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);
    expect(base.players[RESOURCE_PLAYER].characters[frodoId].effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, BEAUTIFUL_GOLD_RING));
    expect(withRing.players[RESOURCE_PLAYER].characters[frodoId].effectiveStats.corruptionPoints).toBe(1);
  });

  test('Gandalf can activate test-gold-ring targeting Beautiful Gold Ring', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [BEAUTIFUL_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('test-gold-ring');
    expect(action.characterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, GANDALF));

    const ringInstanceId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;
    expect(action.targetCardId).toBe(ringInstanceId);
  });

  test('testing Beautiful Gold Ring taps Gandalf, discards the ring, and returns a dice roll', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [BEAUTIFUL_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const afterActivate = dispatch(state, actions[0].action);
    expectCharStatus(afterActivate, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);

    const cheated = { ...afterActivate, cheatRollTotal: 12 };
    const rolls = viableActions(cheated, PLAYER_1, 'gold-ring-test-roll');
    expect(rolls.length).toBe(1);

    const result = dispatchResult(cheated, rolls[0].action);
    const nextState = result.state;

    expectCharItemCount(nextState, RESOURCE_PLAYER, FRODO, 0);
    expectInDiscardPile(nextState, RESOURCE_PLAYER, BEAUTIFUL_GOLD_RING);

    expect(nextState.players[RESOURCE_PLAYER].lastDiceRoll).toBeDefined();
    expect(
      nextState.players[RESOURCE_PLAYER].lastDiceRoll!.die1 +
      nextState.players[RESOURCE_PLAYER].lastDiceRoll!.die2
    ).toBe(12);

    expect(result.effects).toBeDefined();
    expect(result.effects!.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  test('the roll consults this ring’s own table: 12 makes The One Ring eligible, 11 does not', () => {
    const build: Parameters<typeof buildTestState>[0] = {
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [BEAUTIFUL_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    };

    for (const [total, expected] of [[12, true], [11, false]] as const) {
      resetMint();
      const state = buildTestState(build);
      const grants = viableActions(state, PLAYER_1, 'activate-granted-action');
      const afterActivate = dispatch(state, grants[0].action);
      const rolls = viableActions(afterActivate, PLAYER_1, 'gold-ring-test-roll');
      const afterRoll = dispatch({ ...afterActivate, cheatRollTotal: total }, rolls[0].action);

      const pending = afterRoll.pendingResolutions.filter(r => r.actor === PLAYER_1);
      expect(pending).toHaveLength(1);
      if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
      expect(pending[0].kind.eligibleCategories.includes('the-one-ring')).toBe(expected);
      // Dwarven rings need a 10+ on this ring; both totals clear that.
      expect(pending[0].kind.eligibleCategories).toContain('dwarven-ring');
    }
  });
});
