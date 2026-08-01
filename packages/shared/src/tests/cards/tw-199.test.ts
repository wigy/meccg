/**
 * @module tw-199.test
 *
 * Card test: Block (tw-199)
 * Type: hero-resource-event (short)
 * Effects: 1
 *
 * "Warrior only. Warrior does not tap against one strike (unless he is
 * wounded by the strike)."
 *
 * `strike-modifier` with `dodge: true, requiredSkill: "warrior"` — the
 * struck character resolves the strike at full prowess without tapping,
 * but only if the struck character has the warrior skill. Unlike Dodge
 * (tw-209) there is no body penalty if the character is wounded.
 *
 * This tests:
 * 1. play-strike-event action appears during resolve-strike when a warrior
 *    is struck and Block is in hand
 * 2. play-strike-event is NOT offered when the struck character lacks the
 *    warrior skill
 * 3. Dodging character does not tap on success
 * 4. When wounded by the dodged strike, body check has no penalty
 * 5. Full prowess used — no -3 untapped-to-fight penalty
 * 6. Card is discarded from hand after use
 * 7. Block is NOT available outside combat (organization phase)
 * 8. CoE 3.iv.5 — only one skill-requiring resource may be played per
 *    strike: after Block (dodge, requiredSkill) is played, a second
 *    requiredSkill card (Risky Blow) is no longer offered for that strike
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, CAVE_DRAKE,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  setupCombatWithCaveDrake, assignBothStrikesTo,
  handCardId, findHandCardId, dispatch, expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER, resolveChain,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus } from '../../index.js';
import type {
  PlayStrikeEventAction, BodyCheckRollAction, ResolveStrikeAction,
  PlayShortEventAction, NotPlayableAction, CardDefinitionId,
} from '../../index.js';

const BLOCK = 'tw-199' as CardDefinitionId;
const RISKY_BLOW = 'tw-319' as CardDefinitionId;

const CAVE_DRAKE_FIGHT = { heroChars: [ARAGORN, FRODO], creatureDefId: CAVE_DRAKE } as const;

describe('Block (tw-199)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event action appears during resolve-strike when a warrior is struck', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [BLOCK] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const blockActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(blockActions.length).toBe(1);
    expect((blockActions[0].action as PlayStrikeEventAction).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
  });

  test('play-strike-event NOT offered when struck character lacks warrior skill', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [BLOCK] });
    const s1 = assignBothStrikesTo(s0, FRODO);

    const actions = computeLegalActions(s1, PLAYER_1);
    const blockActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(blockActions.length).toBe(0);
  });

  test('dodging character does not tap on success', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [BLOCK] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const blockAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;

    // Cheat roll high: Aragorn prowess 6 + 12 = 18 > 10 → success
    const s2 = resolveChain(dispatch({ ...s1, cheatRollTotal: 12 }, blockAction.action));

    expectCharStatus(s2, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expect(s2.players[0].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, BLOCK);
  });

  test('wounded by dodged strike → body check with no penalty', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [BLOCK] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const blockAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;

    // Cheat roll low: Aragorn prowess 6 + 2 = 8 < 10 → wounded
    const s2 = resolveChain(dispatch({ ...s1, cheatRollTotal: 2 }, blockAction.action));

    expect(s2.combat!.phase).toBe('body-check');
    expect(s2.combat!.bodyCheckTarget).toBe('character');

    // Aragorn body 9, no penalty → need roll > 9, i.e., need 10+
    const bcActions = computeLegalActions(s2, PLAYER_2);
    const bcAction = bcActions.find(a => a.viable && a.action.type === 'body-check-roll')!;
    expect(actionAs<BodyCheckRollAction>(bcAction.action).need).toBe(10);

    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.dodged).toBe(true);
    expect(strike.dodgeBodyPenalty).toBe(0);
  });

  test('dodge gives full prowess (same need as tap-to-fight)', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [BLOCK] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const blockAction = actions.find(a => a.viable && a.action.type === 'play-strike-event') as
      { action: PlayStrikeEventAction } | undefined;
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
      actionAs<ResolveStrikeAction>(a.action).tapToFight === true) as
      { action: { need: number } } | undefined;

    expect(blockAction).toBeDefined();
    expect(tapAction).toBeDefined();
    expect(blockAction!.action.need).toBe(tapAction!.action.need);
  });

  test('Block is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, FRODO] }],
          hand: [BLOCK],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const blockShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(blockShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });

  test('CoE 3.iv.5: after Block is played, a second skill-required strike event is not offered for the same strike', () => {
    const s0 = setupCombatWithCaveDrake({ ...CAVE_DRAKE_FIGHT, heroHand: [BLOCK, RISKY_BLOW] });
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const blockInstanceId = findHandCardId(s1, RESOURCE_PLAYER, BLOCK);
    const blockAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event' &&
        actionAs<PlayStrikeEventAction>(a.action).cardInstanceId === blockInstanceId)!;
    expect(blockAction).toBeDefined();

    const s2 = dispatch({ ...s1, cheatRollTotal: 12 }, blockAction.action);

    // Risky Blow's play-strike-event should no longer be offered for this strike.
    const actions = computeLegalActions(s2, PLAYER_1);
    const strikeEventActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(strikeEventActions.length).toBe(0);
  });
});
