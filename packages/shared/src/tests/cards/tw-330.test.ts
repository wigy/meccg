/**
 * @module tw-330.test
 *
 * Card test: Star-glass (tw-330)
 * Type: hero-resource-item (minor item)
 * Unique: false
 * Marshalling Points: 0
 * Corruption Points: 0
 *
 * Card text:
 *   "Tap bearer of Star-glass to cancel an Undead attack against his company
 *   or to modify the prowess of a Spiders, Animals, or Wolves attack against
 *   his company by -2. Bearer makes a corruption check."
 *
 * Effects:
 *   1. cancel-attack — cost { tap: "bearer" }; bearer taps (item stays
 *      untapped) to cancel an Undead attack. Enqueues a corruption check on
 *      the bearer.  Only available against "undead" race attacks.
 *   2. modify-attack — cost { tap: "bearer" }; bearer taps (item stays
 *      untapped) to reduce a Spiders/Animals/Wolves attack prowess by 2.
 *      Enqueues a corruption check on the bearer.
 *
 * Key difference from Torque of Hues (tw-351): the item itself never taps —
 * only the bearer taps.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  findCharInstanceId,
  attachItemToChar,
  makeCancelWindowCombat,
  expectCharStatus,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO,
  BARROW_WIGHT,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { CardStatus, Race } from '../../index.js';
import type { CardDefinitionId, CancelAttackAction, ModifyAttackAction } from '../../index.js';

const STAR_GLASS = 'tw-330' as CardDefinitionId;
const GIANT_SPIDERS = 'tw-40' as CardDefinitionId;

describe('Star-glass (tw-330)', () => {
  beforeEach(() => resetMint());

  // ── cancel-attack: legal action generation ─────────────────────────────

  test('cancel-attack is offered against an Undead attack when bearer is untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, {
      creatureDefId: BARROW_WIGHT,
      creatureRace: Race.Undead,
    });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as CancelAttackAction;
    expect(action.type).toBe('cancel-attack');
  });

  test('cancel-attack is NOT offered when bearer is already tapped', () => {
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
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Undead });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  test('cancel-attack is NOT offered against a non-Undead attack (Orc)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Orc });

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  // ── cancel-attack: effect execution ────────────────────────────────────

  test('activating cancel-attack cancels combat immediately (no chain entry)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Undead });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    expect(after.combat).toBeNull();
    expect(after.chain).toBeNull();
  });

  test('bearer is tapped after cancelling Undead attack, but item stays untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Undead });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    // Bearer (Aragorn) is tapped.
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Item (Star-glass) is still untapped — only bearer taps.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    const starGlass = aragorn.items.find(i => i.definitionId === STAR_GLASS);
    expect(starGlass).toBeDefined();
    expect(starGlass!.status).toBe(CardStatus.Untapped);
  });

  test('bearer receives a corruption check after cancelling Undead attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Undead });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    const check = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.actor === PLAYER_1,
    );
    expect(check).toBeDefined();
    expect(check!.kind.type).toBe('corruption-check');
  });

  // ── modify-attack: legal action generation ─────────────────────────────

  test('modify-attack is offered against a Spiders attack when bearer is untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, {
      creatureDefId: GIANT_SPIDERS,
      creatureRace: Race.Spider,
    });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as ModifyAttackAction;
    expect(action.type).toBe('modify-attack');
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(action.characterInstanceId).toBe(aragornId);
  });

  test('modify-attack is offered against Wolves and Animals attacks', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);

    for (const race of [Race.Wolf, Race.Animal]) {
      const state = makeCancelWindowCombat(withItem, { creatureRace: race });
      const actions = viableActions(state, PLAYER_1, 'modify-attack');
      expect(actions).toHaveLength(1);
    }
  });

  test('modify-attack is NOT offered when bearer is already tapped', () => {
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
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Spider });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('modify-attack is NOT offered against Undead or Orc attacks', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);

    for (const race of [Race.Undead, Race.Orc]) {
      const state = makeCancelWindowCombat(withItem, { creatureRace: race });
      const actions = viableActions(state, PLAYER_1, 'modify-attack');
      expect(actions).toHaveLength(0);
    }
  });

  // ── modify-attack: effect execution ────────────────────────────────────

  test('activating modify-attack reduces attack prowess by 2', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, {
      creatureRace: Race.Spider,
      strikeProwess: 9,
    });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    const after = dispatch(state, actions[0].action);

    // Combat still active (not cancelled).
    expect(after.combat).not.toBeNull();
    expect(after.combat!.phase).toBe('assign-strikes');

    // Strike prowess reduced by 2: 9 → 7.
    expect(after.combat!.strikeProwess).toBe(7);
  });

  test('bearer is tapped after modify-attack but Star-glass item stays untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Spider });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    const after = dispatch(state, actions[0].action);

    // Bearer is tapped.
    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // Item stays untapped.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    const starGlass = aragorn.items.find(i => i.definitionId === STAR_GLASS);
    expect(starGlass).toBeDefined();
    expect(starGlass!.status).toBe(CardStatus.Untapped);
  });

  test('bearer receives a corruption check after modifying a Spiders attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Spider });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    const after = dispatch(state, actions[0].action);

    const check = after.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.actor === PLAYER_1,
    );
    expect(check).toBeDefined();
    expect(check!.kind.type).toBe('corruption-check');
  });

  // ── Two characters: only the item bearer provides actions ───────────────

  test('with two characters only the bearer of Star-glass provides the cancel action', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, STAR_GLASS);
    const state = makeCancelWindowCombat(withItem, { creatureRace: Race.Undead });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);
  });
});
