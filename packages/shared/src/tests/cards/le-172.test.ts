/**
 * @module le-172.test
 *
 * Card test: Bold Thrust (le-172)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Effects: 1 (strike-modifier: +3 prowess, -1 body, warrior only)
 *
 * "Warrior only. Warrior receives +3 to prowess and -1 to body against one strike."
 *
 * This tests:
 * 1. play-strike-event action appears during resolve-strike for a
 *    warrior defender when Bold Thrust is in hand.
 * 2. Need is reduced by 3 compared to normal tap-to-fight (reflecting +3 prowess).
 * 3. Playing the card discards it; the defender's tap still follows the chosen
 *    resolve-strike (unlike dodge mode).
 * 4. Wounded defender's body check picks up the -1 body penalty.
 * 5. A second Bold Thrust cannot be played against the same strike (CoE 3.iv.5).
 * 6. Not available for a non-warrior defender.
 * 7. Not playable as a short event during organization (combat-only).
 *
 * Fixtures:
 *   GORBAG (le-11)        — minion orc warrior, prowess 6, body 9
 *   CALENDAL (le-4)       — minion elf scout/sage (non-warrior)
 *   MORIA_LE (le-392)     — minion shadow-hold (company site during M/H)
 *   DOL_GULDUR (le-367)   — minion haven (opponent site)
 *   MINAS_MORGUL (le-390) — minion haven (site deck)
 *   CAVE_DRAKE (tw-63)    — hazard creature, 2 strikes, prowess 10
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  CAVE_DRAKE,
  buildTestState, resetMint,
  handCardId, dispatch, expectCharStatus, expectInDiscardPile,
  actionAs, RESOURCE_PLAYER, HAZARD_PLAYER,
  findCharInstanceId, companyIdAt, makeMHState, playCreatureHazardAndResolve,
  assignBothStrikesTo,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, RegionType, SiteType } from '../../index.js';
import type {
  CardDefinitionId,
  PlayStrikeEventAction, BodyCheckRollAction, ResolveStrikeAction,
  PlayShortEventAction, NotPlayableAction,
} from '../../index.js';

const BOLD_THRUST = 'le-172' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const CALENDAL = 'le-4' as CardDefinitionId;
const MORIA_LE = 'le-392' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/** Build a M/H combat state with minion characters and a Cave-drake. */
function setupMinionCombat(opts: {
  minionChars: readonly CardDefinitionId[];
  resourceHand?: readonly CardDefinitionId[];
}): ReturnType<typeof buildTestState> {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA_LE, characters: [...opts.minionChars] }],
        hand: [...(opts.resourceHand ?? [])],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
        hand: [CAVE_DRAKE],
        siteDeck: [MORIA_LE],
      },
    ],
  });
  const mhState = makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hollin', 'Enedhwaith'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const gameState = { ...state, phaseState: mhState };
  const creatureId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const wildernessKeying = { method: 'region-type' as const, value: 'wilderness' };
  const s0 = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, wildernessKeying);
  expect(s0.combat).not.toBeNull();
  return s0;
}

describe('Bold Thrust (le-172)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event appears during resolve-strike for a warrior', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BOLD_THRUST],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    const actions = computeLegalActions(s1, PLAYER_1);
    const btActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(btActions.length).toBe(1);
    expect(actionAs<PlayStrikeEventAction>(btActions[0].action).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
  });

  test('need is 3 less than normal tap-to-fight (reflecting +3 prowess)', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BOLD_THRUST],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    const actions = computeLegalActions(s1, PLAYER_1);
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
      actionAs<ResolveStrikeAction>(a.action).tapToFight === true)!;
    const btAction = actions.find(a => a.viable && a.action.type === 'play-strike-event')!;

    const tapNeed = actionAs<ResolveStrikeAction>(tapAction.action).need;
    const btNeed = actionAs<PlayStrikeEventAction>(btAction.action).need;
    expect(btNeed).toBe(tapNeed - 3);
  });

  test('playing Bold Thrust discards it; tap-to-fight still taps on success', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BOLD_THRUST],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);
    const cardInstance = handCardId(s1, RESOURCE_PLAYER);

    const btAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;
    expect(actionAs<PlayStrikeEventAction>(btAction.action).cardInstanceId).toBe(cardInstance);
    const s2 = dispatch(s1, btAction.action);

    // Bold Thrust discarded
    expect(s2.players[RESOURCE_PLAYER].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, BOLD_THRUST);

    // Strike still pending — bonus recorded on the assignment
    expect(s2.combat!.phase).toBe('resolve-strike');
    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.strikeProwessBonus).toBe(3);
    expect(strike.strikeBodyPenalty).toBe(-1);

    // Resolve with tap-to-fight. Gorbag prowess 6 + 3 (Bold Thrust) + 12 dice = 21 > 10 → success.
    const tapAction = computeLegalActions(s2, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === true)!;
    const s3 = dispatch({ ...s2, cheatRollTotal: 12 }, tapAction.action);
    expectCharStatus(s3, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
  });

  test('wounded defender body check picks up -1 body penalty', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BOLD_THRUST],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    const btAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;
    const s2 = dispatch(s1, btAction.action);

    // Stay-untapped: Gorbag prowess 6 + 3 (Bold Thrust) - 3 (untap penalty) = 6 + dice 3 = 9 < 10 → wounded
    const untapAction = computeLegalActions(s2, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === false)!;
    const s3 = dispatch({ ...s2, cheatRollTotal: 3 }, untapAction.action);

    expect(s3.combat!.phase).toBe('body-check');
    expect(s3.combat!.bodyCheckTarget).toBe('character');

    // Gorbag's body is 9. Bold Thrust penalty -1 → effective body 8. Need roll > 8, so need 9+.
    const bcActions = computeLegalActions(s3, PLAYER_2);
    const bcAction = bcActions.find(a => a.viable && a.action.type === 'body-check-roll')!;
    expect(actionAs<BodyCheckRollAction>(bcAction.action).need).toBe(9);
  });

  test('a second Bold Thrust cannot be played against the same strike (CoE 3.iv.5)', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BOLD_THRUST, BOLD_THRUST],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    // Both copies are initially available.
    expect(
      computeLegalActions(s1, PLAYER_1).filter(
        a => a.viable && a.action.type === 'play-strike-event',
      ).length,
    ).toBe(2);

    const firstPlay = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;
    const s2 = dispatch(s1, firstPlay.action);

    // After playing the first, the second must not be offered.
    const remaining = computeLegalActions(s2, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-strike-event',
    );
    expect(remaining.length).toBe(0);

    expect(s2.players[RESOURCE_PLAYER].hand.length).toBe(1);
    expect(s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex].requiredSkillEventPlayed).toBe(true);
  });

  test('play-strike-event not available for a non-warrior defender', () => {
    const s0 = setupMinionCombat({
      minionChars: [CALENDAL, GORBAG],
      resourceHand: [BOLD_THRUST],
    });
    // Assign both strikes to CALENDAL (non-warrior)
    const calendalId = findCharInstanceId(s0, RESOURCE_PLAYER, CALENDAL);
    let s = dispatch(s0, { type: 'pass', player: PLAYER_1 });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: calendalId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: calendalId, excess: true });

    const actions = computeLegalActions(s, PLAYER_1);
    const btActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(btActions.length).toBe(0);
  });

  test('Bold Thrust is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, CALENDAL] }],
          hand: [BOLD_THRUST],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const btShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(btShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });
});
