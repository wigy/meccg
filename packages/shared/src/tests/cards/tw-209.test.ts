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
  RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  buildTestState, resetMint, makeMHState,
  reduce, pool, findCharInstanceId,
  playCreatureHazardAndResolve,
} from '../test-helpers.js';
import { computeLegalActions, Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { PlayDodgeAction } from '../../index.js';

const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

describe('Dodge (tw-209)', () => {
  beforeEach(() => resetMint());

  test('card definition has dodge-strike effect with bodyPenalty -1', () => {
    const def = pool[DODGE as string] as { effects: readonly { type: string; bodyPenalty?: number }[] };
    expect(def).toBeDefined();
    expect(def.effects).toContainEqual({
      type: 'dodge-strike',
      bodyPenalty: -1,
    });
  });

  function setupCombatWithCaveDrake(hand: import('../../index.js').CardDefinitionId[] = [DODGE]) {
    // Cave-drake: prowess 10, 2 strikes, keyed to wilderness, attacker-chooses-defenders
    // Aragorn: prowess 6, body 9
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand,
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [CAVE_DRAKE],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hollin'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const creatureId = gameState.players[1].hand[0].instanceId;
    const companyId = gameState.players[0].companies[0].id;
    const s0 = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING);
    expect(s0.combat).not.toBeNull();
    return s0;
  }

  function assignCaveDrakeStrikes(state0: import('../../index.js').GameState) {
    // Cave-drake has attacker-chooses-defenders: cancel window → attacker assigns
    const aragornId = findCharInstanceId(state0, 0, ARAGORN);

    // P1 (defender) passes cancel window
    let s = reduce(state0, { type: 'pass', player: PLAYER_1 }).state;
    // P2 (attacker) assigns both strikes to Aragorn
    s = reduce(s, { type: 'assign-strike', player: PLAYER_2, characterId: aragornId }).state;
    s = reduce(s, { type: 'assign-strike', player: PLAYER_2, characterId: aragornId, excess: true }).state;

    // Auto-selects resolve-strike since only one character has strikes
    expect(s.combat!.phase).toBe('resolve-strike');
    return s;
  }

  test('play-dodge action appears during resolve-strike when Dodge is in hand', () => {
    const s0 = setupCombatWithCaveDrake();
    const s1 = assignCaveDrakeStrikes(s0);

    const actions = computeLegalActions(s1, PLAYER_1);
    const dodgeActions = actions.filter(a => a.viable && a.action.type === 'play-dodge');
    expect(dodgeActions.length).toBe(1);
    expect((dodgeActions[0].action as PlayDodgeAction).cardInstanceId).toBe(
      s1.players[0].hand[0].instanceId,
    );
  });

  test('dodging character does not tap on success', () => {
    const s0 = setupCombatWithCaveDrake();
    const s1 = assignCaveDrakeStrikes(s0);

    const aragornId = findCharInstanceId(s1, 0, ARAGORN);
    const dodgeAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-dodge')!;

    // Cheat roll high: Aragorn prowess 6 + 12 = 18 > 10 → success
    const s2 = reduce({ ...s1, cheatRollTotal: 12 }, dodgeAction.action).state;

    // Aragorn should still be untapped (dodged, not wounded)
    const aragornData = s2.players[0].characters[aragornId as string];
    expect(aragornData.status).toBe(CardStatus.Untapped);

    // Dodge card should be discarded from hand
    expect(s2.players[0].hand.length).toBe(0);
    expect(s2.players[0].discardPile.some(c => c.definitionId === DODGE)).toBe(true);
  });

  test('wounded by dodged strike → body check with -1 penalty', () => {
    const s0 = setupCombatWithCaveDrake();
    const s1 = assignCaveDrakeStrikes(s0);

    const dodgeAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-dodge')!;

    // Cheat roll low: Aragorn prowess 6 + 2 = 8 < 10 → wounded
    const s2 = reduce({ ...s1, cheatRollTotal: 2 }, dodgeAction.action).state;

    // Should be in body-check phase
    expect(s2.combat!.phase).toBe('body-check');
    expect(s2.combat!.bodyCheckTarget).toBe('character');

    // Body check: Aragorn body 9 - 1 (dodge penalty) = 8
    // Need roll > 8, so need 9+
    const bcActions = computeLegalActions(s2, PLAYER_2);
    const bcAction = bcActions.find(a => a.viable && a.action.type === 'body-check-roll')!;
    expect((bcAction.action as { need: number }).need).toBe(9);

    // Verify the strike is marked as dodged
    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.dodged).toBe(true);
    expect(strike.dodgeBodyPenalty).toBe(-1);
  });

  test('dodge gives full prowess (same need as tap-to-fight)', () => {
    const s0 = setupCombatWithCaveDrake();
    const s1 = assignCaveDrakeStrikes(s0);

    const actions = computeLegalActions(s1, PLAYER_1);
    const dodgeAction = actions.find(a => a.viable && a.action.type === 'play-dodge') as
      { action: PlayDodgeAction } | undefined;
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
      (a.action as { tapToFight: boolean }).tapToFight === true) as
      { action: { need: number } } | undefined;

    expect(dodgeAction).toBeDefined();
    expect(tapAction).toBeDefined();
    // Dodge should have same prowess (need) as tap-to-fight
    expect(dodgeAction!.action.need).toBe(tapAction!.action.need);
  });

  test('play-dodge not available when no dodge card in hand', () => {
    const s0 = setupCombatWithCaveDrake([]);
    const s1 = assignCaveDrakeStrikes(s0);

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
        (a.action as { cardInstanceId: string }).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(dodgeShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        (a.action as { cardInstanceId: string }).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });

  test('normal tap-to-fight still taps the character (control case)', () => {
    const s0 = setupCombatWithCaveDrake([]);
    const s1 = assignCaveDrakeStrikes(s0);

    const aragornId = findCharInstanceId(s1, 0, ARAGORN);
    const tapAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'resolve-strike' &&
        (a.action as { tapToFight: boolean }).tapToFight === true)!;

    // Cheat roll high: success
    const s2 = reduce({ ...s1, cheatRollTotal: 12 }, tapAction.action).state;

    // Without dodge, character should be tapped
    const aragornData = s2.players[0].characters[aragornId as string];
    expect(aragornData.status).toBe(CardStatus.Tapped);
  });
});
