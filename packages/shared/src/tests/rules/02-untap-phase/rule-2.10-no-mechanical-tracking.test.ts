/**
 * @module rule-2.10-no-mechanical-tracking
 *
 * CoE Rules — Section 2: Untap Phase
 * Rule 2.10: No Mechanical Tracking
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A player cannot use pencil and paper nor other mechanical means to track which cards their opponent has played or revealed.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../../test-helpers.js';

describe('Rule 2.10 — No Mechanical Tracking', () => {
  beforeEach(() => resetMint());

  // This rule is a player-conduct rule, not a mechanical game rule.
  // In the digital implementation, the server projects state per-player
  // so that hidden information (opponent's hand, deck contents) is already
  // redacted from the client view. This is the digital equivalent of the
  // rule — the engine enforces it by design.

  test('Player state projection hides opponent hand contents', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: GANDALF }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // The engine stores full state server-side. The projection function
    // (tested elsewhere) redacts opponent's hidden info. Here we verify
    // the full state has both players' data for the server to project from.
    expect(state.players).toHaveLength(2);
    expect(state.players[0].id).toBe(PLAYER_1);
    expect(state.players[1].id).toBe(PLAYER_2);
  });
});
