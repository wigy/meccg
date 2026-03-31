/**
 * @module rule-9.10-short-event-no-effect
 *
 * CoE Rules — Section 9: Agents, Events, Items & Rings
 * Rule 9.10: Short-Event No Effect
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A player cannot play a card just to discard it. Specifically, a player cannot declare that they are playing a short-event unless the short-event's resolution would have an effect on the current board state (which may include dice being rolled even if there is no potential effect beyond the roll itself, or a potential effect that may be initiated due to some other condition later in the turn after the current chain of effects has fully resolved). If a short-event finishes resolving without the board state having been affected in any other way than the card itself moving to the discard pile from its player's hand, it is returned to its player's hand rather than being discarded. If the board state is affected due to some other action taken in response to a short-event, the board state is still considered to have been affected for this purpose.
 * If a short-event's effects provide an allowance for an action to be taken without requiring that it be taken, that action must be taken (or not) at the next possible opportunity after the short-event resolves, unless otherwise noted on the card. If that action is not the next action that the player takes as allowed after resolution (and the short-event had no other immediate effect), the short-event is returned to its player's hand.
 */

import { describe, test } from 'vitest';

describe('Rule 9.10 — Short-Event No Effect', () => {
  test.todo('If short-event resolves without affecting board state, returned to hand; allowance actions must be taken at next opportunity');
});
