/**
 * @module td-152.test
 *
 * Card test: Skin-changer (td-152)
 * Type: hero-resource-event (short)
 * Effects: play-target (character named Beorn), on-event×5 self-enters-play
 * add-constraint (character-stat-modifier prowess +2 / body +2,
 * multi-strike-allowance maxStrikes 2, post-attack-check corruption -2,
 * return-to-hand-at-end-of-turn), all turn-scoped.
 *
 * "Only playable on Beorn. Until the end of the turn, his prowess and body
 * are each modified by +2. If Beorn is chosen to be the target of a strike
 * from an attack, he may choose to face a second strike from that attack (he
 * faces a separate strike sequence for each strike). Beorn makes a corruption
 * check modified by -2 after any attack made against his company. If still in
 * play at the end of the turn, place Beorn in your hand. Any items he bears
 * may be transferred to unwounded characters in his company (no corruption
 * checks are required)."
 *
 * | # | Rule fragment                                             | Status      |
 * |---|-----------------------------------------------------------|-------------|
 * | 1 | Only playable on Beorn                                    | IMPLEMENTED |
 * | 2 | +2 prowess / +2 body until the end of the turn            | IMPLEMENTED |
 * | 3 | May face a second strike (separate strike sequence)       | IMPLEMENTED |
 * | 4 | Corruption check -2 after any attack on his company       | IMPLEMENTED |
 * | 5 | At end of turn, Beorn returns to hand                     | IMPLEMENTED |
 * | 6 | His items may go to unwounded company-mates, no checks    | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  ARAGORN, GIMLI, DAGGER_OF_WESTERNESSE, GLAMDRING,
  RIVENDELL,
  resetMint, dispatch, findCharInstanceId, findHandCardId,
  addCardToHand, viableActions, executeAction, getCharacter,
  makeCompanyCombatState, buildSitePhaseState,
  CardStatus,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, AssignStrikeAction, GameAction,
} from '../../index.js';
import { Phase, Race } from '../../index.js';

const SKIN_CHANGER = 'td-152' as CardDefinitionId;
const BEORN = 'tw-126' as CardDefinitionId; // prowess 7, body 9

describe('Skin-changer (td-152)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: only playable on Beorn ───────────────────────────────────────

  test('playable only on Beorn — a company-mate is never offered as the target', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [BEORN, ARAGORN], hand: [SKIN_CHANGER] });
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);

    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { targetCharacterId?: CardInstanceId }).targetCharacterId).toBe(beornId);
  });

  test('NOT playable when Beorn is not in play', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [ARAGORN, GIMLI], hand: [SKIN_CHANGER] });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ─── Rule 2: +2 prowess / +2 body ─────────────────────────────────────────

  test('Beorn gets +2 prowess and +2 body for the rest of the turn; the card is discarded', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [BEORN, ARAGORN], hand: [SKIN_CHANGER] });
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const after = dispatch(state, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, SKIN_CHANGER),
      targetCharacterId: beornId,
    });

    const beorn = getCharacter(after, RESOURCE_PLAYER, BEORN);
    expect(beorn.effectiveStats.prowess).toBe(7 + 2);
    expect(beorn.effectiveStats.body).toBe(9 + 2);
    const aragorn = getCharacter(after, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.prowess).toBe(6);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === SKIN_CHANGER)).toBe(true);
    expect(after.activeConstraints.every(c => c.scope.kind === 'turn')).toBe(true);
  });

  // ─── Rule 3: a second strike, separate sequence ───────────────────────────

  test('without Skin-changer, Beorn already facing a strike is not offered a second one', () => {
    const state = makeCompanyCombatState({
      characters: [BEORN, ARAGORN], creatureRace: Race.Orc, creatureProwess: 7, creatureBody: null, strikesTotal: 3,
    });
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const after = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: beornId });

    const extra = viableActions(after, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .filter(a => a.extraSequence === true);
    expect(extra).toHaveLength(0);
  });

  test('once chosen as a strike target, Beorn may face exactly one more strike, as a separate sequence with no penalty', () => {
    const combatState = makeCompanyCombatState({
      characters: [BEORN, ARAGORN], creatureRace: Race.Orc, creatureProwess: 7, creatureBody: null, strikesTotal: 3,
    });
    // Play Skin-changer during the movement/hazard phase before the attack.
    const preAttack = addCardToHand({ ...combatState, combat: null }, RESOURCE_PLAYER, SKIN_CHANGER);
    const beornId = findCharInstanceId(preAttack, RESOURCE_PLAYER, BEORN);
    const played = dispatch(preAttack, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(preAttack, RESOURCE_PLAYER, SKIN_CHANGER),
      targetCharacterId: beornId,
    });
    const inCombat = { ...played, combat: combatState.combat };

    // Before he is chosen as a target no extra-sequence offer exists.
    expect(viableActions(inCombat, PLAYER_1, 'assign-strike')
      .some(ea => (ea.action as AssignStrikeAction).extraSequence === true)).toBe(false);

    const afterFirst = dispatch(inCombat, { type: 'assign-strike', player: PLAYER_1, characterId: beornId });
    const extra = viableActions(afterFirst, PLAYER_1, 'assign-strike')
      .map(ea => ea.action as AssignStrikeAction)
      .filter(a => a.extraSequence === true);
    expect(extra).toHaveLength(1);
    expect(extra[0].characterId).toBe(beornId);

    const afterSecond = dispatch(afterFirst, extra[0] as GameAction);
    const assignments = afterSecond.combat!.strikeAssignments;
    expect(assignments).toHaveLength(2);
    expect(assignments.every(a => a.characterId === beornId && a.excessStrikes === 0)).toBe(true);
    expect(assignments[1].strikeProwessBonus ?? 0).toBe(0);
    expect(assignments[1].strikeBodyPenalty ?? 0).toBe(0);

    // A second strike only — no third extra sequence.
    expect(viableActions(afterSecond, PLAYER_1, 'assign-strike')
      .some(ea => (ea.action as AssignStrikeAction).extraSequence === true)).toBe(false);
  });

  // ─── Rule 4: corruption check -2 after any attack on his company ─────────

  test('after an attack on his company Beorn makes a corruption check modified by -2 — even if the strike went to a company-mate', () => {
    const combatState = makeCompanyCombatState({
      characters: [BEORN, ARAGORN], creatureRace: Race.Orc, creatureProwess: 5, creatureBody: null, strikesTotal: 1,
    });
    const preAttack = addCardToHand({ ...combatState, combat: null }, RESOURCE_PLAYER, SKIN_CHANGER);
    const beornId = findCharInstanceId(preAttack, RESOURCE_PLAYER, BEORN);
    const aragornId = findCharInstanceId(preAttack, RESOURCE_PLAYER, ARAGORN);
    const played = dispatch(preAttack, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(preAttack, RESOURCE_PLAYER, SKIN_CHANGER),
      targetCharacterId: beornId,
    });
    const inCombat = { ...played, combat: combatState.combat };

    const assigned = dispatch(inCombat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const finished = executeAction(assigned, PLAYER_1, 'resolve-strike', 12);
    expect(finished.combat).toBeNull();

    const checks = finished.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    expect((checks[0].kind as { characterId: CardInstanceId }).characterId).toBe(beornId);
    expect((checks[0].kind as { modifier: number }).modifier).toBe(-2);
  });

  test('no post-attack corruption check without Skin-changer', () => {
    const state = makeCompanyCombatState({
      characters: [BEORN, ARAGORN], creatureRace: Race.Orc, creatureProwess: 5, creatureBody: null, strikesTotal: 1,
    });
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const assigned = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: beornId });
    const finished = executeAction(assigned, PLAYER_1, 'resolve-strike', 12);
    expect(finished.combat).toBeNull();
    expect(finished.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  // ─── Rules 5-6: end of turn — back to hand, items to unwounded mates ─────

  test('at the end of the turn Beorn returns to hand and any of his items may go to unwounded company-mates without corruption checks', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      characters: [
        { defId: BEORN, items: [DAGGER_OF_WESTERNESSE, GLAMDRING] },
        ARAGORN,
        { defId: GIMLI, status: CardStatus.Inverted },
      ],
      hand: [SKIN_CHANGER],
    });
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const played = dispatch(state, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, SKIN_CHANGER),
      targetCharacterId: beornId,
    });

    // Finish the site phase → end-of-turn.
    const eot = executeAction(played, PLAYER_1, 'pass');
    expect(eot.phaseState.phase).toBe(Phase.EndOfTurn);

    const p1 = eot.players[RESOURCE_PLAYER];
    expect(p1.characters[beornId]).toBeUndefined();
    expect(p1.hand.some(c => c.instanceId === beornId)).toBe(true);
    expect(p1.companies[0].characters).toEqual([aragornId, gimliId]);

    // Each item may go to Aragorn (unwounded) but never to wounded Gimli.
    const offers = viableActions(eot, PLAYER_1, 'transfer-returned-item')
      .map(ea => ea.action as { itemInstanceId?: CardInstanceId; targetCharacterId?: CardInstanceId });
    const transfers = offers.filter(a => a.itemInstanceId);
    expect(transfers).toHaveLength(2);
    expect(transfers.every(a => a.targetCharacterId === aragornId)).toBe(true);
    expect(offers.some(a => !a.itemInstanceId)).toBe(true);

    const afterFirst = dispatch(eot, { type: 'transfer-returned-item', player: PLAYER_1, ...transfers[0] } as GameAction);
    const second = viableActions(afterFirst, PLAYER_1, 'transfer-returned-item')
      .map(ea => ea.action as { itemInstanceId?: CardInstanceId; targetCharacterId?: CardInstanceId })
      .filter(a => a.itemInstanceId);
    expect(second).toHaveLength(1);
    const afterBoth = dispatch(afterFirst, { type: 'transfer-returned-item', player: PLAYER_1, ...second[0] } as GameAction);

    const aragornItems = afterBoth.players[RESOURCE_PLAYER].characters[aragornId].items.map(i => i.definitionId);
    expect(aragornItems).toEqual(expect.arrayContaining([DAGGER_OF_WESTERNESSE, GLAMDRING]));
    expect(afterBoth.players[RESOURCE_PLAYER].discardPile.some(c =>
      c.definitionId === DAGGER_OF_WESTERNESSE || c.definitionId === GLAMDRING)).toBe(false);
    expect(afterBoth.pendingResolutions.filter(r =>
      r.kind.type === 'transfer-returned-item' || r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('items the player declines to transfer are discarded with Beorn', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      characters: [{ defId: BEORN, items: [DAGGER_OF_WESTERNESSE] }, ARAGORN],
      hand: [SKIN_CHANGER],
    });
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const played = dispatch(state, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, SKIN_CHANGER),
      targetCharacterId: beornId,
    });
    const eot = executeAction(played, PLAYER_1, 'pass');
    const declined = dispatch(eot, { type: 'transfer-returned-item', player: PLAYER_1 });

    expect(declined.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === beornId)).toBe(true);
    expect(declined.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect(declined.pendingResolutions.filter(r => r.kind.type === 'transfer-returned-item')).toHaveLength(0);
  });

  test('a Beorn no longer in play at the end of the turn is not returned to hand', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [BEORN, ARAGORN], hand: [SKIN_CHANGER] });
    const beornId = findCharInstanceId(state, RESOURCE_PLAYER, BEORN);
    const played = dispatch(state, {
      type: 'play-short-event', player: PLAYER_1,
      cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, SKIN_CHANGER),
      targetCharacterId: beornId,
    });
    // Beorn leaves play (e.g. eliminated) before the turn ends.
    const p1 = played.players[RESOURCE_PLAYER];
    const { [beornId]: beorn, ...rest } = p1.characters;
    const gone = {
      ...played,
      players: [{
        ...p1,
        characters: rest,
        companies: p1.companies.map(c => ({ ...c, characters: c.characters.filter(id => id !== beornId) })),
        outOfPlayPile: [...p1.outOfPlayPile, { instanceId: beornId, definitionId: beorn.definitionId }],
      }, played.players[1]] as unknown as typeof played.players,
    };

    const eot = executeAction(gone, PLAYER_1, 'pass');
    expect(eot.phaseState.phase).toBe(Phase.EndOfTurn);
    expect(eot.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === beornId)).toBe(false);
    expect(eot.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === beornId)).toBe(true);
  });
});
