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
 * | 2 | Roll to determine which ring to play    | INFO ONLY   | informational; player plays ring manually;    |
 * |   |                                         |             | same precedent as certified le-315            |
 *
 * The ring-replacement table (12+ One Ring, 10–12+ Dwarven, 1–7 Magic,
 * any Lesser) is informational — the engine returns the dice roll total
 * and the player manually plays the appropriate special ring from hand.
 * No engine enforcement needed (same as le-315, certified 2026-04-19).
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
  attachItemToChar, getCharacter, dispatchResult,
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
    expect(base.players[RESOURCE_PLAYER].characters[frodoId as string].effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, BEAUTIFUL_GOLD_RING));
    expect(withRing.players[RESOURCE_PLAYER].characters[frodoId as string].effectiveStats.corruptionPoints).toBe(1);
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

    const cheated = { ...state, cheatRollTotal: 12 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    expect(actions.length).toBe(1);

    const result = dispatchResult(cheated, actions[0].action);
    const nextState = result.state;

    expectCharStatus(nextState, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
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
});
