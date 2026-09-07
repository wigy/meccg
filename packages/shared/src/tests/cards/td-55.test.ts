/**
 * @module td-55.test
 *
 * Card test: Prowess of Age (td-55)
 * Type: hazard-event (short), non-unique
 *
 * Text: "Targets and cancels any effect (declared earlier in the same chain of
 *   effects) that would cancel an attack from a unique Dragon manifestation.
 *   Alternatively, gives a prowess bonus to a Dragon or Drake attack (must be
 *   played before its strikes are assigned) dictated by the number of Prowess
 *   of Age cards played on the attack: +1 prowess if 1 played; +4 if 2
 *   played; +9 if 3 played."
 *
 * Effects:
 * | # | Effect Type                | Status | Notes                                              |
 * |---|-----------------------------|--------|------------------------------------------------------|
 * | 1 | counter-cancel-attack-roll | OK     | Mode A: instant (no roll) counter, race dragon,     |
 * |   | (no threshold, uniqueOnly) |        | gated on the attacking creature being unique        |
 * | 2 | modify-attack (fromHand,   | OK     | Mode B: prowess bonus = 2*priorPlaysOnAttack + 1,   |
 * |   |  prowessModifierExpr,      |        | cumulative total after N copies is N² (1, 4, 9)     |
 * |   |  trackAttackPlays)         |        |                                                        |
 *
 * Player-index convention: PLAYER_1 (RESOURCE) is the moving/defending player,
 * PLAYER_2 (HAZARD) is the attacking player who plays Prowess of Age.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, LORIEN, RIVENDELL,
  buildTestState, resetMint,
  makeCancelWindowCombat,
  dispatch, resolveChain,
  handCardId, charIdAt, viableActions,
} from '../test-helpers.js';
import { Phase, Race } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const PROWESS_OF_AGE = 'td-55' as CardDefinitionId;
const BAIRANAX = 'td-3' as CardDefinitionId; // unique Dragon (Dragon manifestation)
const LAND_DRAKE = 'td-40' as CardDefinitionId; // non-unique Drake creature
const ESCAPE = 'tw-229' as CardDefinitionId; // hero cancel-attack (unconditional)

/** Base two-player state; PLAYER_2 holds Prowess of Age unless overridden. */
function baseState(opts?: { defenderHand?: CardDefinitionId[]; attackerHand?: CardDefinitionId[] }) {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: opts?.defenderHand ?? [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts?.attackerHand ?? [PROWESS_OF_AGE], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Prowess of Age (td-55)', () => {
  beforeEach(() => resetMint());

  // ── Mode A: instant counter-cancel of a unique Dragon manifestation's attack ──

  /** Defender plays Escape to cancel the Dragon attack, opening the chain. */
  function defenderCancelsDragon(opts?: { creatureUnique?: boolean; creatureRace?: Race; creatureDefId?: CardDefinitionId }) {
    const state = makeCancelWindowCombat(
      baseState({ defenderHand: [ESCAPE] }),
      {
        creatureDefId: opts?.creatureDefId ?? BAIRANAX,
        creatureRace: opts?.creatureRace ?? Race.Dragon,
        creatureUnique: opts?.creatureUnique ?? true,
        strikeProwess: 8,
      },
    );
    const escapeCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterCancel = dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: escapeCard, targetCharacterId: aragornId,
    });
    return { state: afterCancel, escapeCard };
  }

  test('Mode A: attacker offered instant counter-cancel targeting the cancel entry', () => {
    const { state, escapeCard } = defenderCancelsDragon();
    expect(state.chain).not.toBeNull();
    const poa = handCardId(state, HAZARD_PLAYER);
    const actions = viableActions(state, PLAYER_2, 'counter-cancel-roll');
    expect(actions).toHaveLength(1);
    const act = actions[0].action as { cardInstanceId: unknown; targetInstanceId: unknown };
    expect(act.cardInstanceId).toBe(poa);
    expect(act.targetInstanceId).toBe(escapeCard);
  });

  test('Mode A: NOT offered against a non-Dragon (Orc) attack', () => {
    const { state } = defenderCancelsDragon({ creatureRace: Race.Orc, creatureUnique: true, creatureDefId: undefined });
    expect(viableActions(state, PLAYER_2, 'counter-cancel-roll')).toHaveLength(0);
  });

  test('Mode A: NOT offered against a non-unique Dragon attack', () => {
    const { state } = defenderCancelsDragon({ creatureRace: Race.Dragon, creatureUnique: false, creatureDefId: undefined });
    expect(viableActions(state, PLAYER_2, 'counter-cancel-roll')).toHaveLength(0);
  });

  test('Mode A: playing it resolves instantly (no roll) — negates the cancel, attack survives', () => {
    const { state } = defenderCancelsDragon();
    const action = viableActions(state, PLAYER_2, 'counter-cancel-roll')[0].action;
    const afterPlay = dispatch(state, action);
    // Prowess of Age discarded immediately.
    expect(afterPlay.players[HAZARD_PLAYER].hand).toHaveLength(0);

    const resolved = resolveChain(afterPlay);
    // No dice-check pending — the counter is instant and unconditional.
    const pendingRoll = resolved.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(pendingRoll).toBeUndefined();

    // The attack survives (cancel negated), prowess unchanged (no bonus), chain complete.
    expect(resolved.combat).not.toBeNull();
    expect(resolved.combat!.strikeProwess).toBe(8);
    expect(resolved.chain).toBeNull();
    // The defending character was NOT wounded (Escape never resolved).
    const aragornId = charIdAt(resolved, RESOURCE_PLAYER);
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe('inverted');
  });

  // ── Mode B: stacking prowess bonus (N² total after N copies played) ──────────

  test('Mode B: attacker offered modify-attack vs a Dragon attack', () => {
    const state = makeCancelWindowCombat(baseState(), { creatureDefId: BAIRANAX, creatureRace: Race.Dragon, creatureUnique: true, strikeProwess: 6 });
    const poa = handCardId(state, HAZARD_PLAYER);
    const actions = viableActions(state, PLAYER_2, 'modify-attack').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === poa,
    );
    expect(actions).toHaveLength(1);
  });

  test('Mode B: attacker offered modify-attack vs a Drake attack', () => {
    const state = makeCancelWindowCombat(baseState(), { creatureDefId: LAND_DRAKE, creatureRace: Race.Drake, strikeProwess: 6 });
    const poa = handCardId(state, HAZARD_PLAYER);
    const actions = viableActions(state, PLAYER_2, 'modify-attack').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === poa,
    );
    expect(actions).toHaveLength(1);
  });

  test('Mode B: NOT offered vs a non-Dragon/Drake (Orc) attack', () => {
    const state = makeCancelWindowCombat(baseState(), { creatureRace: Race.Orc, strikeProwess: 6 });
    const poa = handCardId(state, HAZARD_PLAYER);
    const actions = viableActions(state, PLAYER_2, 'modify-attack').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === poa,
    );
    expect(actions).toHaveLength(0);
  });

  test('Mode B: 1 copy played gives +1 prowess and discards the card', () => {
    const state = makeCancelWindowCombat(baseState(), { creatureDefId: LAND_DRAKE, creatureRace: Race.Drake, strikeProwess: 6 });
    const action = viableActions(state, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(state, action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === PROWESS_OF_AGE)).toBe(true);
  });

  test('Mode B: 2 copies played on the same attack give a cumulative +4 total', () => {
    const state = makeCancelWindowCombat(
      baseState({ attackerHand: [PROWESS_OF_AGE, PROWESS_OF_AGE] }),
      { creatureDefId: LAND_DRAKE, creatureRace: Race.Drake, strikeProwess: 6 },
    );
    const firstAction = viableActions(state, PLAYER_2, 'modify-attack')[0].action;
    const afterFirst = dispatch(state, firstAction);
    expect(afterFirst.combat!.strikeProwess).toBe(7); // 6 + 1

    const secondAction = viableActions(afterFirst, PLAYER_2, 'modify-attack')[0].action;
    const afterSecond = dispatch(afterFirst, secondAction);
    // Cumulative total for 2 copies is +4 (delta of the 2nd play is +3).
    expect(afterSecond.combat!.strikeProwess).toBe(10); // 6 + 4
    expect(afterSecond.players[HAZARD_PLAYER].hand).toHaveLength(0);
  });

  test('Mode B: 3 copies played on the same attack give a cumulative +9 total', () => {
    const state = makeCancelWindowCombat(
      baseState({ attackerHand: [PROWESS_OF_AGE, PROWESS_OF_AGE, PROWESS_OF_AGE] }),
      { creatureDefId: LAND_DRAKE, creatureRace: Race.Drake, strikeProwess: 6 },
    );
    let current = state;
    for (let i = 0; i < 3; i++) {
      const action = viableActions(current, PLAYER_2, 'modify-attack')[0].action;
      current = dispatch(current, action);
    }
    // Cumulative total for 3 copies is +9 (deltas +1, +3, +5).
    expect(current.combat!.strikeProwess).toBe(15); // 6 + 9
    expect(current.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(current.players[HAZARD_PLAYER].discardPile.filter(c => c.definitionId === PROWESS_OF_AGE)).toHaveLength(3);
  });
});
