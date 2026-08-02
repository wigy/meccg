/**
 * @module td-148.test
 *
 * Card test: Riddling Talk (td-148)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Text: "Riddling attempt. Playable on a character whose company is facing an
 *   attack of the type listed below. Character makes a roll modified by: +2
 *   for each sage and +1 for each Hobbit in his company. If the result is
 *   greater than: 8 against Dragons and Drakes, 10 against Men and Giants,
 *   12 against Slayers, Awakened Plants, Orcs, Spiders, and Trolls; then name
 *   a card and opponent must reveal his hand. If the named card is in
 *   opponent's hand, the creature's card is discarded (all of its attacks
 *   are canceled) and the hazard limit against the character's company is
 *   decreased by three."
 *
 * Effects:
 * | # | Effect Type      | Status | Notes                                            |
 * |---|------------------|--------|---------------------------------------------------|
 * | 1 | riddling-attempt | OK     | race-gated roll (2d6 + sage/hobbit bonuses), then |
 * |   |                  |        | a blind card-name guess against opponent's hand   |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GANDALF, BILBO, FRODO,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  ORC_WARBAND,
  buildTestState, resetMint,
  makeCancelWindowCombat,
  dispatch, resolveChain,
  findHandCardId, charIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, reduce, Race } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const RIDDLING_TALK = 'td-148' as CardDefinitionId;

describe('Riddling Talk (td-148)', () => {
  beforeEach(() => resetMint());

  // ── Cancel-window availability ────────────────────────────────────────────

  test('cancel-attack offered for a Dragon attack (threshold 8 group)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(1);
  });

  test('cancel-attack offered for a Man attack (threshold 10 group)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(1);
  });

  test('cancel-attack offered for an Orc attack (threshold 12 group)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(1);
  });

  test('cancel-attack NOT offered for a Wolf attack (race not in thresholds)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Wolf });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(0);
  });

  test('one cancel-attack action offered per character in company', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN, GANDALF] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const cancels = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'cancel-attack'
        && (ea.action as { cardInstanceId: unknown }).cardInstanceId === card,
    );
    expect(cancels).toHaveLength(2);
  });

  test('NOT playable outside combat (end-of-turn phase, no attack)', () => {
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const actions = computeLegalActions(state, PLAYER_1);

    const playForCard = actions.filter(
      ea => ea.viable
        && (ea.action.type === 'play-short-event' || ea.action.type === 'cancel-attack')
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === card,
    );
    expect(playForCard).toHaveLength(0);

    const notPlayable = actions.find(
      ea => ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === card,
    );
    expect(notPlayable).toBeDefined();
    expect((notPlayable as { reason?: string }).reason).toContain('combat');
  });

  // ── Chain resolution → riddling-attempt pending ───────────────────────────

  test('declaring Riddling Talk creates a riddling-attempt pending resolution after chain resolves', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: aragornId,
    }));

    const pending = afterChain.pendingResolutions.find(r => r.kind.type === 'riddling-attempt');
    expect(pending).toBeDefined();

    const actions = computeLegalActions(afterChain, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    );
    expect(actions).toHaveLength(1);
  });

  // ── Pending action computation: sage / hobbit bonuses ─────────────────────

  test('need value with no sage/hobbit in company (Aragorn alone vs Dragon)', () => {
    // No bonus. Dragon threshold=8 → need = 8 - 0 + 1 = 9
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: aragornId,
    }));

    const action = computeLegalActions(afterChain, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    );
    expect((action!.action as { need: number }).need).toBe(9);
  });

  test('need value with a sage in the company (Gandalf vs Dragon): +2 bonus', () => {
    // Gandalf is a sage (not a hobbit). Dragon threshold=8 → need = 8 - 2 + 1 = 7
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const gandalfId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: gandalfId,
    }));

    const action = computeLegalActions(afterChain, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    );
    expect((action!.action as { need: number }).need).toBe(7);
  });

  test('need value with a Hobbit in the company (Frodo vs Man): +1 bonus', () => {
    // Frodo is a Hobbit (not a sage). Man threshold=10 → need = 10 - 1 + 1 = 10
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [FRODO] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Man });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const frodoId = charIdAt(state, RESOURCE_PLAYER);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: frodoId,
    }));

    const action = computeLegalActions(afterChain, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    );
    expect((action!.action as { need: number }).need).toBe(10);
  });

  test('need value stacks sage + hobbit bonuses across the whole company (Bilbo makes the attempt, Gandalf and Frodo are along)', () => {
    // Company: Bilbo (hobbit+sage), Gandalf (sage), Frodo (hobbit).
    // Sages = 2 (Bilbo, Gandalf) → +4. Hobbits = 2 (Bilbo, Frodo) → +2. Total bonus = 6.
    // Orc threshold=12 → need = 12 - 6 + 1 = 7
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [BILBO, GANDALF, FRODO] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const bilboId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const afterChain = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: bilboId,
    }));

    const action = computeLegalActions(afterChain, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    );
    expect((action!.action as { need: number }).need).toBe(7);
  });

  // ── Roll resolution: failure ──────────────────────────────────────────────

  test('failed roll: no riddling-guess offered, combat continues, chain fully resolves', () => {
    // Gandalf (+2 sage bonus) vs Dragon (threshold 8). Roll 6 → total = 6+2 = 8, NOT > 8 → failure.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [ORC_WARBAND], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const gandalfId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: gandalfId,
    }));

    const rollAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;

    const result = reduce({ ...s, cheatRollTotal: 6 }, rollAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).not.toBeNull();
    expect(result.state.chain).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);

    const guesses = computeLegalActions(result.state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'riddling-guess',
    );
    expect(guesses).toHaveLength(0);

    const anyViable = [
      ...computeLegalActions(result.state, PLAYER_1),
      ...computeLegalActions(result.state, PLAYER_2),
    ].some(ea => ea.viable);
    expect(anyViable).toBe(true);
  });

  // ── Roll resolution: success → riddling-guess pending ─────────────────────

  test('successful roll: attack not yet canceled, riddling-guess pending resolution offered', () => {
    // Gandalf (+2 sage bonus) vs Dragon (threshold 8). Roll 7 → total = 7+2 = 9 > 8 → success.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [ORC_WARBAND], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const gandalfId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: gandalfId,
    }));

    const rollAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;

    const result = reduce({ ...s, cheatRollTotal: 7 }, rollAction.action);
    expect(result.error).toBeUndefined();
    // The roll alone does not cancel the attack — a guess is still required.
    expect(result.state.combat).not.toBeNull();

    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'riddling-guess');
    expect(pending).toBeDefined();

    const guesses = computeLegalActions(result.state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'riddling-guess',
    );
    // One action per distinct hazard-event/hazard-creature card name.
    expect(guesses.length).toBeGreaterThan(1);
    expect(guesses.some(ea => (ea.action as { guessedCardName: string }).guessedCardName === 'Orc-warband')).toBe(true);
  });

  // ── Guess resolution: correct guess ───────────────────────────────────────

  test('correct guess: attack canceled, hazard limit decreased by 3, hand revealed', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [ORC_WARBAND], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });
    const initialLimit = (state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const gandalfId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: gandalfId,
    }));

    const rollAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;
    const afterRoll = reduce({ ...s, cheatRollTotal: 7 }, rollAction.action);
    expect(afterRoll.error).toBeUndefined();

    const opponentHandCardId = afterRoll.state.players[1].hand[0].instanceId;

    const guessAction = computeLegalActions(afterRoll.state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-guess'
        && (ea.action as { guessedCardName: string }).guessedCardName === 'Orc-warband',
    )!;
    expect(guessAction).toBeDefined();

    const result = reduce(afterRoll.state, guessAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeNull();

    const finalLimit = (result.state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;
    expect(finalLimit).toBe(Math.max(0, initialLimit - 3));

    // The opponent's hand was revealed as part of the guess.
    expect(result.state.revealedInstances[opponentHandCardId]).toBe(ORC_WARBAND);

    // Chain fully resolves — not left stuck in "resolving".
    expect(result.state.chain).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  // ── Guess resolution: wrong guess ─────────────────────────────────────────

  test('wrong guess: combat continues, hazard limit unchanged, chain fully resolves', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [GANDALF] }], hand: [RIDDLING_TALK], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [ORC_WARBAND], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Dragon });
    const initialLimit = (state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;

    const card = findHandCardId(state, RESOURCE_PLAYER, RIDDLING_TALK);
    const gandalfId = charIdAt(state, RESOURCE_PLAYER);
    const s = resolveChain(dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: card, targetCharacterId: gandalfId,
    }));

    const rollAction = computeLegalActions(s, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-attempt',
    )!;
    const afterRoll = reduce({ ...s, cheatRollTotal: 7 }, rollAction.action);
    expect(afterRoll.error).toBeUndefined();

    // Guess a card that is NOT in the opponent's hand (they hold Orc-warband, not Cave-drake).
    const guessAction = computeLegalActions(afterRoll.state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'riddling-guess'
        && (ea.action as { guessedCardName: string }).guessedCardName === 'Cave-drake',
    )!;
    expect(guessAction).toBeDefined();

    const result = reduce(afterRoll.state, guessAction.action);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).not.toBeNull();

    const finalLimit = (result.state.phaseState as { hazardLimitAtReveal?: number }).hazardLimitAtReveal ?? 0;
    expect(finalLimit).toBe(initialLimit);

    expect(result.state.chain).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);

    const anyViable = [
      ...computeLegalActions(result.state, PLAYER_1),
      ...computeLegalActions(result.state, PLAYER_2),
    ].some(ea => ea.viable);
    expect(anyViable).toBe(true);
  });
});
