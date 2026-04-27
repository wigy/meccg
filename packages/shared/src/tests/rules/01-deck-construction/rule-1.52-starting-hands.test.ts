/**
 * @module rule-1.52-starting-hands
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.52: Starting Hands
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Starting Hands - Immediately after declaring starting sites, each player shuffles their play deck and draws up to their base hand size of eight cards (without an option to "mulligan").
 * Base hand size is always eight cards at the start of the game, regardless of any effects that a player's starting cards may have on base hand size.
 */

import { describe, test, expect } from 'vitest';
import { runFullSetup, Phase } from '../../test-helpers.js';

describe('Rule 1.52 — Starting Hands', () => {
  test('Each player shuffles play deck and draws up to 8 cards; no mulligan', () => {
    // runFullSetup uses the default config with a 30-card play deck per player.
    // After full setup, both players should be in the Untap phase with 8 cards in hand.
    const state = runFullSetup();

    expect(state.phaseState.phase).toBe(Phase.Untap);
    expect(state.players[0].hand).toHaveLength(8);
    expect(state.players[1].hand).toHaveLength(8);
  });
});
