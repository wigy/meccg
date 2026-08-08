import { describe, it, expect } from 'vitest';
import { strikeResultDisplay } from './strike-result-display.js';

/**
 * Regression test for the combat result overlay (game msj2v5nq-5tf6mg, seq 898):
 * Dori (tw-141), boosted by "The Dwarves Are upon You!" (dm-124), tied her
 * strike against Bairanax Ahunt's attack (CoE 3.iv.7 — ineffectual, she taps
 * but is not wounded). The combat view's overlay/classList logic only handled
 * `'success'` and `'wounded'` explicitly and fell through to the "eliminated"
 * heavy-X icon for every other value, including `'tie'` — showing a defended,
 * unwounded character with the most alarming icon available and making the
 * report read as "wrongly not wounded" when in fact she was never at risk of
 * the eliminated outcome shown.
 */
describe('strikeResultDisplay', () => {
  it('maps a clean success to success', () => {
    expect(strikeResultDisplay('success')).toBe('success');
  });

  it('maps a tie (CoE 3.iv.7 ineffectual strike) to success', () => {
    expect(strikeResultDisplay('tie')).toBe('success');
  });

  it('maps a survived creature/agent body check to success', () => {
    expect(strikeResultDisplay('survived')).toBe('success');
  });

  it('maps a canceled strike to success', () => {
    expect(strikeResultDisplay('canceled')).toBe('success');
  });

  it('maps an absorbed wound to success', () => {
    expect(strikeResultDisplay('absorbed')).toBe('success');
  });

  it('maps wounded to wounded', () => {
    expect(strikeResultDisplay('wounded')).toBe('wounded');
  });

  it('maps eliminated to eliminated', () => {
    expect(strikeResultDisplay('eliminated')).toBe('eliminated');
  });

  it('returns null for an unresolved/missing result', () => {
    expect(strikeResultDisplay(undefined)).toBeNull();
  });
});
