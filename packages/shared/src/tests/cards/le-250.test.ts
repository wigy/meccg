/**
 * @module le-250.test
 *
 * Card test: Voices of Malice (le-250)
 * Type: minion-resource-event (short)
 * Effects: 2 (play-target sage with tap cost, discard-in-play hazard
 * non-environment permanent/long-event with corruption-check -2)
 *
 * "Sage only. Tap a sage to discard one non-environment hazard
 *  permanent-event or non-environment hazard long-event. Sage makes a
 *  corruption check modified by -2."
 *
 * This is the minion-side counterpart to Marvels Told (td-134): identical
 * mechanics, drawn against minion fixtures. The `play-target` +
 * `discard-in-play` DSL is alignment-agnostic in the engine — broadening
 * the resource-short-event enumerators and the organization/long-event
 * reducer routing to accept `minion-resource-event` alongside
 * `hero-resource-event` is what makes this card playable.
 *
 * The compulsory discard target is already visible in play, so the
 * target is chosen at play time as part of the play-short-event action —
 * there is no separate discard sub-flow.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  FOOLISH_WORDS, LURE_OF_THE_SENSES, EYE_OF_SAURON, DOORS_OF_NIGHT,
  attachHazardToChar,
  buildTestState, resetMint, mint,
  viableActions, makeSitePhase,
  handCardId, dispatch, setCharStatus, expectCharStatus,
  makeMHState,
  actionAs, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardInstanceId, CardInPlay, PlayShortEventAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';

const VOICES_OF_MALICE = 'le-250' as CardDefinitionId;

// Minion fixtures — referenced only in this test file, so declared
// locally per the `card-ids.ts` constants policy in CLAUDE.md.
const LAYOS = 'le-19' as CardDefinitionId;        // sage + diplomat, man, mind 5
const CIRYAHER = 'le-6' as CardDefinitionId;      // scout + sage, dúnadan, mind 5
const OSTISEN = 'le-36' as CardDefinitionId;      // scout only (no sage), man, mind 2

const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // minion shadow-hold

describe('Voices of Malice (le-250)', () => {
  beforeEach(() => resetMint());

  test('playable once per (sage × eligible hazard) pair', () => {
    // One sage, one hazard event → exactly one play action carrying both
    // the sage to tap and the hazard to discard.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(state.players[1].cardsInPlay[0].instanceId);
  });

  test('one action per hazard when multiple valid targets exist', () => {
    // Foolish Words (permanent) + Eye of Sauron (long) → 2 play actions,
    // one per discard target.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const eyeOfSauronInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay, eyeOfSauronInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(2);
    const targets = playActions.map(a => actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId);
    expect(new Set(targets).size).toBe(2);
  });

  test('not playable when sage is tapped', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const tappedState = setCharStatus(state, RESOURCE_PLAYER, LAYOS, CardStatus.Tapped);

    const playActions = viableActions(tappedState, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable if no sages in play (Ostisen has scout skill but no sage skill)', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [OSTISEN] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when only environment hazard events are in play', () => {
    // Doors of Night has the environment keyword and so is not a valid
    // target. With no other hazard permanent/long events in play, Voices
    // of Malice has nothing to discard and the compulsory discard cannot
    // be resolved — the card must not be playable.
    const doorsOfNightInPlay: CardInPlay = { instanceId: mint(), definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [doorsOfNightInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when no hazard permanent/long events are in play', () => {
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing resolves in one step: tap sage, move hazard to owner discard, discard Voices of Malice', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const voicesId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const layosId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: voicesId,
      targetScoutInstanceId: layosId,
      discardTargetInstanceId: foolishWordsId,
    });

    // Sage is tapped
    expectCharStatus(next, RESOURCE_PLAYER, LAYOS, CardStatus.Tapped);

    // Foolish Words moved from P2 cardsInPlay to P2 discard
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsId);

    // Voices of Malice moved from P1 hand straight to P1 discard
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(voicesId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(voicesId);

    // No lingering pendingEffects sub-flow
    expect(next.pendingEffects).toHaveLength(0);
  });

  test('sage makes a corruption check modified by -2 after resolution', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const voicesId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const layosId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: voicesId,
      targetScoutInstanceId: layosId,
      discardTargetInstanceId: foolishWordsId,
    });

    expect(next.pendingResolutions).toHaveLength(1);
    const resolution = next.pendingResolutions[0];
    expect(resolution.kind.type).toBe('corruption-check');
    if (resolution.kind.type === 'corruption-check') {
      expect(resolution.kind.characterId).toBe(layosId);
      expect(resolution.kind.modifier).toBe(-2);
      expect(resolution.kind.reason).toBe('Voices of Malice');
    }
    expect(resolution.actor).toBe(PLAYER_1);
  });

  test('opponent has no actions while the sage resolves the corruption check', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const voicesId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const layosId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: voicesId,
      targetScoutInstanceId: layosId,
      discardTargetInstanceId: foolishWordsId,
    });

    const opponentActions = computeLegalActions(next, PLAYER_2);
    expect(opponentActions).toHaveLength(0);
  });

  test('after the corruption check resolves, normal long-event actions resume', () => {
    const eyeOfSauronInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [eyeOfSauronInPlay] },
      ],
    });

    const voicesId = handCardId(state, RESOURCE_PLAYER);
    const eyeId = state.players[1].cardsInPlay[0].instanceId;
    const layosId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: voicesId,
      targetScoutInstanceId: layosId,
      discardTargetInstanceId: eyeId,
    });

    expect(afterPlay.pendingResolutions).toHaveLength(1);
    const ccAction = viableActions(afterPlay, PLAYER_1, 'corruption-check');
    expect(ccAction).toHaveLength(1);

    const afterCC = dispatch(afterPlay, ccAction[0].action);

    expect(afterCC.phaseState.phase).toBe(Phase.LongEvent);
    const passActions = viableActions(afterCC, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('playable during organization phase with proper targeting', () => {
    const eyeOfSauronInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [eyeOfSauronInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(state.players[1].cardsInPlay[0].instanceId);
  });

  test('not playable during organization when no hazard events in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playable during movement-hazard play-hazards step (rule 2.1.1)', () => {
    // Rule 2.1.1 allows resource short-events during any phase of the
    // active player's turn.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);
  });

  test('playing during MH phase play-hazards resolves: tap sage, discard hazard, discard Voices of Malice', () => {
    // Regression: the MH reducer used to route every `play-short-event`
    // to the hazard env-cancel handler, which called
    // `resolveInstanceId(state, undefined)` and crashed (surfacing as
    // "Invalid message format" to the client). Ensure the resource
    // short-event path is taken and the card resolves inline.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const voicesId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const layosId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: voicesId,
      targetScoutInstanceId: layosId,
      discardTargetInstanceId: foolishWordsId,
    });

    expectCharStatus(next, RESOURCE_PLAYER, LAYOS, CardStatus.Tapped);
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsId);
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(voicesId);
    expect(next.chain).toBeNull();
  });

  test('not playable during MH phase when no hazard permanent/long events in play', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playable during site phase play-resources step (CoE 2.1.1)', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);
  });

  test('playing during site phase resolves: tap sage, discard hazard, discard Voices of Malice', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const voicesId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const layosId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: voicesId,
      targetScoutInstanceId: layosId,
      discardTargetInstanceId: foolishWordsId,
    });

    expectCharStatus(next, RESOURCE_PLAYER, LAYOS, CardStatus.Tapped);
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsId);
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(voicesId);
  });

  test('multiple sages with a single eligible hazard each emit a distinct action carrying the discard target', () => {
    // With two untapped sages (Layos and Ciryaher) and a single eligible
    // hazard (Eye of Sauron), the engine must emit one action per sage ×
    // hazard combination — each carrying the same discardTargetInstanceId —
    // so the UI disambiguation layer can show the target explicitly.
    const eyeOfSauronInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: DOL_GULDUR, characters: [LAYOS, CIRYAHER] },
          ],
          hand: [VOICES_OF_MALICE],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION], cardsInPlay: [eyeOfSauronInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(2);

    // Each action must carry the hazard as the discard target.
    const discardTargets = playActions.map(a => actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId);
    expect(new Set(discardTargets)).toEqual(new Set([eyeOfSauronInPlay.instanceId]));

    // The two actions must differ on the sage axis (Layos vs. Ciryaher).
    const sageTargets = playActions.map(a => actionAs<PlayShortEventAction>(a.action).targetScoutInstanceId);
    expect(new Set(sageTargets).size).toBe(2);
  });

  test('targets hazards attached to characters (Foolish Words, Lure of the Senses)', () => {
    // Hazard permanent-events attached to characters (stored in
    // `character.hazards` rather than the general `cardsInPlay` list) must
    // be enumerated as discard-in-play targets.
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS, CIRYAHER] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const withFoolishWords = attachHazardToChar(base, RESOURCE_PLAYER, CIRYAHER, FOOLISH_WORDS);
    const state = attachHazardToChar(withFoolishWords, RESOURCE_PLAYER, CIRYAHER, LURE_OF_THE_SENSES);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    // Two attached hazards × two sages = 4 actions.
    expect(playActions).toHaveLength(4);
    const targetIds = new Set(playActions.map(a =>
      actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId,
    ));

    const chars = state.players[0].characters;
    const ciryaherKey = Object.keys(chars).find(k => chars[k].definitionId === CIRYAHER)!;
    const attachedHazardIds = chars[ciryaherKey].hazards.map(h => h.instanceId);
    expect(attachedHazardIds).toHaveLength(2);
    for (const hid of attachedHazardIds) {
      expect(targetIds.has(hid)).toBe(true);
    }

    // Dispatching the action for the first attached hazard moves that
    // hazard to the owner's discard pile and leaves the other attached.
    const voicesId = handCardId(state, RESOURCE_PLAYER);
    const layosKey = Object.keys(chars).find(k => chars[k].definitionId === LAYOS)!;
    const firstTargetId = attachedHazardIds[0];
    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: voicesId,
      targetScoutInstanceId: layosKey as unknown as CardInstanceId,
      discardTargetInstanceId: firstTargetId,
    });
    const ciryaherAfter = next.players[0].characters[ciryaherKey];
    expect(ciryaherAfter.hazards.map(h => h.instanceId)).not.toContain(firstTargetId);
    expect(ciryaherAfter.hazards).toHaveLength(1);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(firstTargetId);
  });

  test('emits distinct actions when the same hazard type is attached to characters of both players', () => {
    // Regression: a game (mo8gx6ts-go9s38, state 168) had Foolish Words
    // attached to a P1 character AND another Foolish Words attached to a P2
    // character. Both are legal discard targets per the card text, so the
    // engine must emit two distinct play actions — one per hazard instance.
    // The UI disambiguation layer uses the bearer character to render the
    // two actions differently; the engine's contract here is just that each
    // action carries a unique `discardTargetInstanceId`.
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LAYOS, CIRYAHER] }], hand: [VOICES_OF_MALICE], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const withP1Hazard = attachHazardToChar(base, RESOURCE_PLAYER, CIRYAHER, FOOLISH_WORDS);
    const state = attachHazardToChar(withP1Hazard, 1, OSTISEN, FOOLISH_WORDS);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    // Two sages × two Foolish Words (one per player's character) = 4 actions.
    expect(playActions).toHaveLength(4);

    const discardTargetIds = playActions.map(a =>
      actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId,
    );

    // Each (sage, hazard) combination yields a unique action.
    expect(new Set(discardTargetIds).size).toBe(2);
    const uniquePairs = new Set(playActions.map(a => {
      const action = actionAs<PlayShortEventAction>(a.action);
      return `${action.targetScoutInstanceId}:${action.discardTargetInstanceId}`;
    }));
    expect(uniquePairs.size).toBe(4);

    // The two hazard instance IDs must correspond to the two Foolish Words
    // attached to characters on opposite sides of the table.
    const p1Chars = state.players[0].characters;
    const ciryaherKey = Object.keys(p1Chars).find(k => p1Chars[k].definitionId === CIRYAHER)!;
    const p1HazardId = p1Chars[ciryaherKey].hazards[0].instanceId;
    const p2Chars = state.players[1].characters;
    const ostisenKey = Object.keys(p2Chars).find(k => p2Chars[k].definitionId === OSTISEN)!;
    const p2HazardId = p2Chars[ostisenKey].hazards[0].instanceId;
    expect(new Set(discardTargetIds)).toEqual(new Set([p1HazardId, p2HazardId]));
  });
});
