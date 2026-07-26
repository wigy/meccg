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
 * These tests cover two regressions:
 *
 *  - Lure of the Senses (or any hazard) attached to a follower character
 *    vanished from rendered game state — `formatGameState` dropped follower
 *    hazards from its output (and the browser UI did the same), so the card
 *    literally disappeared from the player's view while still being tracked
 *    in state.
 *  - A corruption hazard is both a *possession* of its bearer (it carries the
 *    corruption points that drive the check) and an entry in the bearer's
 *    `hazards` list. When the bearer failed his corruption check, the two
 *    discard paths each pushed it to its owner's discard pile, so the same
 *    card instance ended up in the pile twice.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, attachHazardToChar, RESOURCE_PLAYER, HAZARD_PLAYER,
  findCharInstanceId, executeAction,
} from '../test-helpers.js';
import { enqueueResolution } from '../../engine/pending.js';
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

  test('bearer fails his corruption check: the hazard is discarded exactly once', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    // Aragorn fails hard (roll 2 - 12 vs his corruption points) and is
    // eliminated; the Lure attached to him goes to its owner's discard pile.
    const queued = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: aragornId, modifier: -12, reason: 'test', possessions: [], transferredItemId: null },
    });
    const after = executeAction(queued, PLAYER_1, 'corruption-check', 2);

    expect(after.players[0].outOfPlayPile.map(c => c.definitionId)).toContain(ARAGORN);
    const lures = after.players[1].discardPile.filter(c => c.definitionId === LURE_OF_THE_SENSES);
    expect(lures).toHaveLength(1);
  });
});
