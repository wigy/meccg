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
  Phase,
} from '../../test-helpers.js';

describe('Rule 9.13 — Permanent-Events', () => {
  beforeEach(() => resetMint());

  test('Permanent-event remains in play after being played (not discarded like short events)', () => {
    // Gates of Morning is a resource permanent-event. Per rule 9.13,
    // permanent-events remain in play until discarded by a rule or effect.
    // After playing, it must be in cardsInPlay, not in the discard pile.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const after = playPermanentEventAndResolve(state, PLAYER_1, gomInstId);

    // Gates of Morning must now be in cardsInPlay
    const p1 = after.players[RESOURCE_PLAYER];
    expect(p1.cardsInPlay.some(c => c.instanceId === gomInstId)).toBe(true);
    // Not in discard pile (unlike short events)
    expect(p1.discardPile.some(c => c.instanceId === gomInstId)).toBe(false);
    // Not in hand anymore
    expect(p1.hand.some(c => c.instanceId === gomInstId)).toBe(false);
  });

  test('Resource permanent-event playable during org phase even when no immediate effect', () => {
    // Gates of Morning cancels hazard environments. Even with no environments
    // in play, it has a potential effect (rule 9.13 allows potential effect).
    // It must be offered as a viable play-permanent-event action.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GATES_OF_MORNING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gomInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === gomInstId)).toBe(true);
  });
});
