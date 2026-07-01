/**
 * @module rule-10.37-game-condition-inactive
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.37: Game Condition No Longer in Effect
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a game condition is no longer in effect, any ongoing effects of passive conditions that were dependent on that game condition also become inactive.
 */

import { describe, test } from 'vitest';

// This is the general principle behind why `when`-gated DSL effects (mp-
// modifier, check-modifier, stat-modifier) are re-evaluated from scratch on
// every `recomputeDerived` pass rather than latched once true — e.g. Durin's
// Axe's "+2 MP if held by a Dwarf" effect stops applying the instant it's
// moved onto a non-Dwarf bearer. That specific mechanism is already
// exercised by the individual card tests that use `when` conditions; this
// rule number doesn't correspond to a distinct code path beyond "re-run the
// condition check every time," so a standalone test here would just
// re-assert what those card tests already cover under a different heading.
describe('Rule 10.37 — Game Condition No Longer in Effect', () => {
  test.todo('If game condition no longer met, ongoing passive condition effects dependent on it become inactive');
});
