/**
 * @module rule-10.31-passive-conditions
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.31: Passive Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A card's effects may involve passive conditions, which are a requirement that one or more actions be performed whenever a prescribed set of circumstances is met after the card has already resolved. Actions caused by passive conditions are automatically declared when either the passive condition effect or the game condition itself comes into effect while the other was already in effect.
 * An action declared due to a passive condition must initiate a chain of effects, meaning that when a passive condition would be initiated during the resolution of a chain of effects, its action(s) must be declared in a new chain of effects immediately after the current chain of effects finishes resolving. If multiple passive conditions come into effect during the resolution of a chain of effects, all of those declared actions are added to the beginning of the same subsequent chain of effects in an order determined by the resource player.
 * Declarations from passive conditions require legal conditions upon resolution, including that the passive condition effect and the game condition itself are both still in effect.
 */

import { describe, test } from 'vitest';

describe('Rule 10.31 — Passive Conditions', () => {
  test.todo('Passive conditions: prescribed actions when circumstances met after card resolved; declared in new chain of effects');
});
