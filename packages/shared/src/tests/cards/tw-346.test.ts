/**
 * @module tw-346.test
 *
 * Card test: The Old Thrush (tw-346)
 * Type: hero-resource-event (short), non-unique
 *
 * Card text:
 *   "-3 to the prowess and body of a non-Nazgûl attack with a normal prowess
 *    of 13 or more. Cannot be duplicated on a given attack."
 *
 * Effects:
 * - `modify-attack` (defender): -3 prowess / -3 body, when
 *   non-nazgul AND enemy.prowess >= 13
 * - `duplication-limit` scope "attack" max 1: second copy blocked per attack
 *
 * Engine support:
 * | # | Feature                                              | Status      | Notes                                    |
 * |---|------------------------------------------------------|-------------|------------------------------------------|
 * | 1 | modify-attack (defender, -3 prowess/body)  | IMPLEMENTED | modifyAttackFromHandActions + reducer     |
 * | 2 | Condition: non-nazgul                                | IMPLEMENTED | enemy.race in context, $not operator     |
 * | 3 | Condition: normal prowess >= 13                      | IMPLEMENTED | enemy.prowess from card def in context   |
 * | 4 | Cannot be duplicated on a given attack               | IMPLEMENTED | duplication-limit scope "attack" + marker|
 * | 5 | Only defender can play it                            | IMPLEMENTED | effect.player === "defender" check       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, dispatch, makeCancelWindowCombat,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, ModifyAttackAction } from '../../index.js';
import { Race } from '../../index.js';

const THE_OLD_THRUSH = 'tw-346' as CardDefinitionId;
/** Daelomin (tw-26): dragon, prowess 13, body 8 — non-nazgul with prowess ≥ 13. */
const DAELOMIN = 'tw-26' as CardDefinitionId;
/** Tom (tw-103): troll, prowess 13 — non-nazgul with prowess exactly 13. */
const TOM_TUMA = 'tw-103' as CardDefinitionId;

describe('The Old Thrush (tw-346)', () => {
  beforeEach(() => resetMint());

  // ─── Available / not available ───────────────────────────────────────────

  test('available to defender vs non-nazgul creature with prowess 13', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const state = makeCancelWindowCombat(base, {
      creatureDefId: TOM_TUMA,
      creatureRace: Race.Troll,
      strikeProwess: 13,
    });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);
    const act = actions[0].action as ModifyAttackAction;
    expect(act.player).toBe(PLAYER_1);
    expect(act.cardInstanceId).toBe(state.players[RESOURCE_PLAYER].hand[0].instanceId);
  });

  test('NOT available vs non-nazgul creature with prowess < 13 (Orc-patrol, prowess 6)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Default makeCancelWindowCombat uses Orc-patrol (tw-074, prowess 6).
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, strikeProwess: 6 });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('NOT available vs nazgul attack even with prowess >= 13', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Use automatic-attack so prowess comes from strikeProwess directly.
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Ringwraith,
      strikeProwess: 15,
      attackSourceType: 'automatic-attack',
    });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('NOT available to attacker (defender-only effect)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [THE_OLD_THRUSH], siteDeck: [RIVENDELL] },
      ],
    });

    const state = makeCancelWindowCombat(base, {
      creatureDefId: TOM_TUMA,
      creatureRace: Race.Troll,
      strikeProwess: 13,
    });

    const actions = viableActions(state, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  // ─── Effect application ───────────────────────────────────────────────────

  test('playing Old Thrush reduces strikeProwess by 3', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const state = makeCancelWindowCombat(base, {
      creatureDefId: TOM_TUMA,
      creatureRace: Race.Troll,
      strikeProwess: 13,
    });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(10); // 13 − 3 = 10
  });

  test('playing Old Thrush reduces creatureBody by 3 when body is non-null', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    // Daelomin: dragon, prowess 13, body 8. Override creatureBody to be non-null.
    const stateRaw = makeCancelWindowCombat(base, {
      creatureDefId: DAELOMIN,
      creatureRace: Race.Dragon,
      strikeProwess: 13,
    });
    // Inject body manually (makeCancelWindowCombat sets creatureBody: null).
    const state = { ...stateRaw, combat: { ...stateRaw.combat!, creatureBody: 8 } };

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(10); // 13 − 3 = 10
    expect(after.combat!.creatureBody).toBe(5);    // 8 − 3 = 5
  });

  test('Old Thrush is discarded from hand after use', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const state = makeCancelWindowCombat(base, {
      creatureDefId: TOM_TUMA,
      creatureRace: Race.Troll,
      strikeProwess: 13,
    });

    const actions = viableActions(state, PLAYER_1, 'modify-attack');
    const after = dispatch(state, actions[0].action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(
      after.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === THE_OLD_THRUSH),
    ).toBeDefined();
  });

  // ─── Duplication limit ────────────────────────────────────────────────────

  test('second copy of Old Thrush is suppressed on the same attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        // Two copies in hand.
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [THE_OLD_THRUSH, THE_OLD_THRUSH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const state = makeCancelWindowCombat(base, {
      creatureDefId: TOM_TUMA,
      creatureRace: Race.Troll,
      strikeProwess: 13,
    });

    // Both copies should be offered before the first is played.
    const before = viableActions(state, PLAYER_1, 'modify-attack');
    expect(before).toHaveLength(2);

    // Play the first copy.
    const after = dispatch(state, before[0].action);

    // strikeProwess has been reduced.
    expect(after.combat!.strikeProwess).toBe(10);

    // Second copy is now suppressed — duplication limit reached.
    const secondActions = viableActions(after, PLAYER_1, 'modify-attack');
    expect(secondActions).toHaveLength(0);
  });
});
