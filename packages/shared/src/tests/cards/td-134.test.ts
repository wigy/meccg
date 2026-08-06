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
 * action — there is no separate discard sub-flow. Playing the card is an
 * action, so it rides the chain of effects (CoE 9.4/9.5): the tap is paid
 * at declaration and the hazard is discarded only once both players pass
 * priority.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS, BALIN, SARUMAN, GLORFINDEL_II,
  TREEBEARD,
  MARVELS_TOLD, FOOLISH_WORDS, LURE_OF_THE_SENSES, EYE_OF_SAURON, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  attachHazardToChar, attachAllyToChar, findAllyInstanceId,
  buildTestState, resetMint, mint,
  viableActions, viableFor, makeSitePhase,
  handCardId, dispatch, setCharStatus, expectCharStatus,
  makeMHState, resolveChain,
  actionAs, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardInstanceId, CardInPlay, PlayShortEventAction, EndOfTurnPhaseState } from '../../index.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type { SupportCorruptionCheckAction } from '../../types/actions-universal.js';

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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay, eyeOfSauronInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(2);
    const targets = playActions.map(a => actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId);
    expect(new Set(targets).size).toBe(2);
  });

  test('not playable during site phase when all sages in company are tapped', () => {
    // Regression for bug 968f3cdc266c6e1a (game mo7crwje-bwhvvs, seq 171):
    // during the resource player's site phase, two sages (Saruman and
    // Glorfindel II) were both tapped and a Foolish Words hazard was in
    // play. The engine offered Marvels Told naming the tapped sages as
    // tap targets — a tapped character cannot pay the tap cost. No play
    // action must be emitted.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [SARUMAN, GLORFINDEL_II] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const withSarumanTapped = setCharStatus(base, RESOURCE_PLAYER, SARUMAN, CardStatus.Tapped);
    const bothTapped = setCharStatus(withSarumanTapped, RESOURCE_PLAYER, GLORFINDEL_II, CardStatus.Tapped);
    const state = { ...bothTapped, phaseState: makeSitePhase() };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
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

    const tappedState = setCharStatus(state, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

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

    const marvelsId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    }));

    // Sage is tapped
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

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

    const marvelsId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    }));

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

  test('CoE 7.1.1: an untapped company mate may tap in support of the sage\'s corruption check', () => {
    // Bug report (game mshdxsru-3m4nwy, seq 1063): marric1976 played Marvels
    // Told with a sage in a multi-character company. The engine enqueued the
    // sage's corruption check but never offered the untapped company mate's
    // tap-in-support option (CoE 7.1.1), which applies to any corruption
    // check that has been declared but not yet resolved.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };

    const state = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND, ARAGORN] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const marvelsId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const chars = state.players[0].characters;
    const elrondId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ELROND)!;
    const aragornId = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ARAGORN)!;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    }));

    const supports = viableFor(next, PLAYER_1)
      .filter(a => a.action.type === 'support-corruption-check') as { action: SupportCorruptionCheckAction }[];

    expect(supports.some(a =>
      a.action.supportingCharacterId === aragornId &&
      a.action.targetCharacterId === elrondId,
    )).toBe(true);
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

    const marvelsId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    }));

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

    const marvelsId = handCardId(state, RESOURCE_PLAYER);
    const eyeId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const afterPlay = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: eyeId,
    }));

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
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
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
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
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
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
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

    const marvelsId = handCardId(state, RESOURCE_PLAYER);
    const foolishWordsId = state.players[1].cardsInPlay[0].instanceId;
    const elrondId = Object.keys(state.players[0].characters)[0] as unknown as CardInstanceId;

    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondId,
      discardTargetInstanceId: foolishWordsId,
    }));

    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsId);
    expect(next.players[0].hand).toHaveLength(0);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(marvelsId);
  });

  test('multiple sages with a single eligible hazard each emit a distinct action carrying the discard target', () => {
    // Reported in bug d0d7a36c40bc6e18 (game mo13g8zo-gyai85, seq ~322):
    // the resource player had two untapped sages (Balin and Saruman) and
    // exactly one eligible hazard in play (Eye of Sauron). The browser UI
    // entered the sage-selection flow and silently used `.find()` to commit
    // Eye of Sauron as the discard target — the player never saw or chose
    // the hazard. The engine must continue to emit one action per
    // (sage × hazard) combination — each carrying the same
    // `discardTargetInstanceId` — so the UI disambiguation layer can show
    // the target explicitly.
    const eyeOfSauronInPlay: CardInPlay = { instanceId: mint(), definitionId: EYE_OF_SAURON, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [BALIN, SARUMAN] },
          ],
          hand: [MARVELS_TOLD],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [eyeOfSauronInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(2);

    // Each action must carry the hazard as the discard target so the UI can
    // render it in a disambiguation menu.
    const discardTargets = playActions.map(a => actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId);
    expect(new Set(discardTargets)).toEqual(new Set([eyeOfSauronInPlay.instanceId]));

    // The two actions must differ on the sage axis (Balin vs. Saruman).
    const sageTargets = playActions.map(a => actionAs<PlayShortEventAction>(a.action).targetScoutInstanceId);
    expect(new Set(sageTargets).size).toBe(2);
  });

  test('playable during site phase select-company step (CoE 2.1.1)', () => {
    // Regression for bug 22fb5fd2f5acf7c8 (game mo8vm8nd-zh71f8, seq 105):
    // during the site phase's `select-company` step the engine did not offer
    // Marvels Told even though the active player had an untapped sage and a
    // qualifying hazard in play. Rule 2.1.1 allows resource short-events
    // during any phase of the active player's turn.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = {
      ...base,
      phaseState: makeSitePhase({ step: 'select-company', siteEntered: false }),
    };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);
  });

  test('playable during end-of-turn discard step (CoE 2.1.1)', () => {
    // Regression for bug 22fb5fd2f5acf7c8 (game mo8vm8nd-zh71f8, seq 111):
    // in the end-of-turn phase's `discard` step the engine did not offer
    // Marvels Told, forcing the player to discard it instead of playing it.
    // Rule 2.1.1 allows the active player's resource short-events during
    // any phase of their turn; the voluntary discard step qualifies.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);
  });

  test('playable during end-of-turn signal-end step (CoE 2.1.1)', () => {
    // After resetting hand size, the active player reaches the signal-end
    // step. Resource short-events must remain playable here per rule 2.1.1
    // so the player can still discard a qualifying hazard before the turn
    // ends.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const signalEndPhase: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };
    const state = { ...base, phaseState: signalEndPhase };

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBeDefined();
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);
  });

  test('not offered to non-active player during end-of-turn discard step', () => {
    // The hazard player still cannot play resource short-events during the
    // opponent's end-of-turn phase, even if they hold Marvels Told and a
    // qualifying hazard is in play.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const state = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MARVELS_TOLD], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });

    const playActions = viableActions(state, PLAYER_2, 'play-short-event');
    expect(playActions).toHaveLength(0);
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
    const withFoolishWords = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, FOOLISH_WORDS);
    const state = attachHazardToChar(withFoolishWords, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES);

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    // One action per attached hazard target. Elrond is the only sage, so
    // the sage axis collapses to one.
    expect(playActions).toHaveLength(2);
    const targetIds = new Set(playActions.map(a =>
      actionAs<PlayShortEventAction>(a.action).discardTargetInstanceId,
    ));

    const chars = state.players[0].characters;
    const aragornKey = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ARAGORN)!;
    const elrondKey = (Object.keys(chars) as CardInstanceId[]).find(k => chars[k].definitionId === ELROND)!;
    const attachedHazardIds = chars[aragornKey].hazards.map(h => h.instanceId);
    expect(attachedHazardIds).toHaveLength(2);
    for (const hid of attachedHazardIds) {
      expect(targetIds.has(hid)).toBe(true);
    }

    // Dispatching the action for the first attached hazard moves that
    // hazard to the owner's discard pile and leaves the other attached.
    const marvelsId = handCardId(state, RESOURCE_PLAYER);
    const firstTargetId = attachedHazardIds[0];
    const next = resolveChain(dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: marvelsId,
      targetScoutInstanceId: elrondKey as unknown as CardInstanceId,
      discardTargetInstanceId: firstTargetId,
    }));
    const aragornAfter = next.players[0].characters[aragornKey];
    expect(aragornAfter.hazards.map(h => h.instanceId)).not.toContain(firstTargetId);
    expect(aragornAfter.hazards).toHaveLength(1);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(firstTargetId);
  });

  test('a sage ally (Treebeard) can tap to play it (rule 2.V.2.2, bug ed155762ed62402e)', () => {
    // Reported in bug ed155762ed62402e (game mqi3vh2z-32ok2s, seq 1065):
    // Treebeard — a Sage ally — could not be tapped to play Marvels Told even
    // though no other sage was available. Per CoE rule 2.V.2.2 allies are
    // treated as characters for "skill only" cards, so a sage ally must be
    // an eligible tap target. Legolas (the host) has no sage skill, so the
    // play is only possible via Treebeard.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
    const treebeardId = findAllyInstanceId(state, RESOURCE_PLAYER, LEGOLAS, TREEBEARD)!;

    // Exactly one play action, tapping Treebeard and discarding Foolish Words.
    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);
    const action = actionAs<PlayShortEventAction>(playActions[0].action);
    expect(action.targetScoutInstanceId).toBe(treebeardId);
    expect(action.discardTargetInstanceId).toBe(foolishWordsInPlay.instanceId);

    // Playing it taps the ally, discards the hazard, and discards Marvels Told.
    const next = resolveChain(dispatch(state, action));
    const legolasAfter = next.players[0].characters[
      (Object.keys(next.players[0].characters) as CardInstanceId[]).find(
        k => next.players[0].characters[k].definitionId === LEGOLAS,
      )!
    ];
    const treebeardAfter = legolasAfter.allies.find(a => a.instanceId === treebeardId)!;
    expect(treebeardAfter.status).toBe(CardStatus.Tapped);
    expect(next.players[1].cardsInPlay.map(c => c.instanceId)).not.toContain(foolishWordsInPlay.instanceId);
    expect(next.players[1].discardPile.map(c => c.instanceId)).toContain(foolishWordsInPlay.instanceId);
    expect(next.players[0].discardPile.map(c => c.instanceId)).toContain(handCardId(state, RESOURCE_PLAYER));

    // Rule 7.4: allies never make corruption checks — none is enqueued.
    expect(next.pendingResolutions).toHaveLength(0);
  });

  test('a tapped sage ally is not offered as a tap target', () => {
    // The ally counterpart of "not playable when sage is tapped": a tapped
    // Treebeard cannot pay the tap cost, and Legolas is not a sage, so
    // Marvels Told has no eligible sage and must not be playable.
    const foolishWordsInPlay: CardInPlay = { instanceId: mint(), definitionId: FOOLISH_WORDS, status: CardStatus.Untapped };
    const base = buildTestState({
      phase: Phase.LongEvent,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [foolishWordsInPlay] },
      ],
    });
    const withTreebeard = attachAllyToChar(base, RESOURCE_PLAYER, LEGOLAS, TREEBEARD);
    const treebeardId = findAllyInstanceId(withTreebeard, RESOURCE_PLAYER, LEGOLAS, TREEBEARD)!;
    const legolasKey = (Object.keys(withTreebeard.players[0].characters) as CardInstanceId[]).find(
      k => withTreebeard.players[0].characters[k].definitionId === LEGOLAS,
    )!;
    const legolas = withTreebeard.players[0].characters[legolasKey];
    const tappedTreebeard = {
      ...withTreebeard,
      players: [
        {
          ...withTreebeard.players[0],
          characters: {
            ...withTreebeard.players[0].characters,
            [legolasKey]: {
              ...legolas,
              allies: legolas.allies.map(a => a.instanceId === treebeardId ? { ...a, status: CardStatus.Tapped } : a),
            },
          },
        },
        withTreebeard.players[1],
      ] as typeof withTreebeard.players,
    };

    const playActions = viableActions(tappedTreebeard, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(0);
  });
});
