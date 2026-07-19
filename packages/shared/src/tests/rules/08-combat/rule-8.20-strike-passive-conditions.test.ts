/**
 * @module rule-8.20-strike-passive-conditions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.20: Strike Passive Condition Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Actions cannot be taken in response to effects initiated by passive conditions based on the result of a strike, except if the passive condition would initiate a dice-rolling action. Actions that would affect such a roll may then be declared in response.
 * If a character is wounded by a strike and then becomes un-wounded, the character is still considered to have been wounded by the strike.
 * Temporary prowess modifications applied during a strike sequence (e.g. applying -3 to stay untapped, tapping for +1 support, and/or due to tapped/wounded status) are applied only during that particular strike sequence and not at other times.
 */

import { describe, test } from 'vitest';

// "Wounded then un-wounded still counts as wounded" is implemented via the
// `wasAlreadyWounded` strike-assignment field (state-combat.ts), consumed
// e.g. by the body-check `woundedBonus` in combat-actions.ts. The remaining,
// untested claim is the more general one: that actions cannot be taken in
// response to a strike-result-triggered passive condition unless that
// passive condition itself initiates a dice roll. The chain-of-effects
// system doesn't tag passive-condition-initiated entries with a
// "response-eligible only if dice-rolling" marker distinct from ordinary
// chain entries, and no card in the pool pairs a non-dice-rolling strike
// passive condition with a plausible illegal response to prove the
// restriction holds.
describe('Rule 8.20 — Strike Passive Condition Actions', () => {
  test.todo('Cannot respond to passive conditions from strike result, except dice-rolling actions');
});
