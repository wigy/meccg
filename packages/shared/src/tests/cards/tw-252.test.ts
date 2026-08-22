/**
 * @module tw-252.test
 *
 * Card test: Halfling Stealth (tw-252)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 * Effects: 1 (strike-modifier: cancel mode, filter — race hobbit)
 *
 * "Hobbit only. Cancel one strike against the Hobbit."
 *
 * This tests:
 * 1. play-strike-event action appears during resolve-strike for a Hobbit
 *    defender when Halfling Stealth is in hand, with need 0 (outright cancel).
 * 2. Playing it cancels the current strike immediately (no roll, no chain):
 *    the defender stays untapped, the card is discarded, and combat advances
 *    to the next unresolved strike / resolves.
 * 3. Not available for a non-Hobbit defender (Aragorn).
 * 4. Not playable as a short event during organization (combat-only).
 *
 * Fixtures:
 *   FRODO (tw-152)     — hero Hobbit, scout + diplomat, prowess 1, body 9
 *   ARAGORN (tw-*)     — hero Human, non-Hobbit (control)
 *   LEGOLAS (tw-*)     — hero, second company member
 *   CAVE_DRAKE (tw-63) — hazard creature, 2 strikes, prowess 10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  FRODO, ARAGORN, LEGOLAS, GIMLI,
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
  PlayStrikeEventAction,
  PlayShortEventAction, NotPlayableAction,
} from '../../index.js';

const HALFLING_STEALTH = 'tw-252' as CardDefinitionId;

const CAVE_DRAKE_FIGHT = { heroChars: [FRODO, LEGOLAS], creatureDefId: CAVE_DRAKE } as const;

describe('Halfling Stealth (tw-252)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event appears during resolve-strike for a Hobbit, with need 0', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [HALFLING_STEALTH] });
    const s1 = assignBothStrikesTo(s0, FRODO);

    const actions = computeLegalActions(s1, PLAYER_1);
    const hsActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(hsActions.length).toBe(1);
    expect(actionAs<PlayStrikeEventAction>(hsActions[0].action).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
    expect(actionAs<PlayStrikeEventAction>(hsActions[0].action).need).toBe(0);
  });

  test('canceling the strike leaves the defender untapped, discards the card, and finalizes combat', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [HALFLING_STEALTH] });
    // Both of Cave-drake's strikes are assigned to FRODO (one strike +
    // one excess), so this single strike assignment is the only one.
    const s1 = assignBothStrikesTo(s0, FRODO);
    expect(s1.combat!.strikeAssignments.length).toBe(1);

    const hsAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;

    // No cheatRollTotal set — cancel mode never rolls dice.
    const s2 = dispatch(s1, hsAction.action);

    // FRODO paid no cost — still untapped.
    expectCharStatus(s2, RESOURCE_PLAYER, FRODO, CardStatus.Untapped);

    // Card discarded from hand.
    expect(s2.players[RESOURCE_PLAYER].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, HALFLING_STEALTH);

    // The sole strike was canceled with no roll, so combat resolves
    // immediately (no chain, no unresolved strikes left) to the enclosing phase.
    expect(s2.combat).toBeNull();
  });

  test('not available for a non-Hobbit defender (Aragorn)', () => {
    const s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
      heroHand: [HALFLING_STEALTH],
    });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    expect(actions.filter(a => a.viable && a.action.type === 'play-strike-event').length).toBe(0);
  });

  test('Halfling Stealth is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [FRODO, LEGOLAS] }],
          hand: [HALFLING_STEALTH],
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
    const hsShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(hsShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });
});
