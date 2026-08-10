import { describe, it, expect } from 'vitest';
import { withIsolatedSuffix } from './combat-isolated-suffix.js';

/**
 * Regression test for the combat situation banner (game msnia6y0-qgm0n1, seq
 * 1522): Gamling's Assassin (three attacks of one strike each) was correctly
 * reduced to a single uncancelable attack by AI-MC's in-play *Forewarned Is
 * Forearmed* (`combat.isolated: true` in the state log), but the banner text
 * read exactly like a normal single-strike attack, with no indication of why
 * only one strike occurred or which card was responsible.
 *
 * Per *Forewarned Is Forearmed*'s text, a multi-attack creature is reduced to
 * one attack "of the hazard player's choice (this attack cannot be
 * canceled)" — a materially different situation from a plain single-strike
 * creature, so the banner must say so.
 */
describe('withIsolatedSuffix', () => {
  it('names the isolating card when the attack is isolated', () => {
    expect(withIsolatedSuffix('Assign 1 strike at 11 prowess — Your turn • 0 assigned, 1 remaining', true, 'Forewarned Is Forearmed'))
      .toBe('Assign 1 strike at 11 prowess — Your turn • 0 assigned, 1 remaining (Isolated by Forewarned Is Forearmed — cannot be canceled)');
  });

  it('falls back to a generic marker when the isolating card name is unavailable', () => {
    expect(withIsolatedSuffix('Assign 1 strike at 11 prowess — Your turn • 0 assigned, 1 remaining', true, undefined))
      .toBe('Assign 1 strike at 11 prowess — Your turn • 0 assigned, 1 remaining (Isolated — cannot be canceled)');
  });

  it('leaves the banner text unchanged for a non-isolated attack', () => {
    expect(withIsolatedSuffix('Assign 3 strikes at 11 prowess — Your turn • 0 assigned, 3 remaining', false, undefined))
      .toBe('Assign 3 strikes at 11 prowess — Your turn • 0 assigned, 3 remaining');
  });
});
