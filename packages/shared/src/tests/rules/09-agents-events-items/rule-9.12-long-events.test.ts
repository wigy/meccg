/**
 * @module rule-9.12-long-events
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.12: Long-Events
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Long-events may be played regardless of whether they have an immediate effect on the game (because they normally have at least a potential effect while in play), either during a resource player's long-event phase for resource long-events or during an opponent's movement-hazard phase for hazard long-events.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableActions, makeShadowMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  EYE_OF_SAURON, SUN,
  Phase,
} from '../../test-helpers.js';

describe('Rule 9.12 — Long-Events', () => {
  beforeEach(() => resetMint());

  test('Hazard long-event playable during opponent M/H phase even without immediate effect', () => {
    // Eye of Sauron is a hazard long-event that gives +1 prowess to auto-attacks.
    // There are no auto-attacks active here, so it has no immediate effect.
    // Per rule 9.12, it must still be offered as a viable hazard play.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = { ...base, phaseState: makeShadowMHState({ hazardLimitAtReveal: 2, hazardsPlayedThisCompany: 0 }) };

    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    // Eye of Sauron must be offered as viable even though it has no immediate effect now
    expect(plays.length).toBeGreaterThan(0);
    const eyeInst = state.players[1].hand[0].instanceId;
    expect(plays.some(a => a.action.type === 'play-hazard' && 'cardInstanceId' in a.action && a.action.cardInstanceId === eyeInst)).toBe(true);
  });

  test('Resource long-event playable during long-event phase even without immediate effect', () => {
    // Sun is a resource long-event. Long-events may be played regardless of
    // immediate effect. Verified here: Sun in hand during long-event phase
    // generates a viable play-long-event action.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [SUN], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-long-event');
    expect(plays.length).toBeGreaterThan(0);
    const sunInst = state.players[0].hand[0].instanceId;
    expect(plays.some(a => a.action.type === 'play-long-event' && 'cardInstanceId' in a.action && a.action.cardInstanceId === sunInst)).toBe(true);
  });

  test('Hazard long-event not playable during resource player long-event phase', () => {
    // Hazard long-events are only playable during the opponent's M/H phase,
    // not during the resource player's long-event phase.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYE_OF_SAURON], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // P2 (hazard player) cannot play Eye of Sauron during long-event phase
    expect(viableActions(state, PLAYER_2, 'play-long-event')).toHaveLength(0);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
