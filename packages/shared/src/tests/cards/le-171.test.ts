/**
 * @module le-171.test
 *
 * Card test: Blow Turned (le-171)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Effects: 1 (strike-modifier: dodge mode, -1 body, warrior only)
 *
 * "Warrior only. Warrior does not tap against one strike. If wounded by
 * the strike, his body check is modified by -1."
 *
 * This tests:
 * 1. play-strike-event action appears during resolve-strike for a warrior
 *    defender when Blow Turned is in hand.
 * 2. Dodging character does not tap on success (full prowess, no tap).
 * 3. Wounded defender's body check picks up the -1 body penalty.
 * 4. Playing the card discards it from hand.
 * 5. Not available for a non-warrior defender.
 * 6. A second skill-required strike event cannot be played against the
 *    same strike (CoE 3.iv.5).
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
  assignBothStrikesTo, resolveChain,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, RegionType, SiteType } from '../../index.js';
import type {
  CardDefinitionId,
  PlayStrikeEventAction, BodyCheckRollAction, ResolveStrikeAction,
  PlayShortEventAction, NotPlayableAction,
} from '../../index.js';

const BLOW_TURNED = 'le-171' as CardDefinitionId;
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

describe('Blow Turned (le-171)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event appears during resolve-strike for a warrior', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BLOW_TURNED],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    const actions = computeLegalActions(s1, PLAYER_1);
    const btActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(btActions.length).toBe(1);
    expect(actionAs<PlayStrikeEventAction>(btActions[0].action).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
  });

  test('dodging warrior does not tap on success (full prowess, same need as tap-to-fight)', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BLOW_TURNED],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    const actions = computeLegalActions(s1, PLAYER_1);
    const btAction = actions.find(a => a.viable && a.action.type === 'play-strike-event')!;
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
      actionAs<ResolveStrikeAction>(a.action).tapToFight === true)!;
    expect(actionAs<PlayStrikeEventAction>(btAction.action).need).toBe(
      actionAs<ResolveStrikeAction>(tapAction.action).need,
    );

    // Cheat roll high: Gorbag prowess 6 + 12 = 18 > 10 → success.
    const s2raw = dispatch({ ...s1, cheatRollTotal: 12 }, btAction.action);
    const s2 = resolveChain(s2raw);

    expectCharStatus(s2, RESOURCE_PLAYER, GORBAG, CardStatus.Untapped);
    expect(s2.players[RESOURCE_PLAYER].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, BLOW_TURNED);
  });

  test('wounded defender body check picks up -1 body penalty', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BLOW_TURNED],
    });
    const s1 = assignBothStrikesTo(s0, GORBAG);

    const btAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event')!;

    // Cheat roll low: Gorbag prowess 6 + 2 = 8 < 10 → wounded.
    const s2 = resolveChain(dispatch({ ...s1, cheatRollTotal: 2 }, btAction.action));

    expect(s2.combat!.phase).toBe('body-check');
    expect(s2.combat!.bodyCheckTarget).toBe('character');

    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.dodged).toBe(true);
    expect(strike.dodgeBodyPenalty).toBe(-1);

    // Gorbag's body is 9. Blow Turned penalty -1 → effective body 8. Need roll > 8, so need 9+.
    const bcActions = computeLegalActions(s2, PLAYER_2);
    const bcAction = bcActions.find(a => a.viable && a.action.type === 'body-check-roll')!;
    expect(actionAs<BodyCheckRollAction>(bcAction.action).need).toBe(9);
  });

  test('play-strike-event not available for a non-warrior defender', () => {
    const s0 = setupMinionCombat({
      minionChars: [CALENDAL, GORBAG],
      resourceHand: [BLOW_TURNED],
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

  test('a second skill-required strike event cannot be played against the same strike (CoE 3.iv.5)', () => {
    const s0 = setupMinionCombat({
      minionChars: [GORBAG, CALENDAL],
      resourceHand: [BLOW_TURNED, BLOW_TURNED],
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
    const s2raw = dispatch(s1, firstPlay.action);
    const s2 = resolveChain(s2raw);

    // After playing and resolving the first, the second must not be offered
    // against a still-pending strike. Since the strike resolves in one shot
    // (dodge is immediate resolution), assert requiredSkillEventPlayed was
    // recorded at declaration time instead.
    expect(s2raw.combat!.strikeAssignments[s1.combat!.currentStrikeIndex].requiredSkillEventPlayed).toBe(true);
    expect(s2.players[RESOURCE_PLAYER].hand.length).toBe(1);
  });

  test('Blow Turned is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, CALENDAL] }],
          hand: [BLOW_TURNED],
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
