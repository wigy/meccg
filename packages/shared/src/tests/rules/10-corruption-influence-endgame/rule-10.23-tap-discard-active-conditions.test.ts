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

// The "must be untapped to tap / in play to discard" half is already true by
// construction and exercised by every tap/discard-cost action in the suite
// (`canPayCost` in cost-evaluator.ts requires `CardStatus.Untapped` for a
// tap cost before offering the action at all). The second half — a hero
// item can't fulfill a minion resource effect's active condition, and vice
// versa — has no matching check anywhere in cost-evaluator.ts or the
// grant-action cost paths, and no card in the pool has a tap/discard active
// condition that could even be satisfied cross-alignment to prove the gap
// (item-as-active-condition costs are keyed to specific card instances, not
// a generic "any item of alignment X" pool).
describe('Rule 10.23 — Tap/Discard Active Conditions', () => {
  test.todo('Tap for effect requires untapped; discard for effect requires in play; hero items cannot fulfill minion resource conditions and vice versa');
});
