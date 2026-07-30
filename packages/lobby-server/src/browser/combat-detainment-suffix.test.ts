import { describe, it, expect } from 'vitest';
import { withDetainmentSuffix } from './combat-detainment-suffix.js';

/**
 * Regression test for the combat situation banner (game ms6gbt8d-5na91m, seq 453+):
 * an orc creature (le-*) attacked wigy's company as a detainment attack
 * (`combat.detainment: true` in the state log), but the banner text read exactly
 * like a normal attack ("Assign 3 strikes at 9 prowess — ..."), with nothing
 * distinguishing it from a wounding attack.
 *
 * Per CoE 3.II.1, a successful strike from a detainment attack taps the target
 * instead of wounding it and skips body checks entirely — a materially
 * different risk than a normal attack, so the banner must say so.
 */
describe('withDetainmentSuffix', () => {
  it('appends a Detainment marker when the attack is detainment', () => {
    expect(withDetainmentSuffix('Assign 3 strikes at 9 prowess — Your turn • 0 assigned, 3 remaining', true))
      .toBe('Assign 3 strikes at 9 prowess — Your turn • 0 assigned, 3 remaining (Detainment)');
  });

  it('leaves the banner text unchanged for a normal attack', () => {
    expect(withDetainmentSuffix('Assign 3 strikes at 9 prowess — Your turn • 0 assigned, 3 remaining', false))
      .toBe('Assign 3 strikes at 9 prowess — Your turn • 0 assigned, 3 remaining');
  });
});
