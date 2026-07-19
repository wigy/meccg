/**
 * @module rule-10.35-duplicate-passive-conditions
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.35: Duplicate Passive Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If multiple occurrences of the same passive condition come into effect at the same time, the passive conditions' effects are only declared once for all occurrences but all of the passive conditions are considered to have been initiated.
 */

import { describe, test } from 'vitest';

// A dedup rule for the rule-10.31 passive-condition queue: if the same
// passive fires from several sources simultaneously (e.g. three identical
// permanent-events all triggering on the same game condition), its effect
// declares once rather than three times. The chain-reducer's passive
// detection has no coalescing step — each detected trigger is queued
// independently — and no card in the pool can currently be present in
// triple with a same-moment shared trigger to expose the gap.
describe('Rule 10.35 — Duplicate Passive Conditions', () => {
  test.todo('Multiple occurrences of same passive condition at same time: effects declared once but all considered initiated');
});
