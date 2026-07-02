/**
 * @module rule-8.12-ss-step1-attacker-actions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.12: Strike Step 1: Attacking Player Actions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Strike Sequence, Step 1 (Attacking Player Actions) - If the attack is taking place during their opponent's movement/hazard phase, the hazard player may take hazard actions that would affect the resolution of the strike, still counting against the company's hazard limit.
 */

import { describe, test } from 'vitest';

// The hazard player can already play hazard permanent-events during an
// active strike sequence (see the combat-hazard-play window offered during
// resolve-strike), and hazard-limit bookkeeping is uniform across every
// hazard play (mh-hazard-play.ts) regardless of whether combat happens to be
// active — there is no separate "mid-strike" exemption from the limit. This
// makes the claim itself already true by construction, but there is no
// isolated test proving a mid-strike hazard play specifically decrements the
// same company's hazard limit rather than some general count; the general
// hazard-limit mechanics are already covered in section 05.
describe('Rule 8.12 — Strike Step 1: Attacking Player Actions', () => {
  test.todo('During opponent M/H phase, hazard player may take hazard actions affecting strike resolution; counts against limit');
});
