/**
 * @module rule-10.24-targeting-rules
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.24: Targeting Rules
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an action involves any targets, all of those targets must be chosen along with other active conditions being performed upon declaration, and if the targets are no longer available upon resolution, any unresolved effects of the taken action are negated but its active conditions remain performed.
 * Targeting remains in effect as an active condition for as long as the targeted effect itself is active.
 * A card and/or its attributes can only be targeted if the card is in play (unless the targeting effect specifies otherwise). A played card cannot be targeted until it has resolved, except that if one of its effects would involve dice-rolling, that dice-rolling may be targeted by other actions that are declared subsequently in the same chain of effects.
 * Resource cards in marshalling point piles may be targeted (unless they were stored), but hazard cards in marshalling point piles cannot be targeted.
 * Neither face-down cards nor their attributes can be targeted (unless the targeting effect specifies otherwise).
 */

import { describe, test } from 'vitest';

// The core claim — targets are chosen at declaration and must be in play —
// is architecturally guaranteed: `play-target` legal-action generation
// (legal-actions/*.ts) only ever emits one concrete action per valid
// in-play target, so a target is baked into the `GameAction` itself and
// there is no code path offering an action with an unresolved/deferred
// target. This is exercised by essentially every targeted card test in the
// suite. The narrower sub-clauses (dice-rolling-in-progress can still be
// targeted mid-chain; stored resource cards vs. hazard cards in kill piles;
// face-down-card targeting) don't have a dedicated generic check to test in
// isolation — each is only as good as the specific card effects that rely
// on it, none of which currently probes these exact edge cases.
describe('Rule 10.24 — Targeting Rules', () => {
  test.todo('Targets chosen upon declaration; must be in play; played card cannot be targeted until resolved; face-down cards cannot be targeted');
});
