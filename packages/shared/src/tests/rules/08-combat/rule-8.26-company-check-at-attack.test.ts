/**
 * @module rule-8.26-company-check-at-attack
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.26: Company Composition Check at Attack
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company's composition and overt/covert status is checked at the beginning of each attack and then remains consistent for the duration of that attack.
 */

import { describe, test } from 'vitest';

// `isCovertCompany` (reducer-utils.ts) is computed fresh at attack-initiation
// time and never re-evaluated mid-combat — `CombatState` doesn't reference
// live company membership at all once built (strikesTotal, creatureRace,
// detainment, etc. are all snapshotted values), so composition changes after
// initiation structurally cannot affect an attack already underway. No test
// specifically drives "add or remove a company member mid-combat" to prove
// this snapshot behavior, since doing so requires an action that can both
// modify company membership and be legally declared while combat is active
// — no such action exists in the current legal-action set (combat actions
// exclude organization-phase membership changes), making the scenario itself
// unreachable rather than merely untested.
describe('Rule 8.26 — Company Composition Check at Attack', () => {
  test.todo('Company composition and overt/covert checked at beginning of each attack; remains consistent during attack');
});
