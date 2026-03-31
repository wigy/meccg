/**
 * @module rule-2.02-resource-player-actions
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.02: Resource Player Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The resource player may play resource short-events and resource permanent-events, and may take resource/character actions on their cards in play, during any phase of their turn unless a rule or effect restricts them from doing so. The resource player cannot play hazards nor take hazard actions during their turn unless a rule or effect specifically allows them to do so.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS,
  GATES_OF_MORNING, SUN, DOORS_OF_NIGHT, CAVE_DRAKE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';
import type { EvaluatedAction } from '../../../index.js';

function viableOfType(actions: EvaluatedAction[], type: string): EvaluatedAction[] {
  return actions.filter(a => a.viable && a.action.type === type);
}

describe('Rule 2.02 — Resource Player Actions', () => {
  beforeEach(() => resetMint());

  test('Resource player can play permanent resource events during organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const playPermanent = viableOfType(actions, 'play-permanent-event');
    expect(playPermanent).toHaveLength(1);
  });

  test('Resource player can play resource long-events during long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }], hand: [SUN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const playLong = viableOfType(actions, 'play-long-event');
    expect(playLong).toHaveLength(1);
  });

  test('Resource player cannot play hazards during their turn', () => {
    // Give the resource player hazard cards in hand — they should not be playable
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }], hand: [DOORS_OF_NIGHT, CAVE_DRAKE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    // Hazard cards in hand should not produce any viable play actions for the resource player
    const playHazard = viableOfType(actions, 'play-hazard');
    expect(playHazard).toHaveLength(0);
  });
});
