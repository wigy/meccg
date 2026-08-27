/**
 * @module td-131.test
 *
 * Card test: Many Foes He Fought (td-131)
 * Type: hero-resource-event (short)
 * Effects: 1 (multi-strike-option, requiredSkill "warrior")
 *
 * "If defender chooses a warrior to be the target of a strike from an
 *  attack, that character may choose to face any number of the strikes
 *  from that attack. The character suffers a cumulative -1 prowess/-1
 *  body for each additional strike faced. The character faces a separate
 *  strike sequence for each strike."
 *
 * This tests:
 * 1. `enable-multi-strike-option` is offered while the card sits in the
 *    defender's hand, before any strike of the current attack is assigned.
 * 2. It is no longer offered once a strike has been assigned (CoE 3.i.5's
 *    "must be declared before strikes are assigned").
 * 3. Playing it discards the card and records the required skill on
 *    `combat.multiStrikeSkill` for the rest of the attack.
 * 4. Without the card in play, a warrior already facing a strike gets no
 *    additional-strike option (baseline behavior is unchanged).
 * 5. Once enabled, a warrior already facing a strike may be assigned an
 *    additional strike — repeatable ("any number").
 * 6. The option is gated on skill: a non-warrior already facing a strike
 *    does not get it even while the option is enabled.
 * 7. Each additional strike is a genuinely separate `StrikeAssignment`
 *    entry (not merged into the plain excess-strike pool), carrying a
 *    cumulative -1 prowess/-1 body penalty.
 * 8. The penalty actually changes the dice math: resolving the additional
 *    strike needs a higher roll to succeed, and a resulting body check
 *    needs a higher roll too.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, THEODEN, BILBO,
  resetMint, dispatch, findCharInstanceId,
  addCardToHand, viableActions,
  makeCompanyCombatState,
} from '../test-helpers.js';
import type { CardDefinitionId, GameAction, AssignStrikeAction, BodyCheckRollAction } from '../../index.js';
import { Race } from '../../index.js';

const MANY_FOES_HE_FOUGHT = 'td-131' as CardDefinitionId;

describe('Many Foes He Fought (td-131)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1-2: pre-assignment-window gate ─────────────────────────────────

  test('offered to the defender before any strike of the attack is assigned', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const state = addCardToHand(base, RESOURCE_PLAYER, MANY_FOES_HE_FOUGHT);

    expect(viableActions(state, PLAYER_1, 'enable-multi-strike-option')).toHaveLength(1);
  });

  test('NOT offered once a strike has already been assigned this attack', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const state = addCardToHand(base, RESOURCE_PLAYER, MANY_FOES_HE_FOUGHT);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const after = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });

    expect(viableActions(after, PLAYER_1, 'enable-multi-strike-option')).toHaveLength(0);
  });

  // ─── Rule 3: playing it enables the option and discards the card ─────────

  test('playing it discards the card and records the required skill for this attack', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const state = addCardToHand(base, RESOURCE_PLAYER, MANY_FOES_HE_FOUGHT);

    const enableAction = viableActions(state, PLAYER_1, 'enable-multi-strike-option')[0].action;
    const after = dispatch(state, enableAction);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MANY_FOES_HE_FOUGHT)).toBe(true);
    expect(after.combat!.multiStrikeSkill).toBe('warrior');
  });

  // ─── Rule 4: baseline unchanged without the card ──────────────────────────

  test('without the option enabled, a warrior already facing a strike gets no additional-strike offer', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const after = dispatch(base, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });

    const extra = viableActions(after, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .filter(a => a.extraSequence === true);
    expect(extra).toHaveLength(0);
  });

  // ─── Rules 5-6: option gated on skill, repeatable ("any number") ─────────

  function enableOption(state: ReturnType<typeof makeCompanyCombatState>): ReturnType<typeof makeCompanyCombatState> {
    const withCard = addCardToHand(state, RESOURCE_PLAYER, MANY_FOES_HE_FOUGHT);
    const enableAction = viableActions(withCard, PLAYER_1, 'enable-multi-strike-option')[0].action;
    return dispatch(withCard, enableAction);
  }

  test('once enabled, a warrior already facing a strike may be assigned an additional strike (repeatable)', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 4,
    });
    const enabled = enableOption(base);
    const aragornId = findCharInstanceId(enabled, RESOURCE_PLAYER, ARAGORN);
    const afterFirst = dispatch(enabled, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });

    const extraOffers = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .filter(a => a.extraSequence === true);
    expect(extraOffers.some(a => a.characterId === aragornId)).toBe(true);

    // Take it once, then it must still be offered again ("any number of strikes").
    const afterSecond = dispatch(afterFirst, extraOffers.find(a => a.characterId === aragornId) as GameAction & AssignStrikeAction);
    const extraOffersAgain = viableActions(afterSecond, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .filter(a => a.extraSequence === true && a.characterId === aragornId);
    expect(extraOffersAgain).toHaveLength(1);
  });

  test('the option is gated on skill: a non-warrior already facing a strike does NOT get it', () => {
    const base = makeCompanyCombatState({
      characters: [BILBO, THEODEN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const enabled = enableOption(base);
    const bilboId = findCharInstanceId(enabled, RESOURCE_PLAYER, BILBO);
    const afterFirst = dispatch(enabled, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId });

    const extraOffers = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .filter(a => a.extraSequence === true);
    expect(extraOffers.some(a => a.characterId === bilboId)).toBe(false);

    // Théoden (a warrior) is untouched so far — the normal first-assignment
    // action must still be offered to him (baseline unaffected).
    const theodenId = findCharInstanceId(afterFirst, RESOURCE_PLAYER, THEODEN);
    const normalOffers = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction);
    expect(normalOffers.some(a => a.characterId === theodenId && !a.extraSequence)).toBe(true);
  });

  // ─── Rule 7: separate sequence, cumulative -1 prowess/-1 body ────────────

  test('additional strikes are separate entries with a cumulative -1 prowess/-1 body penalty', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN],
      creatureRace: Race.Orc,
      creatureProwess: 5,
      creatureBody: 9,
      strikesTotal: 3,
    });
    const enabled = enableOption(base);
    const aragornId = findCharInstanceId(enabled, RESOURCE_PLAYER, ARAGORN);

    const afterFirst = dispatch(enabled, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(afterFirst.combat!.strikeAssignments).toHaveLength(1);

    const extra1 = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .find(a => a.extraSequence === true && a.characterId === aragornId)!;
    const afterSecond = dispatch(afterFirst, extra1 as GameAction);
    expect(afterSecond.combat!.strikeAssignments).toHaveLength(2);
    const secondEntry = afterSecond.combat!.strikeAssignments[1];
    expect(secondEntry.characterId).toBe(aragornId);
    expect(secondEntry.excessStrikes).toBe(0);
    expect(secondEntry.strikeProwessBonus).toBe(-1);
    expect(secondEntry.strikeBodyPenalty).toBe(-1);

    const extra2 = viableActions(afterSecond, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .find(a => a.extraSequence === true && a.characterId === aragornId)!;
    const afterThird = dispatch(afterSecond, extra2 as GameAction);
    expect(afterThird.combat!.strikeAssignments).toHaveLength(3);
    const thirdEntry = afterThird.combat!.strikeAssignments[2];
    expect(thirdEntry.strikeProwessBonus).toBe(-2);
    expect(thirdEntry.strikeBodyPenalty).toBe(-2);

    // All 3 strikes of the attack are now allocated to Aragorn — assignment
    // is complete and multiple unresolved strikes exist, so the defender
    // chooses the order (CoE 3.iv).
    expect(afterThird.combat!.phase).toBe('choose-strike-order');

    // First entry (the plain first strike) carries no penalty.
    const firstEntry = afterThird.combat!.strikeAssignments[0];
    expect(firstEntry.strikeProwessBonus ?? 0).toBe(0);
    expect(firstEntry.strikeBodyPenalty ?? 0).toBe(0);
  });

  // ─── Rule 8: the penalty actually changes the dice math ──────────────────

  test('resolving an additional strike needs a higher roll to succeed (prowess penalty)', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN], // prowess 6
      creatureRace: Race.Orc,
      creatureProwess: 10,
      creatureBody: 9,
      strikesTotal: 2,
    });
    const enabled = enableOption(base);
    const aragornId = findCharInstanceId(enabled, RESOURCE_PLAYER, ARAGORN);

    const afterFirst = dispatch(enabled, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const extra = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .find(a => a.extraSequence === true && a.characterId === aragornId)!;
    const afterSecond = dispatch(afterFirst, extra as GameAction);
    expect(afterSecond.combat!.phase).toBe('choose-strike-order');

    // Order the plain first strike (index 0, no penalty) to resolve first.
    const ordered0 = dispatch(afterSecond, { type: 'choose-strike-order', player: PLAYER_1, strikeIndex: 0 });
    const need0 = viableActions(ordered0, PLAYER_1, 'resolve-strike')
      .map(ea => ea.action as { tapToFight?: boolean; need: number })
      .find(a => a.tapToFight === true)!.need;

    // Fresh state, order the additional strike (index 1, -1 prowess) instead.
    const ordered1 = dispatch(afterSecond, { type: 'choose-strike-order', player: PLAYER_1, strikeIndex: 1 });
    const need1 = viableActions(ordered1, PLAYER_1, 'resolve-strike')
      .map(ea => ea.action as { tapToFight?: boolean; need: number })
      .find(a => a.tapToFight === true)!.need;

    // -1 prowess on the additional strike raises the target roll by 1.
    expect(need1).toBe(need0 + 1);
  });

  test('a wounded body check from an additional strike picks up the -1 body penalty', () => {
    const base = makeCompanyCombatState({
      characters: [ARAGORN], // prowess 6, body 9
      creatureRace: Race.Orc,
      creatureProwess: 10,
      creatureBody: 9,
      strikesTotal: 2,
    });
    const enabled = enableOption(base);
    const aragornId = findCharInstanceId(enabled, RESOURCE_PLAYER, ARAGORN);

    const afterFirst = dispatch(enabled, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const extra = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .find(a => a.extraSequence === true && a.characterId === aragornId)!;
    const afterSecond = dispatch(afterFirst, extra as GameAction);

    // Resolve the additional strike (index 1, -1 prowess) first.
    const ordered = dispatch(afterSecond, { type: 'choose-strike-order', player: PLAYER_1, strikeIndex: 1 });
    const tapAction = viableActions(ordered, PLAYER_1, 'resolve-strike')
      .find(ea => (ea.action as { tapToFight?: boolean }).tapToFight === true)!.action;
    // Aragorn prowess 6 - 1 (penalty) + roll 3 = 8 < creature prowess 10 → wounded.
    const wounded = dispatch({ ...ordered, cheatRollTotal: 3 }, tapAction);

    expect(wounded.combat!.phase).toBe('body-check');
    expect(wounded.combat!.bodyCheckTarget).toBe('character');

    // Aragorn's body is 9. The additional strike's -1 body penalty makes the
    // effective body 8, so the roll needs to exceed 8 → need 9.
    const bcAction = viableActions(wounded, PLAYER_2, 'body-check-roll')[0].action as BodyCheckRollAction;
    expect(bcAction.need).toBe(9);
  });
});
