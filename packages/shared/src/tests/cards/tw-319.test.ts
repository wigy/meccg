/**
 * @module tw-319.test
 *
 * Card test: Risky Blow (tw-319)
 * Type: hero-resource-event (short)
 * Effects: 1 (modify-strike: +3 prowess, -1 body, warrior only)
 *
 * "Warrior only against one strike. +3 to prowess and -1 to body."
 *
 * This tests:
 * 1. play-strike-event action appears during resolve-strike for a
 *    warrior defender when Risky Blow is in hand.
 * 2. Need is reduced by 3 compared to normal tap-to-fight.
 * 3. Playing the card discards it and the defender's tap still
 *    follows the chosen resolve-strike (unlike dodge).
 * 4. Wounded defender's body check picks up the -1 body penalty.
 * 5. Not available for a non-warrior defender.
 * 6. Not playable as a short event during organization (combat-only).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GIMLI,
  CAVE_DRAKE,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  setupCombatWithCaveDrake, assignBothStrikesTo,
  handCardId, dispatch, expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type {
  CardDefinitionId,
  PlayStrikeEventAction, BodyCheckRollAction, ResolveStrikeAction,
  PlayShortEventAction, NotPlayableAction,
} from '../../index.js';

const RISKY_BLOW = 'tw-319' as CardDefinitionId;

describe('Risky Blow (tw-319)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event appears during resolve-strike for a warrior', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [RISKY_BLOW],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rbActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(rbActions.length).toBe(1);
    expect(actionAs<PlayStrikeEventAction>(rbActions[0].action).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
  });

  test('need is 3 less than normal tap-to-fight (reflecting +3 prowess)', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [RISKY_BLOW],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
      actionAs<ResolveStrikeAction>(a.action).tapToFight === true)!;
    const rbAction = actions.find(a => a.viable && a.action.type === 'play-strike-event')!;

    const tapNeed = actionAs<ResolveStrikeAction>(tapAction.action).need;
    const rbNeed = actionAs<PlayStrikeEventAction>(rbAction.action).need;
    expect(rbNeed).toBe(tapNeed - 3);
  });

  test('playing Risky Blow discards it; tap-to-fight still taps on success', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [RISKY_BLOW],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);
    const cardInstance = handCardId(s1, RESOURCE_PLAYER);

    const rbAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;
    expect(actionAs<PlayStrikeEventAction>(rbAction.action).cardInstanceId).toBe(cardInstance);
    const s2 = dispatch(s1, rbAction.action);

    // Risky Blow discarded
    expect(s2.players[0].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, RISKY_BLOW);

    // Strike still pending — bonus recorded on the assignment
    expect(s2.combat!.phase).toBe('resolve-strike');
    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.strikeProwessBonus).toBe(3);
    expect(strike.strikeBodyPenalty).toBe(-1);

    // Now resolve the strike with tap-to-fight. Aragorn prowess 6 + 3 (Risky Blow)
    // + 12 dice = 21 > Cave-drake prowess 10 → success. Character still taps
    // (Risky Blow does not suppress the tap like Dodge does).
    const tapAction = computeLegalActions(s2, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === true)!;
    const s3 = dispatch({ ...s2, cheatRollTotal: 12 }, tapAction.action);
    expectCharStatus(s3, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });

  test('wounded defender body check picks up -1 body penalty', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [RISKY_BLOW],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const rbAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;
    const s2 = dispatch(s1, rbAction.action);

    // Force the strike to wound: Aragorn prowess 6 + 3 (Risky Blow) + 2 dice = 11 vs
    // Cave-drake prowess 10 — that's a tie (ineffectual). To cause a wound the
    // character total must be *less* than strike prowess, so use dice = 0 is
    // impossible; use stay-untapped (-3 prowess) + low roll to get wounded.
    const untapAction = computeLegalActions(s2, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === false)!;
    // Stay-untapped: prowess 6 + 3 (Risky Blow) - 3 (penalty) = 6; + dice 3 = 9 < 10 → wounded
    const s3 = dispatch({ ...s2, cheatRollTotal: 3 }, untapAction.action);

    expect(s3.combat!.phase).toBe('body-check');
    expect(s3.combat!.bodyCheckTarget).toBe('character');

    // Aragorn's body is 9. Risky Blow penalty -1 → effective body 8. Need roll > 8, so need 9+
    const bcActions = computeLegalActions(s3, PLAYER_2);
    const bcAction = bcActions.find(a => a.viable && a.action.type === 'body-check-roll')!;
    expect(actionAs<BodyCheckRollAction>(bcAction.action).need).toBe(9);
  });

  test('play-strike-event not available for a non-warrior defender', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [BILBO, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [RISKY_BLOW],
    });
    const s1 = assignBothStrikesTo(s0, BILBO);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rbActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(rbActions.length).toBe(0);
  });

  test('Risky Blow is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [RISKY_BLOW],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const rbShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(rbShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });
});
