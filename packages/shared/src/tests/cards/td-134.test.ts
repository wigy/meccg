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
 *
 * The discard is compulsory and its target is already visible in play,
 * so the target is chosen at play time as part of the play-short-event
 * action — there is no separate discard sub-flow.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS,
  MARVELS_TOLD, FOOLISH_WORDS, LURE_OF_THE_SENSES, EYE_OF_SAURON, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  attachHazardToChar,
  buildTestState, resetMint, mint,
  viableActions, makeSitePhase,
  handCardId, dispatch, setCharStatus, expectCharStatus,
  makeMHState,
} from '../test-helpers.js';
import type { CardInstanceId, CardInPlay } from '../../index.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Marvels Told (td-134)', () => {
  beforeEach(() => resetMint());

  test('playable once per (sage × eligible hazard) pair', () => {
    // One sage, one hazard event → exactly one play action carrying both
    // the sage to tap and the hazard to discard.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as {
      type: string;
      targetScoutInstanceId?: CardInstanceId;
      discardTargetInstanceId?: CardInstanceId;
    };
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay, eyeOfSauronInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(2);
    const targets = playActions.map(a => (a.action as { discardTargetInstanceId?: CardInstanceId }).discardTargetInstanceId);
    expect(new Set(targets).size).toBe(2);
  });

  test('not playable when sage is tapped', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const tappedState = setCharStatus(state, 0, ELROND, CardStatus.Tapped);

    const playActions = viableActions(tappedState, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable if no sages in play (Legolas has no sage skill)', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('not playable when only environment hazard events are in play', () => {
    // Doors of Night has the environment keyword and so is not a valid
    // target. With no other hazard permanent/long events in play, Marvels
    // Told has nothing to discard and the compulsory discard cannot be
    // resolved — the card must not be playable.
    const doorsOfNightInPlay: CardInPlay = { instanceId: mint(), definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [doorsOfNightInPlay] },
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playing resolves in one step: tap sage, move hazard to owner discard, discard Marvels Told', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = handCardId(state, 0);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    });

    // Sage is tapped
    expectCharStatus(next, 0, ELROND, CardStatus.Tapped);

    // Foolish Words moved from P2 cardsInPlay to P2 discard
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsId);

    // Marvels Told moved from P1 hand straight to P1 discard (no cardsInPlay stop)
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].cardsInPlay.map(c => c.instanceId)).not.toContain(marvelsId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(marvelsId);

    // No lingering pendingEffects sub-flow
    expect(next.pendingEffects).toHaveLength(0);
  });

  test('sage makes a corruption check modified by -2 after resolution', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = handCardId(state, 0);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    });

    expect(next.pendingResolutions).toHaveLength(1);
    const resolution = next.pendingResolutions[0];
    expect(resolution.kind.type).toBe('corruption-check');
    if (resolution.kind.type === 'corruption-check') {
      expect(resolution.kind.characterId).toBe(elrondId);
      expect(resolution.kind.modifier).toBe(-2);
      expect(resolution.kind.reason).toBe('Marvels Told');
    }
    expect(resolution.actor).toBe(PLAYER_1);
  });

  test('opponent has no actions while the sage resolves the corruption check', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = handCardId(state, 0);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [eyeOfSauronInPlay] },
      ],
    });

    const marvelsId = handCardId(state, 0);
    const eyeId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const afterPlay = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [eyeOfSauronInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as {
      type: string;
      targetScoutInstanceId?: CardInstanceId;
      discardTargetInstanceId?: CardInstanceId;
    };
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(state.players[1].cardsInPlay[0].instanceId);
  });

  test('not playable during organization when no hazard events in play', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playable during movement-hazard play-hazards step (rule 2.1.1)', () => {
    // Reported in bug b7bdb6e11cafeb5e (game mo13g8zo-gyai85): during the
    // resource player's own movement/hazard phase, the engine did not
    // enumerate Marvels Told even though a sage was untapped and a
    // qualifying hazard long-event was in the opponent's cards-in-play.
    // Rule 2.1.1 allows resource short-events during any phase of the
    // active player's turn.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as {
      type: string;
      targetScoutInstanceId?: CardInstanceId;
      discardTargetInstanceId?: CardInstanceId;
    };
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);
  });

  test('not playable during MH phase when no hazard permanent/long events in play', () => {
    // Even though the resource player may play short-events during MH,
    // Marvels Told still requires a qualifying discard target — with none
    // in play, the card is not playable.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });

  test('playable during site phase play-resources step (CoE 2.1.1)', () => {
    // Regression: resource short-events may be played during any phase of
    // the active player's turn. Previously, the site phase legal-action
    // handler only emitted permanent events and items and marked all other
    // hand cards — including ritual short-events like Marvels Told — as
    // "not playable during site phase".
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = playActions[0].action as {
      type: string;
      targetScoutInstanceId?: CardInstanceId;
      discardTargetInstanceId?: CardInstanceId;
    };
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);
  });

  test('playing during site phase resolves: tap sage, discard hazard, discard Marvels Told', () => {
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const marvelsId = handCardId(state, 0);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    });

    expectCharStatus(next, 0, ELROND, CardStatus.Tapped);
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsId);
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(marvelsId);
  });

  test('targets hazards attached to characters (Foolish Words, Lure of the Senses)', () => {
    // Regression for a bug where hazard permanent-events attached to
    // characters (stored in `character.hazards` rather than the general
    // `cardsInPlay` list) were not enumerated as discard-in-play targets.
    // Marvels Told should be able to discard them just like a free-standing
    // hazard permanent- or long-event.
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withFoolishWords = attachHazardToChar(base, 0, ARAGORN, FOOLISH_WORDS);
    const state = attachHazardToChar(withFoolishWords, 0, ARAGORN, LURE_OF_THE_SENSES);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    // One action per attached hazard target. Elrond is the only sage, so
    // the sage axis collapses to one.
    expect(playActions).toHaveLength(2);
    const targetIds = new Set(playActions.map(a =>
      (a.action as { discardTargetInstanceId?: CardInstanceId }).discardTargetInstanceId,
    ));

    const chars = state.players[0].characters;
    const aragornKey = Object.keys(chars).find(k => chars[k].definitionId === ARAGORN)!;
    const elrondKey = Object.keys(chars).find(k => chars[k].definitionId === ELROND)!;
    const attachedHazardIds = chars[aragornKey].hazards.map(h => h.instanceId);
    expect(attachedHazardIds).toHaveLength(2);
    for (const hid of attachedHazardIds) {
      expect(targetIds.has(hid)).toBe(true);
    }

    // Dispatching the action for the first attached hazard moves that
    // hazard to the owner's discard pile and leaves the other attached.
    const marvelsId = handCardId(state, 0);
    const firstTargetId = attachedHazardIds[0];
    const next = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondKey as unknown as CardInstanceId,
      discardTargetInstanceId: firstTargetId,
    });
    const aragornAfter = next.players[0].characters[aragornKey];
    expect(aragornAfter.hazards.map(h => h.instanceId)).not.toContain(firstTargetId);
    expect(aragornAfter.hazards).toHaveLength(1);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(firstTargetId);
  });
});
