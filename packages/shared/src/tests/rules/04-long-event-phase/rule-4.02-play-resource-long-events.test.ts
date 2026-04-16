/**
 * @module rule-4.02-play-resource-long-events
 *
 * CoE Rules — Section 4: Long-Event Phase
 * Rule 4.02: Play Resource Long-Events
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may play resource long-events during the long-event phase (but not at any other time).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  SUN,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';

describe('Rule 4.02 — Play Resource Long-Events', () => {
  beforeEach(() => resetMint());

  test('Resource player may play a resource long-event during the long-event phase', () => {
    // P1 holds Sun (a resource long-event). In the long-event phase, the
    // engine offers a viable play-long-event for that hand card.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          hand: [SUN],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    const sunInstId = state.players[0].hand[0].instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-long-event');
    expect(plays.length).toBe(1);
    expect((plays[0].action as { cardInstanceId: string }).cardInstanceId).toBe(sunInstId);

    const after = dispatch(state, plays[0].action);
    // Sun resolves and ends up in P1's cardsInPlay (after both players pass priority).
    const passOpp = dispatch(after, { type: 'pass-chain-priority', player: PLAYER_2 });
    const passOwn = dispatch(passOpp, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(passOwn.players[0].cardsInPlay.some(c => c.definitionId === SUN)).toBe(true);
  });

  test('Resource long-event is not playable during the organization phase', () => {
    // The same Sun card in hand is not offered as a viable play-long-event
    // outside the long-event phase. The legal-action computer instead
    // surfaces a not-playable annotation explaining the restriction.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [SUN],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    const playLong = viableActions(state, PLAYER_1, 'play-long-event');
    expect(playLong.length).toBe(0);

    const sunInstId = state.players[0].hand[0].instanceId;
    const notPlayable = computeLegalActions(state, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: string }).cardInstanceId === sunInstId);
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('Hazard player cannot play a resource long-event during the long-event phase', () => {
    // Only the resource player (active player) may play resource long-events.
    // Even though P2 holds Sun, the engine returns no actions for P2 during
    // the resource player's long-event phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        },
        {
          id: PLAYER_2,
          hand: [SUN],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    // P2's hand card is annotated as not-playable but no viable
    // play-long-event action is offered — only the resource player may play.
    const p2Plays = viableActions(state, PLAYER_2, 'play-long-event');
    expect(p2Plays.length).toBe(0);
    const p2Viable = computeLegalActions(state, PLAYER_2).filter(ea => ea.viable);
    expect(p2Viable.length).toBe(0);
  });
});
