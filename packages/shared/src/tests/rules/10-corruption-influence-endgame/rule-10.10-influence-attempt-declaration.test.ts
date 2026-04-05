/**
 * @module rule-10.10-influence-attempt-declaration
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.10: Declaring an Influence Attempt
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Declaring an Influence Attempt - A resource player may declare during their site phase that one of their characters is making an influence attempt against an opponent's card by tapping the character (as an active condition) if all of the following conditions are true:
 * • It is not the resource player's first turn;
 * • The company of the character making the influence attempt has entered its site this turn;
 * • The resource player has not made an influence attempt against any of the hazard player's cards this turn nor attacked any of the hazard player's companies this turn;
 * • The influence attempt is not against an avatar nor a card controlled by an avatar; and
 * • If an avatar is being tapped to make the influence attempt, the avatar cannot have been played this turn.
 */

import { describe, test, expect } from 'vitest';
import {
  buildTestState, makeSitePhase, findCharInstanceId,
  viableActions, PLAYER_1, PLAYER_2,
} from '../../test-helpers.js';
import {
  Phase, CardStatus, ARAGORN, LEGOLAS, BILBO, GANDALF,
  MORIA, LORIEN, MINAS_TIRITH,
} from '../../../index.js';
import type { SitePhaseState, OpponentInfluenceAttemptAction } from '../../../index.js';

/**
 * Build a state where both players have companies at the same site (Moria)
 * in the play-resources step, with siteEntered = true.
 * P1 is active (resource player), P2 is the hazard player.
 */
function buildOpponentInfluenceState(opts?: {
  p1Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  turnNumber?: number;
  sitePhaseOverrides?: Partial<SitePhaseState>;
  p1Hand?: Parameters<typeof buildTestState>[0]['players'][0]['hand'];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: opts?.p1Chars ?? [ARAGORN] }],
        hand: opts?.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MORIA, characters: opts?.p2Chars ?? [LEGOLAS] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: opts?.turnNumber ?? 3,
    phaseState: makeSitePhase(opts?.sitePhaseOverrides),
  };
}

describe('Rule 10.10 — Declaring an Influence Attempt', () => {
  test('untapped character at same site can attempt influence against opponent character', () => {
    const state = buildOpponentInfluenceState();
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions.length).toBeGreaterThan(0);
    const action = actions[0].action as OpponentInfluenceAttemptAction;
    expect(action.targetPlayer).toBe(PLAYER_2);
    expect(action.targetKind).toBe('character');
  });

  test('cannot influence on first turn (turnNumber <= 2)', () => {
    const state = buildOpponentInfluenceState({ turnNumber: 1 });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('cannot influence on second turn (turnNumber = 2)', () => {
    const state = buildOpponentInfluenceState({ turnNumber: 2 });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('cannot influence if company has not entered site', () => {
    const state = buildOpponentInfluenceState({
      sitePhaseOverrides: { siteEntered: false },
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('cannot influence if already made opponent interaction this turn', () => {
    const state = buildOpponentInfluenceState({
      sitePhaseOverrides: { opponentInteractionThisTurn: 'influence' },
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('cannot influence if already attacked opponent this turn', () => {
    const state = buildOpponentInfluenceState({
      sitePhaseOverrides: { opponentInteractionThisTurn: 'attack' },
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('cannot target an avatar (mind === null)', () => {
    // P2 has Gandalf (avatar) at Moria
    const state = buildOpponentInfluenceState({ p2Chars: [GANDALF] });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('cannot target a character controlled by an avatar', () => {
    // P2 has Gandalf (avatar) with Legolas as a follower
    const state = buildOpponentInfluenceState({
      p2Chars: [GANDALF, { defId: LEGOLAS, followerOf: 0 }],
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    // Only Gandalf and Legolas are targets; Gandalf is avatar (skip),
    // Legolas is controlled by avatar (skip)
    expect(actions).toHaveLength(0);
  });

  test('only untapped characters can attempt influence', () => {
    // P1 has Aragorn tapped
    const state = buildOpponentInfluenceState({
      p1Chars: [{ defId: ARAGORN, status: CardStatus.Tapped }],
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });

  test('tapped influencer generates no actions but untapped one does', () => {
    // P1 has Aragorn (tapped) and Bilbo (untapped)
    const state = buildOpponentInfluenceState({
      p1Chars: [{ defId: ARAGORN, status: CardStatus.Tapped }, BILBO],
    });
    const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    // Only Bilbo should be able to influence
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      const bilboId = findCharInstanceId(state, 0, BILBO);
      expect(a.action.influencingCharacterId).toBe(bilboId);
    }
  });

  test('hazard player has no opponent influence actions', () => {
    const state = buildOpponentInfluenceState();
    const actions = viableActions(state, PLAYER_2, 'opponent-influence-attempt');
    expect(actions).toHaveLength(0);
  });
});
