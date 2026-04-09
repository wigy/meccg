/**
 * @module rule-4.03-discard-hazard-long-events
 *
 * CoE Rules — Section 4: Long-Event Phase
 * Rule 4.03: Discard Hazard Long-Events
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * At the end of the long-event phase, the hazard player immediately discards their own hazard long-events from play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, reduce, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  EYE_OF_SAURON, SUN,
  CardStatus,
} from '../../test-helpers.js';
import type { CardInPlay, CardInstanceId } from '../../test-helpers.js';

describe('Rule 4.03 — Discard Hazard Long-Events', () => {
  beforeEach(() => resetMint());

  test('Hazard player\'s hazard long-events are discarded when leaving long-event phase', () => {
    // P2 (the hazard player) has Eye of Sauron (hazard long-event) in play.
    // When P1 (resource player) passes the long-event phase, the engine moves
    // into Movement/Hazard and immediately discards P2's hazard long-events.
    const eyeInPlay: CardInPlay = {
      instanceId: 'eye-1' as CardInstanceId,
      definitionId: EYE_OF_SAURON,
      status: CardStatus.Untapped,
    };

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
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          cardsInPlay: [eyeInPlay],
        },
      ],
    });

    expect(state.players[1].cardsInPlay).toHaveLength(1);

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Phase advanced to Movement/Hazard
    expect(result.state.phaseState.phase).toBe(Phase.MovementHazard);

    // Eye of Sauron was removed from P2's cardsInPlay and put in P2's discard pile
    expect(result.state.players[1].cardsInPlay).toHaveLength(0);
    expect(result.state.players[1].discardPile.map(c => c.instanceId))
      .toContain('eye-1' as CardInstanceId);
  });

  test('Resource long-events surviving from earlier phases are not discarded by rule 4.03', () => {
    // Hypothetically: a resource long-event in play (e.g. one cast during the
    // long-event phase) belongs to the resource player and is governed by rule
    // 4.01, not rule 4.03. Rule 4.03 only targets the hazard player's hazard
    // long-events. Verify that a resource long-event in P1's cardsInPlay
    // survives the transition out of the long-event phase.
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          cardsInPlay: [sunInPlay],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.MovementHazard);

    // Sun is still in play
    expect(result.state.players[0].cardsInPlay.map(c => c.instanceId))
      .toContain('sun-1' as CardInstanceId);
  });

  test('Hazard long-event in resource player\'s cardsInPlay is not affected', () => {
    // Sanity: rule 4.03 specifically discards the *hazard player's* hazard
    // long-events. If somehow a hazard long-event were in the resource
    // player's cardsInPlay, it should not be touched by this transition.
    const eyeInPlay: CardInPlay = {
      instanceId: 'eye-1' as CardInstanceId,
      definitionId: EYE_OF_SAURON,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          cardsInPlay: [eyeInPlay],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.MovementHazard);

    // The hazard long-event in P1's cardsInPlay is untouched
    expect(result.state.players[0].cardsInPlay.map(c => c.instanceId))
      .toContain('eye-1' as CardInstanceId);
  });
});
