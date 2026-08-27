/**
 * @module td-168.test
 *
 * Card test: Wit (td-168)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Text: "Modify one riddling roll by +3. If applicable, this card may also
 *   be played during your opponent's site phase if a riddling roll is
 *   called for."
 *
 * Effects:
 * | # | Effect Type | Status | Notes                                              |
 * |---|-------------|--------|-----------------------------------------------------|
 * | 1 | play-target | OK     | targets any character                                |
 * | 2 | play-option | OK     | add-constraint check-modifier riddling +3, gated on  |
 * |   |             |        | pending.riddlingAttemptTargetsMe (reactive-only)     |
 *
 * The boost is a reactive play, available only while a `riddling-attempt`
 * pending resolution (e.g. Riddling Talk td-148) is awaiting its roll for
 * the targeted character — mirroring Halfling Strength's (tw-253) reactive
 * corruption-check boost. Because the reactive-play scan runs whenever any
 * `riddling-attempt` resolution is queued, regardless of the current phase,
 * the "may also be played during your opponent's site phase" clause is
 * satisfied automatically by any future riddling-roll mechanic that fires
 * during a site phase, without a phase-specific carve-out.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeCancelWindowCombat,
  dispatch, resolveChain,
  findHandCardId, charIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, reduce, Race } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';

const RIDDLING_TALK = 'td-148' as CardDefinitionId;
const WIT = 'td-168' as CardDefinitionId;

describe('Wit (td-168)', () => {
  beforeEach(() => resetMint());

  test('not offered without a pending riddling-attempt', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [WIT], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(actions).toHaveLength(0);
  });

  test('reactive riddling-boost offered while a riddling-attempt roll is pending', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK, WIT], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const talkCard = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const witCard = findHandCardId(state, RESOURCE_PLAYER, WIT);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: talkCard, targetCharacterId: aragornId,
    }));
    expect(afterChain.pendingResolutions.find(r => r.kind.type === 'riddling-attempt')).toBeDefined();

    const reactiveActions = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(reactiveActions).toHaveLength(1);
    expect(reactiveActions[0].cardInstanceId).toBe(witCard);
    expect(reactiveActions[0].targetCharacterId).toBe(aragornId);
    expect(reactiveActions[0].optionId).toBe('riddling-boost');
  });

  test('playing Wit adds a +3 riddling check-modifier, consumes the card, keeps the roll queued', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK, WIT], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const talkCard = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const witCard = findHandCardId(state, RESOURCE_PLAYER, WIT);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: talkCard, targetCharacterId: aragornId,
    }));

    const boosted = dispatch(afterChain, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: witCard,
      targetCharacterId: aragornId,
      optionId: 'riddling-boost',
    });

    const constraints = boosted.activeConstraints.filter(c => c.kind.type === 'check-modifier' && c.kind.check === 'riddling');
    expect(constraints).toHaveLength(1);
    expect(constraints[0].kind.type === 'check-modifier' && constraints[0].kind.value).toBe(3);

    // The riddling-attempt resolution is still queued — only the roll consumes it.
    expect(boosted.pendingResolutions.filter(r => r.kind.type === 'riddling-attempt')).toHaveLength(1);

    // The card left the hand for the discard pile.
    expect(boosted.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === witCard)).toBe(false);
    expect(boosted.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === witCard)).toBe(true);
  });

  test('the +3 boost lowers the displayed "need" for the pending roll', () => {
    // Aragorn alone vs Dragon: no sage/hobbit bonus. threshold=8 → base need = 9.
    // With Wit's +3: need = 8 - 3 + 1 = 6.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK, WIT], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const talkCard = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const witCard = findHandCardId(state, RESOURCE_PLAYER, WIT);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: talkCard, targetCharacterId: aragornId,
    }));

    const baseNeed = computeLegalActions(afterChain, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;
    expect((baseNeed.action as { need: number }).need).toBe(9);

    const boosted = dispatch(afterChain, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: witCard,
      targetCharacterId: aragornId,
      optionId: 'riddling-boost',
    });

    const boostedNeed = computeLegalActions(boosted, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;
    expect((boostedNeed.action as { need: number }).need).toBe(6);
  });

  test('the +3 boost is folded into the roll total and the constraint is consumed on resolution', () => {
    // Aragorn alone vs Dragon (threshold 8). Roll 5 → base total 5 (fails
    // without Wit), but 5 + 3 = 8 is still NOT > 8 (fails). Roll 6 → 6 + 3 =
    // 9 > 8 → success only with the boost.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK, WIT], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const talkCard = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const witCard = findHandCardId(state, RESOURCE_PLAYER, WIT);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: talkCard, targetCharacterId: aragornId,
    }));

    const boosted = dispatch(afterChain, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: witCard,
      targetCharacterId: aragornId,
      optionId: 'riddling-boost',
    });

    const rollAction = computeLegalActions(boosted, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;

    // Without the +3 boost a raw roll of 6 (6 > 8 is false) would fail; with
    // it, 6 + 3 = 9 > 8 succeeds.
    const result = reduce({ ...boosted, cheatRollTotal: 6 }, rollAction.action);
    expect(result.error).toBeUndefined();

    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'riddling-guess');
    expect(pending).toBeDefined();

    // The one-shot constraint was consumed by the roll.
    expect(result.state.activeConstraints.filter(c => c.kind.type === 'check-modifier' && c.kind.check === 'riddling')).toHaveLength(0);
  });

  test('a raw roll that would fail even with the boost still fails', () => {
    // Aragorn alone vs Dragon (threshold 8). Roll 4 → 4 + 3 = 7, NOT > 8 → failure.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK, WIT], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const talkCard = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const witCard = findHandCardId(state, RESOURCE_PLAYER, WIT);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: talkCard, targetCharacterId: aragornId,
    }));

    const boosted = dispatch(afterChain, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: witCard,
      targetCharacterId: aragornId,
      optionId: 'riddling-boost',
    });

    const rollAction = computeLegalActions(boosted, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;

    const result = reduce({ ...boosted, cheatRollTotal: 4 }, rollAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.pendingResolutions.find(r => r.kind.type === 'riddling-guess')).toBeUndefined();
    expect(result.state.combat).not.toBeNull();
    expect(result.state.activeConstraints.filter(c => c.kind.type === 'check-modifier' && c.kind.check === 'riddling')).toHaveLength(0);
  });

  test('stacks with sage/hobbit bonuses (Gandalf, sage, vs Dragon)', () => {
    // Gandalf: +2 sage bonus. Wit: +3. threshold=8 → need = 8 - 2 - 3 + 1 = 4.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [RIDDLING_TALK, WIT], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const talkCard = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const witCard = findHandCardId(state, RESOURCE_PLAYER, WIT);
    const gandalfId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: talkCard, targetCharacterId: gandalfId,
    }));

    const boosted = dispatch(afterChain, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: witCard,
      targetCharacterId: gandalfId,
      optionId: 'riddling-boost',
    });

    const action = computeLegalActions(boosted, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    );
    expect((action!.action as { need: number }).need).toBe(4);
  });
});
