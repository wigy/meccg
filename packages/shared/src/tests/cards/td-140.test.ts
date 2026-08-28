/**
 * @module td-140.test
 *
 * Card test: More Sense than You (td-140)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Card text:
 *   "Playable before strikes are assigned on an untapped character or ally
 *    whose company is facing an attack. Tap target character or ally. He
 *    may not be assigned a strike from this attack."
 *
 * Rules:
 * 1. protect-from-assignment offered for every untapped character in the
 *    defending company.
 * 2. Also offered for untapped allies hosted by the company.
 * 3. NOT offered for a tapped character.
 * 4. NOT offered for a tapped ally.
 * 5. NOT available to the attacking player.
 * 6. Playing the card on a character discards it, taps the character, and
 *    protects it from strike assignment for the rest of the attack; other
 *    company members remain assignable normally.
 * 7. Playing the card on an ally discards it, taps the ally, and protects
 *    the ally from strike assignment.
 * 8. NOT playable after a strike has been assigned ("before strikes are
 *    assigned").
 * 9. Protecting the sole character of a solo company (no allies) leaves the
 *    attack with no possible target — the attack fizzles instead of
 *    deadlocking the game (regression: `handleCombatPass` previously only
 *    detected "company has zero characters"/"zero strikes", not "company
 *    has characters but none assignable").
 *
 * Effects table:
 * | # | Effect                                                    | Status |
 * |---|------------------------------------------------------------|--------|
 * | 1 | protect-from-strike-assignment: includeAllies               | OK     |
 * | 2 | protect-from-strike-assignment: requireUntapped              | OK     |
 * | 3 | protect-from-strike-assignment: tapTarget                    | OK     |
 *
 * Playable: YES
 *
 * Fixtures:
 *   MORE_SENSE (td-140)  — the card under test
 *   ARAGORN (tw-120), THEODEN (tw-182) — hero warriors
 *   GWAIHIR (tw-251)     — hero ally, no attack restrictions
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, dispatch, reduce, viableActions,
  addCardToHand, handCardId, expectInDiscardPile,
  attachAllyToChar, setAllyStatus, setCharStatus,
  findCharInstanceId, findAllyInstanceId,
  makeCompanyCombatState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, THEODEN, GWAIHIR,
} from '../test-helpers.js';
import type { CardDefinitionId, ProtectFromStrikeAssignmentAction, AssignStrikeAction } from '../../index.js';
import { CardStatus, Race } from '../../index.js';

const MORE_SENSE = 'td-140' as CardDefinitionId;

function setUpCombat(characters: CardDefinitionId[]) {
  const base = makeCompanyCombatState({
    characters,
    creatureRace: Race.Orc,
    creatureProwess: 5,
    creatureBody: 9,
    strikesTotal: 1,
  });
  return addCardToHand(base, RESOURCE_PLAYER, MORE_SENSE);
}

describe('More Sense than You (td-140)', () => {
  beforeEach(() => resetMint());

  test('offered for every untapped character in the defending company', () => {
    const state = setUpCombat([ARAGORN, THEODEN]);
    const actions = viableActions(state, PLAYER_1, 'protect-from-assignment');
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const targets = actions.map(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId);
    expect(targets).toContain(aragornId);
    expect(targets).toContain(theodenId);
  });

  test('also offered for an untapped ally hosted by the company', () => {
    const withAlly = attachAllyToChar(setUpCombat([ARAGORN]), RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const gwaihirId = findAllyInstanceId(withAlly, RESOURCE_PLAYER, ARAGORN, GWAIHIR)!;
    const actions = viableActions(withAlly, PLAYER_1, 'protect-from-assignment');
    const targets = actions.map(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId);
    expect(targets).toContain(gwaihirId);
  });

  test('NOT offered for a tapped character', () => {
    const state = setCharStatus(setUpCombat([ARAGORN, THEODEN]), RESOURCE_PLAYER, THEODEN, CardStatus.Tapped);
    const actions = viableActions(state, PLAYER_1, 'protect-from-assignment');
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const targets = actions.map(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId);
    expect(targets).toContain(aragornId);
    expect(targets).not.toContain(theodenId);
  });

  test('NOT offered for a tapped ally', () => {
    const withAlly = attachAllyToChar(setUpCombat([ARAGORN]), RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const withTappedAlly = setAllyStatus(withAlly, RESOURCE_PLAYER, ARAGORN, GWAIHIR, CardStatus.Tapped);
    const gwaihirId = findAllyInstanceId(withTappedAlly, RESOURCE_PLAYER, ARAGORN, GWAIHIR)!;
    const actions = viableActions(withTappedAlly, PLAYER_1, 'protect-from-assignment');
    const targets = actions.map(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId);
    expect(targets).not.toContain(gwaihirId);
  });

  test('NOT available to the attacking player', () => {
    const state = setUpCombat([ARAGORN, THEODEN]);
    expect(viableActions(state, PLAYER_2, 'protect-from-assignment')).toHaveLength(0);
  });

  test('playing the card on a character discards it, taps the character, and protects it; other members stay assignable', () => {
    const state = setUpCombat([ARAGORN, THEODEN]);
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);

    const actions = viableActions(state, PLAYER_1, 'protect-from-assignment');
    const action = actions.find(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId === theodenId)!;
    expect(action).toBeDefined();

    const after = dispatch(state, action.action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardId);
    expect(after.combat!.protectedFromStrikeAssignment ?? []).toContain(theodenId);
    expect(after.players[RESOURCE_PLAYER].characters[theodenId].status).toBe(CardStatus.Tapped);

    const strikeActions = viableActions(after, PLAYER_1, 'assign-strike');
    const strikeTargets = strikeActions.map(a => (a.action as AssignStrikeAction).characterId);
    expect(strikeTargets).not.toContain(theodenId);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    expect(strikeTargets).toContain(aragornId);
  });

  test('playing the card on an ally discards it, taps the ally, and protects it', () => {
    const withAlly = attachAllyToChar(setUpCombat([ARAGORN, THEODEN]), RESOURCE_PLAYER, ARAGORN, GWAIHIR);
    const cardId = handCardId(withAlly, RESOURCE_PLAYER);
    const gwaihirId = findAllyInstanceId(withAlly, RESOURCE_PLAYER, ARAGORN, GWAIHIR)!;

    const actions = viableActions(withAlly, PLAYER_1, 'protect-from-assignment');
    const action = actions.find(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId === gwaihirId)!;
    expect(action).toBeDefined();

    const after = dispatch(withAlly, action.action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, cardId);
    expect(after.combat!.protectedFromStrikeAssignment ?? []).toContain(gwaihirId);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const ally = after.players[RESOURCE_PLAYER].characters[aragornId].allies.find(a => a.instanceId === gwaihirId);
    expect(ally!.status).toBe(CardStatus.Tapped);

    const strikeActions = viableActions(after, PLAYER_1, 'assign-strike');
    const strikeTargets = strikeActions.map(a => (a.action as AssignStrikeAction).characterId);
    expect(strikeTargets).not.toContain(gwaihirId);
  });

  test('NOT playable after a strike has been assigned', () => {
    const state = setUpCombat([ARAGORN, THEODEN]);
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const theodenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);

    const strikeActions = viableActions(state, PLAYER_1, 'assign-strike');
    expect(strikeActions.length).toBeGreaterThan(0);
    const mid = dispatch(state, strikeActions[0].action);
    expect(mid.combat!.strikeAssignments.length).toBeGreaterThan(0);

    expect(viableActions(mid, PLAYER_1, 'protect-from-assignment')).toHaveLength(0);

    const forged = reduce(mid, {
      type: 'protect-from-assignment', player: PLAYER_1,
      cardInstanceId: cardId, targetCharacterId: theodenId,
    });
    expect(forged.error).toBeDefined();
  });

  test('protecting the sole character of a solo company fizzles the attack instead of deadlocking', () => {
    const state = setUpCombat([ARAGORN]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    // Baseline: before protection, Aragorn is a normal assignable target.
    const baselineStrikes = viableActions(state, PLAYER_1, 'assign-strike');
    expect(baselineStrikes.map(a => (a.action as AssignStrikeAction).characterId)).toContain(aragornId);

    const actions = viableActions(state, PLAYER_1, 'protect-from-assignment');
    const action = actions.find(a => (a.action as ProtectFromStrikeAssignmentAction).targetCharacterId === aragornId)!;
    const afterProtect = dispatch(state, action.action);

    expect(afterProtect.combat!.protectedFromStrikeAssignment ?? []).toContain(aragornId);
    // No one left to strike — only pass remains.
    const remaining = viableActions(afterProtect, PLAYER_1, 'assign-strike');
    expect(remaining).toHaveLength(0);

    const passActions = viableActions(afterProtect, PLAYER_1, 'pass');
    expect(passActions.length).toBeGreaterThan(0);
    const afterPass = dispatch(afterProtect, passActions[0].action);

    // The attack fizzles cleanly instead of bouncing forever between
    // assignment phases that only ever offer `pass`.
    expect(afterPass.combat).toBeNull();
  });
});
