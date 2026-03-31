/**
 * @module rule-10.23-tap-discard-active-conditions
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.23: Tap/Discard Active Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an action being taken requires an entity to tap for the effect, the entity must be untapped when the action is declared and then the declaring player must tap the entity when fulfilling the active conditions for the action. If an action being taken requires an entity to be discarded for the effect, the entity must be in play when the action is declared and then the declaring player must discard the entity when fulfilling the active conditions for the action.
 * Hero items cannot fulfill active conditions for minion resource effects, and minion items cannot fulfill active conditions for hero resource effects. The same applies to items that would be conditionally affected by a resource during resolution.
 */

import { describe, test } from 'vitest';

describe('Rule 10.23 — Tap/Discard Active Conditions', () => {
  test.todo('Tap for effect requires untapped; discard for effect requires in play; hero items cannot fulfill minion resource conditions and vice versa');
});
