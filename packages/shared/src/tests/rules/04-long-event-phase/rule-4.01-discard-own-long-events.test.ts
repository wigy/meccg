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
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  SUN, GATES_OF_MORNING, EYE_OF_SAURON,
  CardStatus,
} from '../../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../test-helpers.js';
import { Alignment } from '../../../index.js';

const ECHO_OF_ALL_JOY = 'td-110' as CardDefinitionId;
/** The Great Eye (as-85) — a minion resource long-event. */
const GREAT_EYE = 'as-85' as CardDefinitionId;
/** Minion fixtures for the minion long-event sweep test. */
const THE_MOUTH = 'le-24' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

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

    const nextState = dispatch(state, { type: 'pass', player: PLAYER_1 });

    // Phase advanced to long-event
    expect(nextState.phaseState.phase).toBe(Phase.LongEvent);

    // Sun was removed from cardsInPlay and put in P1's discard pile
    expect(nextState.players[0].cardsInPlay).toHaveLength(0);
    expect(nextState.players[0].discardPile.map(c => c.instanceId))
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

    const nextState = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(nextState.phaseState.phase).toBe(Phase.LongEvent);

    // Sun was discarded; Gates of Morning is still in play
    const stillInPlay = nextState.players[0].cardsInPlay.map(c => c.instanceId);
    expect(stillInPlay).not.toContain('sun-1' as CardInstanceId);
    expect(stillInPlay).toContain('gom-1' as CardInstanceId);
    expect(nextState.players[0].discardPile.map(c => c.instanceId))
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

    const nextState = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(nextState.phaseState.phase).toBe(Phase.LongEvent);

    // Eye of Sauron is still in P2's cardsInPlay (will be removed by rule 4.03 later)
    expect(nextState.players[1].cardsInPlay.map(c => c.instanceId))
      .toContain('eye-1' as CardInstanceId);
  });

  test('All resource long-events are discarded together, not just the first one', () => {
    // P1 has two Sun instances in cardsInPlay (artificial test state — validates
    // that the cleanup iterates all long-events, not just the first).
    const sun1: CardInPlay = {
      instanceId: 'sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };
    const sun2: CardInPlay = {
      instanceId: 'sun-2' as CardInstanceId,
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
          cardsInPlay: [sun1, sun2],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    expect(state.players[0].cardsInPlay).toHaveLength(2);

    const nextState = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(nextState.phaseState.phase).toBe(Phase.LongEvent);

    // Both Sun instances must be discarded
    expect(nextState.players[0].cardsInPlay).toHaveLength(0);
    const discardIds = nextState.players[0].discardPile.map(c => c.instanceId);
    expect(discardIds).toContain('sun-1' as CardInstanceId);
    expect(discardIds).toContain('sun-2' as CardInstanceId);
  });

  test('Minion resource long-events are discarded when entering long-event phase (bug regression)', () => {
    // The sweep must match minion-resource-event long-events, not only
    // hero-resource-event ones: a Ringwraith player's The Great Eye (as-85)
    // is discarded when they pass out of their organization phase.
    const greatEyeInPlay: CardInPlay = {
      instanceId: 'great-eye-1' as CardInstanceId,
      definitionId: GREAT_EYE,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [],
          siteDeck: [CARN_DUM],
          companies: [{ site: DOL_GULDUR, characters: [THE_MOUTH] }],
          cardsInPlay: [greatEyeInPlay],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(nextState.phaseState.phase).toBe(Phase.LongEvent);

    // The Great Eye was removed from cardsInPlay and put in the discard pile
    expect(nextState.players[0].cardsInPlay.map(c => c.instanceId))
      .not.toContain('great-eye-1' as CardInstanceId);
    expect(nextState.players[0].discardPile.map(c => c.instanceId))
      .toContain('great-eye-1' as CardInstanceId);
  });

  test('A resource long-event attached to an in-play Echo of All Joy is not discarded (bug regression)', () => {
    // Echo of All Joy (td-110) is played "on" a resource long-event and
    // exempts it from this sweep for as long as Echo stays in play. A second,
    // unprotected Sun instance is still discarded as normal.
    const protectedSun: CardInPlay = {
      instanceId: 'sun-protected' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };
    const echoInPlay: CardInPlay = {
      instanceId: 'echo-1' as CardInstanceId,
      definitionId: ECHO_OF_ALL_JOY,
      status: CardStatus.Untapped,
      attachedToLongEvent: 'sun-protected' as CardInstanceId,
    };
    const unprotectedSun: CardInPlay = {
      instanceId: 'sun-unprotected' as CardInstanceId,
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
          cardsInPlay: [protectedSun, echoInPlay, unprotectedSun],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [MINAS_TIRITH],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(nextState.phaseState.phase).toBe(Phase.LongEvent);

    const stillInPlay = nextState.players[0].cardsInPlay.map(c => c.instanceId);
    expect(stillInPlay).toContain('sun-protected' as CardInstanceId);
    expect(stillInPlay).toContain('echo-1' as CardInstanceId);
    expect(stillInPlay).not.toContain('sun-unprotected' as CardInstanceId);
    expect(nextState.players[0].discardPile.map(c => c.instanceId))
      .toContain('sun-unprotected' as CardInstanceId);
  });
});
