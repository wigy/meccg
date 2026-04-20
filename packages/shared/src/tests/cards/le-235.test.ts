/**
 * @module le-235.test
 *
 * Card test: Sudden Call (le-235)
 * Type: minion-resource-event (short)
 * Effects:
 *   1. play-flag: playable-as-hazard — dual-nature short event
 *   2. call-council (lastTurnFor: opponent) — resource-side endgame trigger
 *   3. call-council (lastTurnFor: self) — hazard-side endgame trigger
 *   4. reshuffle-self-from-hand — return to play deck from hand any time
 *
 * "You may play this card as a resource or a hazard according to The Audience
 * of Sauron Rules. This card may not be played as a hazard against a Wizard
 * player, and may be included as a hazard in a Wizard's deck. You may
 * reshuffle this card into your play deck at any time that it is in your
 * hand (show opponent)."
 *
 * Engine support per CoE rule 10.41:
 * | # | Feature                                            | Status      |
 * |---|----------------------------------------------------|-------------|
 * | 1 | Minion/Balrog players cannot freely call-free-council | IMPLEMENTED |
 * | 2 | Resource-side: caller meets endgame → opponent last | IMPLEMENTED |
 * | 3 | Hazard-side: opponent meets endgame → caller last   | IMPLEMENTED |
 * | 4 | Hazard not playable against Wizard / Fallen-wizard  | IMPLEMENTED |
 * | 5 | Reshuffle-from-hand available in strategy steps     | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, makeMHState, dispatch, handCardId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, EndOfTurnPhaseState, PlayShortEventAction, PlayHazardAction,
} from '../../index.js';

const SUDDEN_CALL = 'le-235' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const OSTISEN = 'le-36' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

// Hero fixtures used for cross-alignment scenarios.
const ARAGORN = 'tw-156' as CardDefinitionId;
const RIVENDELL = 'tw-319' as CardDefinitionId;
const MORIA_HERO = 'tw-351' as CardDefinitionId;

describe('Sudden Call (le-235)', () => {
  beforeEach(() => resetMint());

  // ─── Resource-side ───────────────────────────────────────────────────────

  test('resource-side: Minion caller at threshold — Sudden Call is a viable short-event play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [SUDDEN_CALL],
          siteDeck: [MINAS_MORGUL],
          marshallingPoints: { character: 25 },
          deckExhaustionCount: 1,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA_HERO],
        },
      ],
    });
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThan(0);
    const suddenCallId = handCardId(state, RESOURCE_PLAYER);
    expect((plays[0].action as PlayShortEventAction).cardInstanceId).toBe(suddenCallId);
  });

  test('resource-side: caller below threshold — not playable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [SUDDEN_CALL],
          siteDeck: [MINAS_MORGUL],
          marshallingPoints: { character: 5 },
          deckExhaustionCount: 0,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA_HERO],
        },
      ],
    });
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('resource-side resolution: transitions to opponent last turn', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [SUDDEN_CALL],
          siteDeck: [MINAS_MORGUL],
          marshallingPoints: { character: 25 },
          deckExhaustionCount: 1,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: cardId });
    expect(next.players[RESOURCE_PLAYER].freeCouncilCalled).toBe(true);
    expect(next.lastTurnFor).toBe(PLAYER_2);
    expect(next.activePlayer).toBe(PLAYER_2);
    expect(next.players[RESOURCE_PLAYER].discardPile.map(c => c.definitionId)).toContain(SUDDEN_CALL);
    expect(next.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === SUDDEN_CALL)).toBe(false);
  });

  // ─── Hazard-side ─────────────────────────────────────────────────────────

  test('hazard-side: Minion hazard player with Minion opponent at threshold — viable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          marshallingPoints: { character: 25 },
          deckExhaustionCount: 1,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [SUDDEN_CALL],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const suddenCallPlays = plays.filter(a =>
      (a.action as PlayHazardAction).cardInstanceId === handCardId(state, HAZARD_PLAYER));
    expect(suddenCallPlays.length).toBe(1);
  });

  test('hazard-side: NOT playable against a Wizard-aligned opponent', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA_HERO],
          marshallingPoints: { character: 25 },
          deckExhaustionCount: 1,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [SUDDEN_CALL],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const suddenCallPlays = plays.filter(a =>
      (a.action as PlayHazardAction).cardInstanceId === handCardId(state, HAZARD_PLAYER));
    expect(suddenCallPlays.length).toBe(0);
  });

  test('hazard-side: NOT playable against a Fallen-wizard-aligned opponent', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA_HERO],
          marshallingPoints: { character: 25 },
          deckExhaustionCount: 1,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [SUDDEN_CALL],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const suddenCallPlays = plays.filter(a =>
      (a.action as PlayHazardAction).cardInstanceId === handCardId(state, HAZARD_PLAYER));
    expect(suddenCallPlays.length).toBe(0);
  });

  test('hazard-side resolution: transitions with caller (hazard player) getting last turn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          marshallingPoints: { character: 25 },
          deckExhaustionCount: 1,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [SUDDEN_CALL],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };
    const cardId = handCardId(state, HAZARD_PLAYER);
    const cId = state.players[RESOURCE_PLAYER].companies[0].id;
    const next = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: cId,
    });
    expect(next.players[HAZARD_PLAYER].freeCouncilCalled).toBe(true);
    expect(next.lastTurnFor).toBe(PLAYER_2);
    expect(next.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).toContain(SUDDEN_CALL);
    expect(next.players[HAZARD_PLAYER].hand.some(c => c.definitionId === SUDDEN_CALL)).toBe(false);
  });

  // ─── Reshuffle-from-hand ─────────────────────────────────────────────────

  test('reshuffle-card-from-hand is offered during signal-end step', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [SUDDEN_CALL],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const phaseState: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    } as EndOfTurnPhaseState;
    const state = { ...base, phaseState };

    const actionTypes = computeLegalActions(state, PLAYER_1).map(ea => ea.action.type);
    expect(actionTypes).toContain('reshuffle-card-from-hand');
  });

  test('reshuffle-card-from-hand returns card to play deck', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }],
          hand: [SUDDEN_CALL],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const phaseState: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    } as EndOfTurnPhaseState;
    const state = { ...base, phaseState };

    const cardId = handCardId(state, RESOURCE_PLAYER);
    const next = dispatch(state, { type: 'reshuffle-card-from-hand', player: PLAYER_1, cardInstanceId: cardId });
    expect(next.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(next.players[RESOURCE_PLAYER].playDeck.some(c => c.instanceId === cardId)).toBe(true);
  });
});
