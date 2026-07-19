/**
 * @module rule-8.02-combat-step1-pre-assignment
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.02: Step 1: Pre-Assignment Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Combat, Step 1 (Pre-Assignment Actions) - Prior to strikes being assigned, either player may take actions that they would normally be allowed to take during the current phase of the game in which combat is taking place. Regardless of the phase of the game in which combat is taking place, the resource player may take resource/character actions, and the hazard player may take hazard actions if combat is taking place during a movement/hazard phase, that would either:
 * • cancel the attack
 * • modify attributes of the attack as a whole (e.g. the number of strikes, which player assigns strikes, the prowess or body of the attack, etc.).
 * Players cannot take actions that cancel the attack or modify the attack as a whole after this step, which continues until both players have finished taking actions prior to strike assignment.
 */

import { describe, test } from 'vitest';

// The pre-assignment cancel/modify window is implemented: `inCancelWindow`
// (legal-actions/combat.ts) gates `cancelAttackActions`/`modifyAttackActions`
// to `combat.phase === 'assign-strikes'` with no strikes assigned yet (or the
// equivalent pre-resolution window for "each character faces a strike"
// attacks), matching CRF 22 Annotation 13 ("an attack may not be canceled
// once its strikes have been assigned"). It is exercised implicitly by many
// individual cancel-attack card tests throughout this section (e.g. Escape,
// Adûnaphel the Ringwraith). What remains unverified in isolation is the
// specific "still counts against the company's hazard limit" claim for a
// hazard action taken by the attacker in this window during an M/H-phase
// combat — hazard-limit bookkeeping is uniform across every hazard play
// (mh-hazard-play.ts) regardless of whether combat happens to be active, so
// there is no separate "combat pre-assignment" hazard-limit carve-out to
// isolate from the general hazard-limit rules already covered in section 05.
describe('Rule 8.02 — Step 1: Pre-Assignment Actions', () => {
  test.todo('Before strikes assigned, players may cancel attack or modify attack attributes; company hazard limit still in effect');
});
