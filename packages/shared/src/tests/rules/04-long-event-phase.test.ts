/**
 * @module 04-long-event-phase.test
 *
 * Tests for CoE Rules Section 2.III: Long-event Phase.
 *
 * Rule references from docs/coe-rules.txt lines 272-274.
 *
 * Tests construct explicit game states in the Organization or Long-event
 * phase and verify the engine correctly handles long-event discard and play.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  reduce,
  Phase,
  ARAGORN, LEGOLAS,
  SUN, EYE_OF_SAURON,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { CardInPlay, CardInstanceId } from '../../index.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('2.III Long-event phase', () => {
  beforeEach(() => resetMint());

  test('[2.III.1] at beginning: resource player immediately discards own resource long-events', () => {
    // Place a resource long-event (Sun) in PLAYER_1's cardsInPlay.
    // Start in Organization phase, pass to Long-event phase, verify the
    // event is removed from cardsInPlay and placed in P1's discard pile.
    const sunCardInPlay: CardInPlay = {
      instanceId: 'evt-sun-1' as CardInstanceId,
      definitionId: SUN,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MORIA], cardsInPlay: [sunCardInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Pass from Organization → Long-event phase
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.LongEvent);

    // Resource long-event should be gone from cardsInPlay
    expect(result.state.players[0].cardsInPlay).toHaveLength(0);

    // It should be in P1's discard pile
    expect(result.state.players[0].discardPile).toContain(sunCardInPlay.instanceId);
  });

  test('[2.III.2] resource player may play resource long-events during this phase only', () => {
    // Place a Sun card in P1's hand, start in Long-event phase.
    // Verify play-long-event is a legal action; play it and check cardsInPlay.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Compute legal actions: should include play-long-event for the Sun card
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions.filter(a => a.action.type === 'play-long-event');
    expect(playActions).toHaveLength(1);
    expect(playActions[0].viable).toBe(true);

    // Play the long-event
    const sunInstanceId = state.players[0].hand[0];
    const result = reduce(state, { type: 'play-long-event', player: PLAYER_1, cardInstanceId: sunInstanceId });
    expect(result.error).toBeUndefined();

    // Sun should be in P1's cardsInPlay
    const sunCard = result.state.players[0].cardsInPlay.find(c => c.definitionId === SUN);
    expect(sunCard).toBeDefined();

    // Sun should be removed from hand
    expect(result.state.players[0].hand).not.toContain(sunInstanceId);
  });

  test('[2.III.3] at end: hazard player immediately discards own hazard long-events', () => {
    // Place a hazard long-event (Eye of Sauron) in PLAYER_2's cardsInPlay.
    // PLAYER_1 is active (resource player), so PLAYER_2 is the hazard player.
    // Pass through Long-event → Movement/Hazard, verify hazard event is discarded.
    const eyeCardInPlay: CardInPlay = {
      instanceId: 'evt-eye-1' as CardInstanceId,
      definitionId: EYE_OF_SAURON,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [eyeCardInPlay] },
      ],
    });

    // Pass from Long-event → Movement/Hazard
    const result = reduce(state, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.phaseState.phase).toBe(Phase.MovementHazard);

    // Hazard long-event should be gone from P2's cardsInPlay
    expect(result.state.players[1].cardsInPlay).toHaveLength(0);

    // It should be in P2's discard pile
    expect(result.state.players[1].discardPile).toContain(eyeCardInPlay.instanceId);
  });
});
