/**
 * @module td-134.test
 *
 * Card test: Marvels Told (td-134)
 * Type: hero-resource-event (short, ritual)
 * Effects: 2 (play-target sage with tap cost, discard-in-play hazard non-environment permanent/long-event)
 *
 * "Sage only. Ritual. Tap a sage to force the discard of a hazard
 *  non-environment permanent-event or long-event. Sage makes a
 *  corruption check modified by -2."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  ELROND, ARAGORN, LEGOLAS,
  MARVELS_TOLD, FOOLISH_WORDS, EYE_OF_SAURON, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, mint,
  viableActions,
} from '../test-helpers.js';
import type { CardInstanceId, CardInPlay } from '../../index.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Marvels Told (td-134)', () => {
  beforeEach(() => resetMint());

  test('appears as playable with one action per eligible untapped sage', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as { type: string; targetScoutInstanceId?: CardInstanceId };
    expect(action.targetScoutInstanceId).toBeDefined();
  });

  test('not playable when sage is tapped', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Tap Elrond
    const elrondId = Object.keys(state.players[0].characters)[0];
    const tappedCharacters = {
      ...state.players[0].characters,
      [elrondId]: { ...state.players[0].characters[elrondId], status: CardStatus.Tapped },
    };
    const tappedState = {
      ...state,
      players: [
        { ...state.players[0], characters: tappedCharacters },
        state.players[1],
      ] as unknown as typeof state.players,
    };

    const playActions = viableActions(tappedState, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable if no sages in play (Legolas has no sage skill)', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing Marvels Told taps the sage and enters discard sub-flow', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    // Sage is tapped
    expect(result.state.players[0].characters[elrondId as string].status).toBe(CardStatus.Tapped);

    // Card removed from hand, in cardsInPlay while discard sub-flow resolves
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].cardsInPlay.map(c => c.instanceId)).toContain(marvelsId);

    // Discard-in-play pending effect is active
    expect(result.state.pendingEffects).toHaveLength(1);
    expect(result.state.pendingEffects[0].type).toBe('card-effect');
    expect(result.state.pendingEffects[0].effect.type).toBe('discard-in-play');
    expect(result.state.pendingEffects[0].targetCharacterId).toBe(elrondId);
  });

  test('discard sub-flow shows eligible hazard permanent-events and long-events', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const eyeOfSauronInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay, eyeOfSauronInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    // Both Foolish Words (permanent) and Eye of Sauron (long) should be eligible
    const discardActions = viableActions(result.state, PLAYER_1, 'discard-from-play');
    expect(discardActions).toHaveLength(2);
  });

  test('environment hazard events are NOT eligible for discard', () => {
    const doorsOfNightInPlay: CardInPlay = { instanceId: mint(), definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsOfNightInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    // Doors of Night has environment keyword — not eligible
    const discardActions = viableActions(result.state, PLAYER_1, 'discard-from-play');
    expect(discardActions).toHaveLength(0);

    // Pass is still available
    const passActions = viableActions(result.state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('discarding a hazard event moves it to owner discard pile and discards Marvels Told', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    // Play Marvels Told
    let result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    // Discard Foolish Words
    result = reduce(result.state, {
      type: 'discard-from-play',
      player: PLAYER_1,
      cardInstanceId: foolishWordsId,
      ownerIndex: 1,
    });
    expect(result.error).toBeUndefined();

    // Foolish Words moved from P2 cardsInPlay to P2 discard
    expect(result.state.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsId);
    expect(result.state.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsId);

    // Marvels Told moved from P1 cardsInPlay to P1 discard
    expect(result.state.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(marvelsId);
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).toContain(marvelsId);

    // Pending effects cleared
    expect(result.state.pendingEffects).toHaveLength(0);
  });

  test('sage makes a corruption check modified by -2 after discard', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    // Play Marvels Told
    let result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    // Discard Foolish Words
    result = reduce(result.state, {
      type: 'discard-from-play',
      player: PLAYER_1,
      cardInstanceId: foolishWordsId,
      ownerIndex: 1,
    });
    expect(result.error).toBeUndefined();

    // Corruption check pending for the sage (Aragorn)
    expect(result.state.pendingResolutions).toHaveLength(1);
    const resolution = result.state.pendingResolutions[0];
    expect(resolution.kind.type).toBe('corruption-check');
    if (resolution.kind.type === 'corruption-check') {
      expect(resolution.kind.characterId).toBe(elrondId);
      expect(resolution.kind.modifier).toBe(-2);
      expect(resolution.kind.reason).toBe('Marvels Told');
    }
    expect(resolution.actor).toBe(PLAYER_1);
  });

  test('pass during discard sub-flow skips the discard (no corruption check)', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    // Play Marvels Told
    let result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    // Pass to skip discard
    result = reduce(result.state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Marvels Told discarded, sub-flow cleared
    expect(result.state.pendingEffects).toHaveLength(0);
    expect(result.state.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(marvelsId);
    expect(result.state.players[0].discardPile.map(c => c.instanceId)).toContain(marvelsId);

    // Foolish Words still in play
    expect(result.state.players[1].cardsInPlay.map(c => c.definitionId)).toContain(FOOLISH_WORDS);

    // No corruption check when skipped
    expect(result.state.pendingResolutions).toHaveLength(0);
  });

  test('opponent has no actions during discard sub-flow', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    const opponentActions = computeLegalActions(result.state, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });

  test('after discard and corruption check, normal long-event actions resume', () => {
    const eyeOfSauronInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [eyeOfSauronInPlay] },
      ],
    });

    const marvelsId = state.players[0].hand[0].instanceId;
    const eyeId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    // Play Marvels Told, discard Eye of Sauron
    let result = reduce(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
    });
    expect(result.error).toBeUndefined();

    result = reduce(result.state, {
      type: 'discard-from-play',
      player: PLAYER_1,
      cardInstanceId: eyeId,
      ownerIndex: 1,
    });
    expect(result.error).toBeUndefined();

    // Corruption check is pending — resolve it
    expect(result.state.pendingResolutions).toHaveLength(1);
    const ccAction = viableActions(result.state, PLAYER_1, 'corruption-check');
    expect(ccAction).toHaveLength(1);

    result = reduce(result.state, ccAction[0].action);
    expect(result.error).toBeUndefined();

    // Still in long-event phase, pass is available
    expect(result.state.phaseState.phase).toBe(Phase.LongEvent);
    const passActions = viableActions(result.state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });
});
