/**
 * @module rule-8.07-each-character-faces-strike
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.07: Each Character Faces a Strike
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Effects that would allow a character to be assigned more than one strike do not affect attacks for which "each character faces a strike", and such an attack cannot have its number of strikes modified unless an effect reduces the number of strikes to a specific number.
 */

import { describe, test } from 'vitest';

// "Each character faces a strike" attacks (`combat.eachCharacterFacesOneStrike`)
// pre-assign exactly one strike per company member (see rule 6.03's
// each-character test and The Worthy Hills as-142's "strikesTotal = company
// size" test) — there is no code path that adds excess strikes on top of
// that pre-assignment, so multi-strike-assignment effects are structurally
// inert against these attacks already. What's unverified is the narrower
// claim that the strike *count itself* can still be reduced "to a specific
// number" by some effect — no card in the pool combines an
// each-character-faces-a-strike attack with a strike-count-reducing effect,
// so there's no reachable scenario to exercise that carve-out.
describe('Rule 8.07 — Each Character Faces a Strike', () => {
  test.todo('Effects for multiple strikes do not apply to "each character faces a strike" attacks; cannot modify strike count unless to specific number');
});
