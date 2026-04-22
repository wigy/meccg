/**
 * @module tw-60.test
 *
 * Card test: Lure of the Senses (tw-60)
 * Type: hazard-event (permanent corruption)
 *
 * "Corruption. Playable on a non-Ringwraith character. Target character
 *  receives 2 corruption points and makes a corruption check at the end
 *  of his untap phase if at a Haven/Darkhaven. During his organization
 *  phase, the character may tap to attempt to remove this card. Make a
 *  roll — if the result is greater than 6, discard this card. Cannot be
 *  duplicated on a given character."
 *
 * This test covers the regression where Lure of the Senses (or any
 * hazard) attached to a follower character vanished from rendered game
 * state — `formatGameState` dropped follower hazards from its output
 * (and the browser UI did the same), so the card literally disappeared
 * from the player's view while still being tracked in state.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO,
  RIVENDELL, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, attachHazardToChar, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { formatGameState, LURE_OF_THE_SENSES, Phase } from '../../index.js';

describe('Lure of the Senses (tw-60)', () => {
  beforeEach(() => resetMint());

  test('hazard attached to a follower character appears in formatGameState output', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [ARAGORN, { defId: FRODO, followerOf: 0 }],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const state = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, LURE_OF_THE_SENSES);

    const formatted = formatGameState(state);
    expect(formatted).toContain('Lure of the Senses');
    expect(formatted).toContain('Frodo');
    expect(formatted).toContain('[follower]');
  });
});
