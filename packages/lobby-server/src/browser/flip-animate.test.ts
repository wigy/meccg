import { describe, it, expect } from 'vitest';
import { shouldAnimateBetween } from './flip-animate.js';

/**
 * Regression tests for the FLIP move decision.
 *
 * The hand and opponent arcs are hidden in the all-companies overview, which
 * the view enters and leaves automatically on every turn change. An element in
 * a `display: none` container reports a zero rect, and treating that as a real
 * position at the viewport origin made the whole hand fly in from the top-left
 * corner when the view returned to single-company on the player's own turn.
 */
describe('shouldAnimateBetween', () => {
  const card = (left: number, top: number) => ({ width: 100, height: 140, left, top });
  /** What getBoundingClientRect returns inside a `display: none` container. */
  const hidden = { width: 0, height: 0, left: 0, top: 0 };

  it('does NOT animate a card returning from the hidden hand arc', () => {
    expect(shouldAnimateBetween(hidden, card(420, 800))).toBe(false);
  });

  it('does NOT animate a card whose new position is in the hidden hand arc', () => {
    expect(shouldAnimateBetween(card(420, 800), hidden)).toBe(false);
  });

  it('does NOT animate when both positions are unlaid out', () => {
    expect(shouldAnimateBetween(hidden, hidden)).toBe(false);
  });

  it('animates a card that moved between two laid-out positions', () => {
    expect(shouldAnimateBetween(card(420, 800), card(120, 240))).toBe(true);
  });

  it('animates a card that moved to the viewport origin while laid out', () => {
    expect(shouldAnimateBetween(card(420, 800), card(0, 0))).toBe(true);
  });

  it('does NOT animate a sub-pixel jitter', () => {
    expect(shouldAnimateBetween(card(420, 800), card(420.4, 800.9))).toBe(false);
  });

  it('animates a one-pixel move on a single axis', () => {
    expect(shouldAnimateBetween(card(420, 800), card(421, 800))).toBe(true);
  });
});
