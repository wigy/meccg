/**
 * @module rule-4.01-discard-own-long-events
 *
 * CoE Rules — Section 4: Long-Event Phase
 * Rule 4.01: Discard Own Resource Long-Events
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * At the beginning of the long-event phase, the resource player immediately discards their own resource long-events from play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, reduce, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  SUN, GATES_OF_MORNING, EYE_OF_SAURON,
  CardStatus,
} from '../../test-helpers.js';
import type { CardInPlay, CardInstanceId } from '../../test-helpers.js';

describe('Rule 4.01 — Discard Own Resource Long-Events', () => {
  beforeEach(() => resetMint());

  test('Resource player\'s own resource long-events are discarded when entering long-event phase', () => {
    // P1 has Sun (resource long-event) in play. When P1 passes the
    // organization phase, the engine moves into the long-event phase and
    // immediately discards P1's resource long-events.
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
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

    expect(state.players[0].cardsInPlay).toHaveLength(1);

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();

    // Phase advanced to long-event
    expect(result.state.phaseState.phase).toBe(Phase.LongEvent);

    // Sun was removed from cardsInPlay and put in P1's discard pile
    expect(result.state.players[0].cardsInPlay).toHaveLength(0);
    expect(result.state.players[0].discardPile.map(c => c.instanceId))
      .toContain('sun-1' as CardInstanceId);
  });

  test('Resource permanent events stay in play (only long-events are discarded)', () => {
    // Gates of Morning is a hero-resource-event with eventType "permanent"
    // and must NOT be discarded by rule 4.01. Sun (eventType "long") still is.
    const sunInPlay: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          hand: [],
          siteDeck: [MORIA],
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          cardsInPlay: [sunInPlay, gomInPlay],
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
    expect(result.state.phaseState.phase).toBe(Phase.LongEvent);

    // Sun was discarded; Gates of Morning is still in play
    const stillInPlay = result.state.players[0].cardsInPlay.map(c => c.instanceId);
    expect(stillInPlay).not.toContain('sun-1' as CardInstanceId);
    expect(stillInPlay).toContain('gom-1' as CardInstanceId);
    expect(result.state.players[0].discardPile.map(c => c.instanceId))
      .toContain('sun-1' as CardInstanceId);
  });

  test('Hazard player\'s long-events are not affected by rule 4.01', () => {
    // P2 (the hazard player) has Eye of Sauron (hazard long-event) in play.
    // Rule 4.01 only discards the resource player's *resource* long-events;
    // hazard long-events stay in play until rule 4.03 discards them at the
    // end of the long-event phase.
    const eyeInPlay: CardInPlay = {
      instanceId: 'eye-1' as CardInstanceId,
      definitionId: EYE_OF_SAURON,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
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

    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.LongEvent);

    // Eye of Sauron is still in P2's cardsInPlay (will be removed by rule 4.03 later)
    expect(result.state.players[1].cardsInPlay.map(c => c.instanceId))
      .toContain('eye-1' as CardInstanceId);
  });
});
