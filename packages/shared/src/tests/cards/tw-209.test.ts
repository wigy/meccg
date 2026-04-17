/**
 * @module tw-209.test
 *
 * Card test: Dodge (tw-209)
 * Type: hero-resource-event (short)
 * Effects: 1
 *
 * "Target character does not tap against one strike (unless he is wounded
 * by the strike). If wounded by the strike, his body is modified by -1
 * for the resulting body check."
 *
 * This tests:
 * 1. dodge-strike effect — play-dodge action appears during resolve-strike
 * 2. Character does not tap on success when dodging
 * 3. Character gets wounded normally when losing (body -1 on body check)
 * 4. Dodge card is discarded from hand after use
 * 5. Full prowess used (no -3 untapped penalty)
 * 6. play-dodge not available when no dodge card in hand
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  CAVE_DRAKE, DODGE,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  setupCombatWithCaveDrake, assignBothStrikesTo,
  handCardId, dispatch, expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type { PlayDodgeAction, BodyCheckRollAction, ResolveStrikeAction, PlayShortEventAction, NotPlayableAction } from '../../index.js';

const CAVE_DRAKE_FIGHT = { heroChars: [ARAGORN, LEGOLAS], creatureDefId: CAVE_DRAKE } as const;

describe('Dodge (tw-209)', () => {
  beforeEach(() => resetMint());

  test('play-dodge action appears during resolve-strike when Dodge is in hand', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [DODGE] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const dodgeActions = actions.filter(a => a.viable && a.action.type === 'play-dodge');
    expect(dodgeActions.length).toBe(1);
    expect((dodgeActions[0].action as PlayDodgeAction).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
  });

  test('dodging character does not tap on success', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [DODGE] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const dodgeAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-dodge')!;

    // Cheat roll high: Aragorn prowess 6 + 12 = 18 > 10 → success
    const s2 = dispatch({ ...s1, cheatRollTotal: 12 }, dodgeAction.action);

    // Aragorn should still be untapped (dodged, not wounded)
    expectCharStatus(s2, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    // Dodge card should be discarded from hand
    expect(s2.players[0].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, DODGE);
  });

  test('wounded by dodged strike → body check with -1 penalty', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [DODGE] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const dodgeAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-dodge')!;

    // Cheat roll low: Aragorn prowess 6 + 2 = 8 < 10 → wounded
    const s2 = dispatch({ ...s1, cheatRollTotal: 2 }, dodgeAction.action);

    // Should be in body-check phase
    expect(s2.combat!.phase).toBe('body-check');
    expect(s2.combat!.bodyCheckTarget).toBe('character');

    // Body check: Aragorn body 9 - 1 (dodge penalty) = 8
    // Need roll > 8, so need 9+
    const bcActions = computeLegalActions(s2, PLAYER_2);
    const bcAction = bcActions.find(a => a.viable && a.action.type === 'body-check-roll')!;
    expect(actionAs<BodyCheckRollAction>(bcAction.action).need).toBe(9);

    // Verify the strike is marked as dodged
    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.dodged).toBe(true);
    expect(strike.dodgeBodyPenalty).toBe(-1);
  });

  test('dodge gives full prowess (same need as tap-to-fight)', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [DODGE] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const dodgeAction = actions.find(a => a.viable && a.action.type === 'play-dodge') as
      { action: PlayDodgeAction } | undefined;
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
      actionAs<ResolveStrikeAction>(a.action).tapToFight === true) as
      { action: { need: number } } | undefined;

    expect(dodgeAction).toBeDefined();
    expect(tapAction).toBeDefined();
    // Dodge should have same prowess (need) as tap-to-fight
    expect(dodgeAction!.action.need).toBe(tapAction!.action.need);
  });

  test('play-dodge not available when no dodge card in hand', () => {
    const s0 = setupCombatWithCaveDrake(CAVE_DRAKE_FIGHT);
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const dodgeActions = actions.filter(a => a.viable && a.action.type === 'play-dodge');
    expect(dodgeActions.length).toBe(0);
  });

  test('Dodge is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [DODGE],
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
    const dodgeShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(dodgeShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });

  test('normal tap-to-fight still taps the character (control case)', () => {
    const s0 = setupCombatWithCaveDrake(CAVE_DRAKE_FIGHT);
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const tapAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === true)!;

    // Cheat roll high: success
    const s2 = dispatch({ ...s1, cheatRollTotal: 12 }, tapAction.action);

    // Without dodge, character should be tapped
    expectCharStatus(s2, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });
});
