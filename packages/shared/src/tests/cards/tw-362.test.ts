/**
 * @module tw-362.test
 *
 * Card test: Wizard's Laughter (tw-362)
 * Type: hero-resource-event (short, spell)
 * Effects: 1 (cancel-influence: requires wizard, wizard makes corruption check -2)
 *
 * "Spell. Wizard only during opponent's site phase. Automatically cancels
 * an influence check against one of the Wizard's player's characters,
 * followers, factions, allies, or items. Wizard makes a corruption check
 * modified by -2."
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                |
 * |---|--------------------------------------------------|-------------|--------------------------------------|
 * | 1 | cancel-influence during opponent-influence-defend | IMPLEMENTED | pending legal actions + reducer       |
 * | 2 | Requires wizard (race) in company                | IMPLEMENTED | requiredRace filter in legal actions  |
 * | 3 | Wizard makes corruption check (-2 modifier)      | IMPLEMENTED | enqueues pending resolution           |
 * | 4 | Discards Wizard's Laughter from hand              | IMPLEMENTED | reducer moves card to discard         |
 * | 5 | Influence attempt auto-canceled (no defense roll) | IMPLEMENTED | dequeues opponent-influence-defend    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  WIZARDS_LAUGHTER,
  MORIA, MINAS_TIRITH, LORIEN,
  viableActions, makeSitePhase,
  attemptInfluence, dispatch,
  expectInDiscardPile, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CancelInfluenceAction } from '../../index.js';

/**
 * Build a state where PLAYER_1 (attacker) attempts opponent influence
 * against PLAYER_2's characters. PLAYER_2 has a wizard (Gandalf) and
 * Wizard's Laughter in hand to cancel the influence attempt.
 */
function buildCancelInfluenceState() {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MORIA, characters: [GANDALF, LEGOLAS] }],
        hand: [WIZARDS_LAUGHTER],
        siteDeck: [LORIEN],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: 3,
    cheatRollTotal: 12,
    phaseState: makeSitePhase(),
  };
}

describe('Wizard\'s Laughter (tw-362)', () => {
  beforeEach(() => resetMint());

  test('cancel-influence available when wizard is under defending player\'s control', () => {
    const state = buildCancelInfluenceState();
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);

    expect(afterAttempt.pendingResolutions).toHaveLength(1);
    expect(afterAttempt.pendingResolutions[0].kind.type).toBe('opponent-influence-defend');

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelInfluenceAction;
    expect(cancelAction.cardInstanceId).toBeDefined();
    expect(cancelAction.characterId).toBeDefined();
  });

  test('cancel-influence NOT available when no wizard is under defending player\'s control', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [LEGOLAS] }],
          hand: [WIZARDS_LAUGHTER],
          siteDeck: [LORIEN],
        },
      ],
      phase: Phase.Site,
      recompute: true,
    });
    const siteState = {
      ...state,
      turnNumber: 3,
      cheatRollTotal: 12,
      phaseState: makeSitePhase(),
    };

    const { state: afterAttempt } = attemptInfluence(siteState, LEGOLAS);
    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(0);
  });

  test('executing cancel-influence discards card, cancels attempt, and enqueues corruption check', () => {
    const state = buildCancelInfluenceState();
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);

    const cancelActions = viableActions(afterAttempt, PLAYER_2, 'cancel-influence');
    expect(cancelActions).toHaveLength(1);

    const after = dispatch(afterAttempt, cancelActions[0].action);

    const pendingInfluence = after.pendingResolutions.filter(
      r => r.kind.type === 'opponent-influence-defend',
    );
    expect(pendingInfluence).toHaveLength(0);

    expect(after.players[1].hand).toHaveLength(0);
    expectInDiscardPile(after, HAZARD_PLAYER, WIZARDS_LAUGHTER);

    const ccPending = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccPending).toHaveLength(1);
    const ccKind = ccPending[0].kind as { type: 'corruption-check'; modifier: number };
    expect(ccKind.modifier).toBe(-2);
  });

  test('defender can choose to roll instead of playing Wizard\'s Laughter', () => {
    const state = buildCancelInfluenceState();
    const { state: afterAttempt } = attemptInfluence(state, LEGOLAS);

    const defendActions = viableActions(afterAttempt, PLAYER_2, 'opponent-influence-defend');
    expect(defendActions).toHaveLength(1);

    const after = dispatch(afterAttempt, defendActions[0].action);
    const pendingInfluence = after.pendingResolutions.filter(
      r => r.kind.type === 'opponent-influence-defend',
    );
    expect(pendingInfluence).toHaveLength(0);
  });
});
