/**
 * @module withdraw-support.test
 *
 * Taking back a support tap before the roll (`withdraw-support`).
 *
 * Not a CoE rule: a usability affordance so a misclicked or regretted support
 * tap (strike support, CoE 8.15; corruption check support, CoE 10.02) can be
 * undone. The window is deliberately narrow — the support may be withdrawn
 * only until any other action happens — so it can never be used to react to
 * information revealed after the support was given. It is a human-only
 * meta-action: offered by `withMetaActions`, never by `computeLegalActions`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  CardStatus,
  resetMint, dispatch, expectCharStatus,
  buildSupportStrikeScenario, buildSupportFreeCouncilScenario, buildSupportPendingCheckScenario, buildItemBoostCheckScenario,
  withdrawSupportOffers, tapToFightNeed, corruptionRollModifier,
} from '../test-helpers.js';
import { computeLegalActions, isMetaAction, reduce } from '../../index.js';
import type { CardDefinitionId, FreeCouncilPhaseState } from '../../index.js';

const PHIAL = 'dm-176' as CardDefinitionId;

describe('withdraw-support — taking back a support tap before the roll', () => {
  beforeEach(() => resetMint());

  test('is a human-only meta-action, never part of the engine legal-action set', () => {
    const { state, aragorn, bilbo } = buildSupportStrikeScenario();
    const supported = dispatch(state, { type: 'support-strike', player: PLAYER_1, supportingCharacterId: aragorn, targetCharacterId: bilbo });
    expect(isMetaAction('withdraw-support')).toBe(true);
    expect(computeLegalActions(supported, PLAYER_1).some(a => a.action.type === 'withdraw-support')).toBe(false);
    expect(withdrawSupportOffers(supported, PLAYER_1).map(a => a.supportSourceId)).toEqual([aragorn]);
    expect(withdrawSupportOffers(supported, PLAYER_2)).toHaveLength(0);
  });

  test('strike support: withdrawing untaps the supporter and restores the need', () => {
    const { state, aragorn, bilbo } = buildSupportStrikeScenario();
    expect(withdrawSupportOffers(state, PLAYER_1)).toHaveLength(0);
    const initialNeed = tapToFightNeed(state, PLAYER_1);

    const supported = dispatch(state, { type: 'support-strike', player: PLAYER_1, supportingCharacterId: aragorn, targetCharacterId: bilbo });
    expectCharStatus(supported, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(tapToFightNeed(supported, PLAYER_1)).toBe(initialNeed - 1);

    const withdrawn = dispatch(supported, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: aragorn });
    expectCharStatus(withdrawn, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expect(withdrawn.combat!.strikeAssignments[0].supportCount ?? 0).toBe(0);
    expect(tapToFightNeed(withdrawn, PLAYER_1)).toBe(initialNeed);
    expect(withdrawSupportOffers(withdrawn, PLAYER_1)).toHaveLength(0);
    // Aragorn may support again.
    expect(computeLegalActions(withdrawn, PLAYER_1).some(a =>
      a.viable && a.action.type === 'support-strike' && a.action.supportingCharacterId === aragorn)).toBe(true);
  });

  test('strike support: an ally supporter can be withdrawn', () => {
    const { state, gwaihir, bilbo, aragorn } = buildSupportStrikeScenario();
    const initialNeed = tapToFightNeed(state, PLAYER_1);
    const supported = dispatch(state, { type: 'support-strike', player: PLAYER_1, supportingCharacterId: gwaihir, targetCharacterId: bilbo });
    expect(withdrawSupportOffers(supported, PLAYER_1).map(a => a.supportSourceId)).toEqual([gwaihir]);

    const withdrawn = dispatch(supported, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: gwaihir });
    expect(withdrawn.players[RESOURCE_PLAYER].characters[aragorn].allies[0].status).toBe(CardStatus.Untapped);
    expect(tapToFightNeed(withdrawn, PLAYER_1)).toBe(initialNeed);
  });

  test('strike support: withdrawing one of two supports keeps the other', () => {
    const { state, aragorn, bilbo, legolas } = buildSupportStrikeScenario();
    const initialNeed = tapToFightNeed(state, PLAYER_1);
    const one = dispatch(state, { type: 'support-strike', player: PLAYER_1, supportingCharacterId: aragorn, targetCharacterId: bilbo });
    const two = dispatch(one, { type: 'support-strike', player: PLAYER_1, supportingCharacterId: legolas, targetCharacterId: bilbo });
    expect(withdrawSupportOffers(two, PLAYER_1).map(a => a.supportSourceId)).toEqual([aragorn, legolas]);

    const withdrawn = dispatch(two, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: aragorn });
    expectCharStatus(withdrawn, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharStatus(withdrawn, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);
    expect(withdrawn.combat!.strikeAssignments[0].supportCount).toBe(1);
    expect(tapToFightNeed(withdrawn, PLAYER_1)).toBe(initialNeed - 1);
    expect(withdrawSupportOffers(withdrawn, PLAYER_1).map(a => a.supportSourceId)).toEqual([legolas]);
  });

  test('strike support: the roll closes the window and a late withdrawal is rejected', () => {
    const { state, aragorn, bilbo } = buildSupportStrikeScenario();
    const supported = dispatch(state, { type: 'support-strike', player: PLAYER_1, supportingCharacterId: aragorn, targetCharacterId: bilbo });
    const resolve = computeLegalActions(supported, PLAYER_1)
      .find(a => a.action.type === 'resolve-strike' && a.action.tapToFight)!;
    const rolled = dispatch(supported, resolve.action);

    expect(rolled.withdrawableSupport ?? []).toHaveLength(0);
    expect(withdrawSupportOffers(rolled, PLAYER_1)).toHaveLength(0);
    expect(reduce(rolled, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: aragorn }).error).toBeDefined();
  });

  test('a character that never supported, or the opponent, cannot withdraw', () => {
    const { state, aragorn, bilbo, legolas } = buildSupportStrikeScenario();
    const supported = dispatch(state, { type: 'support-strike', player: PLAYER_1, supportingCharacterId: aragorn, targetCharacterId: bilbo });
    expect(reduce(supported, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: legolas }).error).toBeDefined();
    expect(reduce(supported, { type: 'withdraw-support', player: PLAYER_2, supportSourceId: aragorn }).error).toBeDefined();
  });

  test('Free Council support: withdrawing restores supportCount and untaps; the roll closes the window', () => {
    const { state, bilbo, aragorn } = buildSupportFreeCouncilScenario();
    const supported = dispatch(state, { type: 'support-corruption-check', player: PLAYER_1, supportingCharacterId: aragorn, targetCharacterId: bilbo });
    expectCharStatus(supported, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect((supported.phaseState as FreeCouncilPhaseState).pendingCheck!.supportCount).toBe(1);
    expect(withdrawSupportOffers(supported, PLAYER_1).map(a => a.supportSourceId)).toEqual([aragorn]);

    const withdrawn = dispatch(supported, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: aragorn });
    expectCharStatus(withdrawn, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expect((withdrawn.phaseState as FreeCouncilPhaseState).pendingCheck!.supportCount).toBe(0);

    const rolled = dispatch(supported, { type: 'pass', player: PLAYER_1 });
    expect(withdrawSupportOffers(rolled, PLAYER_1)).toHaveLength(0);
    expect(reduce(rolled, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: aragorn }).error).toBeDefined();
  });

  test('pending corruption check support: withdrawing removes the +1 check-modifier and untaps', () => {
    const { state, bilbo, aragorn } = buildSupportPendingCheckScenario();
    const before = corruptionRollModifier(state, PLAYER_1);

    const supported = dispatch(state, { type: 'support-corruption-check', player: PLAYER_1, supportingCharacterId: aragorn, targetCharacterId: bilbo });
    expect(corruptionRollModifier(supported, PLAYER_1)).toBe(before + 1);
    expect(supported.activeConstraints.some(c => c.source === aragorn)).toBe(true);

    const withdrawn = dispatch(supported, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: aragorn });
    expectCharStatus(withdrawn, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expect(withdrawn.activeConstraints.some(c => c.source === aragorn)).toBe(false);
    expect(corruptionRollModifier(withdrawn, PLAYER_1)).toBe(before);
  });

  test('item boost (Phial of Galadriel): withdrawing untaps the item and removes its +2', () => {
    const { state, aragorn, item } = buildItemBoostCheckScenario(PHIAL);
    const before = corruptionRollModifier(state, PLAYER_1);

    const supported = dispatch(state, { type: 'support-corruption-check', player: PLAYER_1, supportingItemInstanceId: item, targetCharacterId: aragorn });
    expect(supported.players[RESOURCE_PLAYER].characters[aragorn].items[0].status).toBe(CardStatus.Tapped);
    expect(corruptionRollModifier(supported, PLAYER_1)).toBe(before + 2);
    expect(withdrawSupportOffers(supported, PLAYER_1).map(a => a.supportSourceId)).toEqual([item]);

    const withdrawn = dispatch(supported, { type: 'withdraw-support', player: PLAYER_1, supportSourceId: item });
    expect(withdrawn.players[RESOURCE_PLAYER].characters[aragorn].items[0].status).toBe(CardStatus.Untapped);
    expect(withdrawn.activeConstraints.some(c => c.source === item)).toBe(false);
    expect(corruptionRollModifier(withdrawn, PLAYER_1)).toBe(before);
  });
});
