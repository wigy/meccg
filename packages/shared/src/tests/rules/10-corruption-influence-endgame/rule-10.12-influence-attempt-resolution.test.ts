/**
 * @module rule-10.12-influence-attempt-resolution
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.12: Resolving an Influence Attempt
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Resolving an Influence Attempt - To resolve an influence attempt against an opponent's card, the resource player follows these steps:
 * 1) Roll 2D6.
 * 2) Add the influencing character's unused direct influence.
 * 3) Subtract the hazard player's unused general influence.
 * 4) Subtract the result of a 2D6 rolled by the hazard player.
 * 5) If the card being influenced is controlled by a character, subtract the unused direct influence of the character controlling the card.
 * 6) Apply any other modifications.
 * This modified result is then compared to a second value depending on the type of card being influenced (i.e. the modified roll must normally be higher than the following number), except that this second value is treated as zero if an identical non-item card was revealed prior to the roll:
 * • Allies - The mind value of the target ally
 * • Characters - The mind value of the target character being influenced
 * • Factions - The value required for the influence check on the faction that is already in play
 * • Items - The mind value of the character controlling the target item
 * If the resource player's final modified roll is greater than this second value, the influence check is successful and the card being influenced is immediately discarded along with any non-follower cards that it controlled; otherwise the influence check fails.
 */

import { describe, test, expect } from 'vitest';
import {
  buildResolutionState, attemptInfluence, defendInfluence,
  findCharInstanceId, viableActions, PLAYER_1, PLAYER_2,
  CardStatus, dispatch, phaseStateAs,
  ARAGORN, LEGOLAS, GIMLI, BILBO, EOWYN,
  GLAMDRING, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../../test-helpers.js';
import type { SitePhaseState, OpponentInfluenceAttemptAction } from '../../test-helpers.js';

describe('Rule 10.12 — Resolving an Influence Attempt', () => {
  test('attacker roll taps the influencing character', () => {
    const state = buildResolutionState();
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const { state: afterAttempt } = attemptInfluence(state);
    expect(afterAttempt.players[0].characters[aragornId as string].status).toBe(CardStatus.Tapped);
  });

  test('attacker roll emits a dice-roll effect', () => {
    const state = buildResolutionState();
    const { effects } = attemptInfluence(state);
    expect(effects).toBeDefined();
    expect(effects!.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  test('attacker roll stores pending resolution with correct modifiers', () => {
    const state = buildResolutionState();
    const { state: afterAttempt } = attemptInfluence(state);
    // The opponent-influence attempt is now stored in the unified
    // pending-resolution queue rather than the SitePhaseState field.
    const pending = afterAttempt.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    expect(pending).toBeDefined();
    if (pending?.kind.type !== 'opponent-influence-defend') return;
    const attempt = pending.kind.attempt;
    expect(attempt.attackerRoll).toBeGreaterThanOrEqual(2);
    expect(attempt.attackerRoll).toBeLessThanOrEqual(12);
    // Aragorn DI=3, no followers, so influencerDI=3
    expect(attempt.influencerDI).toBe(3);
    // Opponent GI: 20 - (6+6+5) = 3
    expect(attempt.opponentGI).toBe(3);
  });

  test('sets opponentInteractionThisTurn to influence after attempt', () => {
    const state = buildResolutionState();
    const { state: afterAttempt } = attemptInfluence(state);
    expect(phaseStateAs<SitePhaseState>(afterAttempt).opponentInteractionThisTurn).toBe('influence');
  });

  test('defender roll clears the pending resolution', () => {
    const state = buildResolutionState();
    const { state: afterAttempt } = attemptInfluence(state);
    const { state: afterDefend } = defendInfluence(afterAttempt);
    expect(afterDefend.pendingResolutions.some(r => r.kind.type === 'opponent-influence-defend')).toBe(false);
  });

  test('defender roll emits a dice-roll effect', () => {
    const state = buildResolutionState();
    const { state: afterAttempt } = attemptInfluence(state);
    const { effects } = defendInfluence(afterAttempt);
    expect(effects).toBeDefined();
    expect(effects!.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  test('successful influence discards target character', () => {
    // Force high attacker roll (12), low defender roll (2)
    // Result: 12 + 3(DI) - 3(GI) - 2(def) - 0(ctrl) = 10 > 6(mind) → success
    const state = buildResolutionState({ attackerCheatRoll: 12 });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    // Force low defender roll
    const defState = { ...afterAttempt, cheatRollTotal: 2 };
    const { state: afterDefend } = defendInfluence(defState);

    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    expect(afterDefend.players[1].characters[legolasId as string]).toBeUndefined();
    expect(afterDefend.players[1].discardPile.some(c => c.instanceId === legolasId)).toBe(true);
  });

  test('failed influence leaves target in play', () => {
    // Force low attacker roll (2), high defender roll (12)
    // Result: 2 + 3(DI) - 3(GI) - 12(def) - 0(ctrl) = -10 < 6(mind) → failure
    const state = buildResolutionState({ attackerCheatRoll: 2 });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const defState = { ...afterAttempt, cheatRollTotal: 12 };
    const { state: afterDefend } = defendInfluence(defState);

    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    expect(afterDefend.players[1].characters[legolasId as string]).toBeDefined();
  });

  test('controller DI is subtracted when target is under DI (follower)', () => {
    // P2: Legolas with Eowyn as follower. Eowyn is under Legolas's DI.
    // Legolas DI=2, Eowyn mind=2, so controller unused DI = 2 - 2 = 0.
    // But if we use Bergil (mind=2) as follower, Legolas DI=2, used=2, unused=0.
    // For a real test, use a character with more DI. Gimli DI=2 with Bergil(mind=2) → unused=0.
    // Let's use Aragorn(DI=3) controlling Eowyn(mind=2) → unused DI = 3-2 = 1.
    const state = buildResolutionState({
      p2Chars: [{ defId: ARAGORN, items: [] }, { defId: EOWYN, followerOf: 0 }, GIMLI, BILBO],
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const eowynId = findCharInstanceId(state, HAZARD_PLAYER, EOWYN);

    // Action targeting Eowyn should have controllerDI > 0
    const eowynAction = actions.find(a => a.action.targetInstanceId === eowynId && !a.action.revealedCardInstanceId);
    expect(eowynAction).toBeDefined();
    expect(eowynAction!.action.explanation).toContain('controller DI: 1');

    // Action targeting Gimli (under GI) should have controllerDI = 0
    const gimliId = findCharInstanceId(state, HAZARD_PLAYER, GIMLI);
    const gimliAction = actions.find(a => a.action.targetInstanceId === gimliId && !a.action.revealedCardInstanceId);
    expect(gimliAction).toBeDefined();
    expect(gimliAction!.action.explanation).toContain('controller DI: 0');
  });

  test('successful influence discards items on the character', () => {
    // P2: Legolas with Glamdring, Gimli, Bilbo
    const state = buildResolutionState({
      p2Chars: [{ defId: LEGOLAS, items: [GLAMDRING] }, GIMLI, BILBO],
      attackerCheatRoll: 12,
    });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const defState = { ...afterAttempt, cheatRollTotal: 2 };
    const { state: afterDefend } = defendInfluence(defState);

    // Glamdring should be in discard
    expect(afterDefend.players[1].discardPile.some(c => c.definitionId === GLAMDRING)).toBe(true);
  });

  test('revealed identical card sets target mind to 0', () => {
    // P1 has Legolas in hand, targeting P2's Legolas
    const state = buildResolutionState({ p1Hand: [LEGOLAS] });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const revealAction = actions.find(a => a.action.revealedCardInstanceId !== undefined);
    expect(revealAction).toBeDefined();

    const nextState = dispatch(state, revealAction!.action);
    const pending = nextState.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    expect(pending).toBeDefined();
    if (pending?.kind.type !== 'opponent-influence-defend') return;
    expect(pending.kind.attempt.targetMind).toBe(0);
    expect(pending.kind.attempt.revealedCard).not.toBeNull();
  });

  test('revealed card is removed from hand on attempt', () => {
    const state = buildResolutionState({ p1Hand: [LEGOLAS] });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const revealAction = actions.find(a => a.action.revealedCardInstanceId !== undefined)!;

    const handBefore = state.players[0].hand.length;
    const nextState = dispatch(state, revealAction.action);
    expect(nextState.players[0].hand.length).toBe(handBefore - 1);
  });

  test('revealed card goes to discard on failed influence', () => {
    // Force failure: low attacker, high defender
    const state = buildResolutionState({ p1Hand: [LEGOLAS], attackerCheatRoll: 2 });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const revealAction = actions.find(a => a.action.revealedCardInstanceId !== undefined)!;

    const afterAttempt = dispatch(state, revealAction.action);
    const defState = { ...afterAttempt, cheatRollTotal: 12 };
    const { state: afterDefend } = defendInfluence(defState);

    // Revealed card should be in attacker's discard
    expect(afterDefend.players[0].discardPile.some(
      c => c.instanceId === revealAction.action.revealedCardInstanceId,
    )).toBe(true);
  });

  test('defend action includes explanation with attacker roll and modifier breakdown', () => {
    const state = buildResolutionState({ attackerCheatRoll: 7 });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const actions = viableActions(afterAttempt, PLAYER_2, 'opponent-influence-defend');
    expect(actions.length).toBe(1);
    const action = actions[0].action;
    expect(action.type).toBe('opponent-influence-defend');
    if (action.type !== 'opponent-influence-defend') return;
    expect(action.explanation).toBeDefined();
    expect(action.explanation).toContain('Attacker roll: 7');
    expect(action.explanation).toContain('Influencer DI:');
    expect(action.explanation).toContain('Target mind:');
    expect(action.explanation).toContain('Controller DI:');
    expect(action.explanation).toContain('Aragorn');
    expect(action.explanation).toContain('Legolas');
  });

  test('followers of discarded character fall to GI if room, else discarded', () => {
    // P2: Aragorn(DI=3) with Eowyn(mind=2) as follower, plus Gimli and Bilbo under GI.
    // GI used: Gimli(6) + Bilbo(5) = 11, remaining = 9 — plenty of room for Eowyn(2).
    // When Aragorn is successfully influenced, Eowyn should fall to GI.
    const state = buildResolutionState({
      p2Chars: [{ defId: ARAGORN, items: [] }, { defId: EOWYN, followerOf: 0 }, GIMLI, BILBO],
      attackerCheatRoll: 12,
    });

    const aragornId = findCharInstanceId(state, HAZARD_PLAYER, ARAGORN);
    const eowynId = findCharInstanceId(state, HAZARD_PLAYER, EOWYN);

    // Verify Eowyn is a follower of Aragorn
    expect(state.players[1].characters[eowynId as string].controlledBy).toBe(aragornId);

    // Attempt influence on Aragorn and force success
    const { state: afterAttempt } = attemptInfluence(state, ARAGORN);
    const defState = { ...afterAttempt, cheatRollTotal: 2 };
    const { state: afterDefend } = defendInfluence(defState);

    // Aragorn should be discarded
    expect(afterDefend.players[1].characters[aragornId as string]).toBeUndefined();
    expect(afterDefend.players[1].discardPile.some(c => c.instanceId === aragornId)).toBe(true);

    // Eowyn should still be in play, now under GI
    expect(afterDefend.players[1].characters[eowynId as string]).toBeDefined();
    expect(afterDefend.players[1].characters[eowynId as string].controlledBy).toBe('general');
  });
});
