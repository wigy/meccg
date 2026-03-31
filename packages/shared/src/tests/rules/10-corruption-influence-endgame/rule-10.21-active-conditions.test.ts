/**
 * @module rule-10.21-active-conditions
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.21: Active Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The "active conditions" of an action are the prerequisites for that action to be taken. Active conditions to play a card are typically templated with italicized bold text, but also include e.g. choosing valid targets upon which the actions are to be implemented. If an action is canceled before it resolves, its active conditions stay completed.
 * An allowance may have one or more active conditions. Generally an active condition is either a requirement that some action be performed as a "cost" or that some other aspect of the game be in a specified state. An active condition is not treated as a separate action from the allowed action that is being taken, but instead is treated as synonymous with the allowed action's declaration.
 * Actions that are required as active conditions of an allowance must be performed by the declaring player immediately when they declare that they are taking an action. If any active conditions are no longer valid and legal at resolution, any unresolved effects of the taken action are negated but its active conditions remain performed.
 */

import { describe, test } from 'vitest';

describe('Rule 10.21 — Active Conditions', () => {
  test.todo('Active conditions are prerequisites for action; include costs and state requirements; stay completed if action canceled');
});
