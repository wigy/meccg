/**
 * @module rule-9.13-permanent-events
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.13: Permanent-Events
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Permanent-events may be played if they would have either an immediate or potential effect on the game, and then remain in play until discarded by a rule or effect.
 * A permanent-event played on a card only affects the card it is played on (and not other cards in play with the same name, such as sites) unless specified otherwise. A permanent-event that isn't played "on" a card affects all versions of its affected cards.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, playPermanentEventAndResolve, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GATES_OF_MORNING,
  Phase, handCardId,
} from '../../test-helpers.js';

describe('Rule 9.13 — Permanent-Events', () => {
  beforeEach(() => resetMint());

  test('Permanent-event remains in play after being played; playable even without immediate effect', () => {
    // Gates of Morning is a resource permanent-event. Even with no hazard
    // environments in play (so no immediate effect), rule 9.13 permits playing
    // it because it has a potential effect. After playing it must remain in
    // cardsInPlay rather than going to the discard pile.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomInstId = handCardId(state, RESOURCE_PLAYER);

    // Must be offered as viable even when no hazard environment is in play.
    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === gomInstId)).toBe(true);

    const after = playPermanentEventAndResolve(state, PLAYER_1, gomInstId);

    // Gates of Morning must now be in cardsInPlay
    const p1 = after.players[RESOURCE_PLAYER];
    expect(p1.cardsInPlay.some(c => c.instanceId === gomInstId)).toBe(true);
    // Not in discard pile (unlike short events)
    expect(p1.discardPile.some(c => c.instanceId === gomInstId)).toBe(false);
    // Not in hand anymore
    expect(p1.hand.some(c => c.instanceId === gomInstId)).toBe(false);
  });
});
