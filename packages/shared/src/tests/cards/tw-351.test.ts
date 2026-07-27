/**
 * @module tw-351.test
 *
 * Card test: Torque of Hues (tw-351)
 * Type: hero-resource-item (Major Item)
 * Subtype: major
 * Unique: true
 * Marshalling Points: 2
 * Corruption Points: 2
 *
 * Card text: "Unique. Tap Torque of Hues and its bearer to cancel an attack
 * against his company. Bearer makes a corruption check."
 *
 * Effects:
 *   1. cancel-attack — cost { tap: "self-and-bearer" }; taps the item AND
 *      its bearer to cancel any attack during combat's assign-strikes window.
 *      Immediately enqueues a corruption check on the bearer.
 *
 * Activation requires BOTH the item AND its bearer to be untapped.
 * No chain entry is created — cancellation is immediate (same pattern as
 * in-play allies). A corruption-check pending resolution is enqueued on
 * the bearer after the attack is cancelled.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardInstanceId } from '../../index.js';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeCancelWindowCombat,
  CardStatus,
  dispatch, expectCharStatus,
  attachItemToChar,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { Race } from '../../index.js';

const TORQUE_OF_HUES = 'tw-351' as CardDefinitionId;

describe('Torque of Hues (tw-351)', () => {
  beforeEach(() => resetMint());

  // ── Legal action generation ─────────────────────────────────────────

  test('cancel-attack action is offered when item and bearer are both untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as CancelAttackAction;
    expect(action.type).toBe('cancel-attack');
  });

  test('cancel-attack NOT offered when the item is already tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    // Tap the item manually.
    const aragornId = (Object.keys(withItem.players[RESOURCE_PLAYER].characters) as CardInstanceId[]).find(
      id => withItem.players[RESOURCE_PLAYER].characters[id].definitionId === ARAGORN,
    )!;
    const tappedItem = {
      ...withItem,
      players: withItem.players.map((p, i) =>
        i !== RESOURCE_PLAYER ? p : {
          ...p,
          characters: {
            ...p.characters,
            [aragornId]: {
              ...p.characters[aragornId],
              items: p.characters[aragornId].items.map(item =>
                item.definitionId === TORQUE_OF_HUES
                  ? { ...item, status: CardStatus.Tapped }
                  : item,
              ),
            },
          },
        },
      ),
    } as unknown as typeof withItem;

    const state = makeCancelWindowCombat(tappedItem, { creatureRace: Race.Orc });
    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  test('cancel-attack NOT offered when the bearer is already tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  test('cancel-attack NOT offered when Torque of Hues is in hand (not in play)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [TORQUE_OF_HUES], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Item is in hand, not attached to any character.
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  test('cancel-attack NOT offered outside of combat', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withItem = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);

    const actions = viableActions(withItem, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  test('cancel-attack NOT offered after strikes have been assigned', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    // Create combat already in assign-strikes state WITH a strike already assigned.
    const combatState = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });
    // Place a strike assignment to move past the cancel window.
    const aragornId = (Object.keys(combatState.players[RESOURCE_PLAYER].characters) as CardInstanceId[]).find(
      id => combatState.players[RESOURCE_PLAYER].characters[id].definitionId === ARAGORN,
    )!;
    const afterAssign = {
      ...combatState,
      combat: combatState.combat
        ? { ...combatState.combat, strikeAssignments: [{ characterId: aragornId, strikeIndex: 0 }] }
        : combatState.combat,
    } as typeof combatState;

    const actions = viableActions(afterAssign, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  // ── Effect execution ────────────────────────────────────────────────

  test('activating Torque of Hues cancels combat immediately (no chain entry)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);

    // Combat is immediately cancelled — no chain entry created.
    expect(after.combat).toBeNull();
    expect(after.chain).toBeNull();
  });

  test('both item and bearer are tapped after activation', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    // Bearer (Aragorn) is tapped.
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Item (Torque of Hues) is also tapped.
    const aragornId = (Object.keys(after.players[RESOURCE_PLAYER].characters) as CardInstanceId[]).find(
      id => after.players[RESOURCE_PLAYER].characters[id].definitionId === ARAGORN,
    )!;
    const torque = after.players[RESOURCE_PLAYER].characters[aragornId].items.find(
      i => i.definitionId === TORQUE_OF_HUES,
    );
    expect(torque).toBeDefined();
    expect(torque!.status).toBe(CardStatus.Tapped);
  });

  test('bearer receives a corruption check after the attack is cancelled', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    // A corruption-check pending resolution must be enqueued for the bearer.
    const check = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.actor === PLAYER_1,
    );
    expect(check).toBeDefined();
    expect(check!.kind.type).toBe('corruption-check');
  });

  test('with two characters, only the bearer of the item provides the action', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    // Attach the item only to Aragorn.
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, TORQUE_OF_HUES);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // Only one action (for the one bearer), not two.
    expect(actions).toHaveLength(1);
  });
});
