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
  expectCharStatus, expectCharInPlay, expectCharNotInPlay, getCharacter,
  expectInDiscardPile, expectNotInHand, attachHazardToChar,
} from '../../test-helpers.js';
import type { SitePhaseState, OpponentInfluenceAttemptAction } from '../../test-helpers.js';
import type { CardDefinitionId } from '../../../index.js';

describe('Rule 10.12 — Resolving an Influence Attempt', () => {
  test('attacker roll taps the influencing character', () => {
    const state = buildResolutionState();
    const { state: afterAttempt } = attemptInfluence(state);
    expectCharStatus(afterAttempt, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
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
    expectCharNotInPlay(afterDefend, HAZARD_PLAYER, legolasId);
    expectInDiscardPile(afterDefend, HAZARD_PLAYER, legolasId);
  });

  test('failed influence leaves target in play', () => {
    // Force low attacker roll (2), high defender roll (12)
    // Result: 2 + 3(DI) - 3(GI) - 12(def) - 0(ctrl) = -10 < 6(mind) → failure
    const state = buildResolutionState({ attackerCheatRoll: 2 });
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);
    const defState = { ...afterAttempt, cheatRollTotal: 12 };
    const { state: afterDefend } = defendInfluence(defState);

    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    expectCharInPlay(afterDefend, HAZARD_PLAYER, legolasId);
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

    const nextState = dispatch(state, revealAction.action);
    expectNotInHand(nextState, RESOURCE_PLAYER, revealAction.action.revealedCardInstanceId!);
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
    expectInDiscardPile(afterDefend, RESOURCE_PLAYER, revealAction.action.revealedCardInstanceId!);
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

  test('followers of a successfully-influenced-away character fall to GI, deferred (CoE 2.II.2.2.3)', () => {
    // P2: Aragorn(DI=3) with Eowyn(mind=2) as follower, plus Gimli and Bilbo under GI.
    // When Aragorn is successfully influenced away, Eowyn falls to general
    // influence with the mind subtraction deferred to P2's next organization
    // phase — she is never discarded on the spot, regardless of GI room.
    const state = buildResolutionState({
      p2Chars: [{ defId: ARAGORN, items: [] }, { defId: EOWYN, followerOf: 0 }, GIMLI, BILBO],
      attackerCheatRoll: 12,
    });

    const aragornId = findCharInstanceId(state, HAZARD_PLAYER, ARAGORN);
    const eowynId = findCharInstanceId(state, HAZARD_PLAYER, EOWYN);

    // Verify Eowyn is a follower of Aragorn
    expect(getCharacter(state, HAZARD_PLAYER, EOWYN).controlledBy).toBe(aragornId);

    // Attempt influence on Aragorn and force success
    const { state: afterAttempt } = attemptInfluence(state, ARAGORN);
    const defState = { ...afterAttempt, cheatRollTotal: 2 };
    const { state: afterDefend } = defendInfluence(defState);

    // Aragorn should be discarded
    expectCharNotInPlay(afterDefend, HAZARD_PLAYER, aragornId);
    expectInDiscardPile(afterDefend, HAZARD_PLAYER, aragornId);

    // Eowyn should still be in play, now under GI with the deferral flag set
    expectCharInPlay(afterDefend, HAZARD_PLAYER, eowynId);
    expect(getCharacter(afterDefend, HAZARD_PLAYER, EOWYN).controlledBy).toBe('general');
    expect(getCharacter(afterDefend, HAZARD_PLAYER, EOWYN).influenceUnsubtracted).toBe(true);
  });

  test('successful influence does not drop a hazard-player-owned hazard on the target (no card disappears)', () => {
    // Regression: discardInfluencedCard dispatched the influenced character's
    // hazards by mutating `players[...]` directly, but the final write
    // overwrote the hazard player's discard with the never-appended
    // `newHazardDiscard` — so a hazard-player-owned hazard on the character
    // vanished entirely, violating the "no card instance disappears" invariant.
    const ORC_GUARD = 'tw-072' as CardDefinitionId; // a hazard-creature
    const base = buildResolutionState({ attackerCheatRoll: 12 });
    // Attach a hazard owned by the influencing (hazard) player to the target.
    const withHazard = attachHazardToChar(base, HAZARD_PLAYER, LEGOLAS, ORC_GUARD, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(withHazard, HAZARD_PLAYER, LEGOLAS);
    const hazardId = withHazard.players[HAZARD_PLAYER].characters[legolasId].hazards[0].instanceId;

    const { state: afterAttempt } = attemptInfluence(withHazard, LEGOLAS);
    const { state: afterDefend } = defendInfluence({ ...afterAttempt, cheatRollTotal: 2 });

    // The character is influenced away...
    expectCharNotInPlay(afterDefend, HAZARD_PLAYER, legolasId);
    // ...and its hazard lands in the hazard owner's discard exactly once.
    const copies = afterDefend.players[RESOURCE_PLAYER].discardPile.filter(c => c.instanceId === hazardId);
    expect(copies).toHaveLength(1);
  });
});
