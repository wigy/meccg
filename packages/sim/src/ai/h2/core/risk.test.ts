/**
 * @module ai/h2/core/risk.test
 *
 * The headline property of the design: risk behaviour is *emergent*, not
 * hand-tuned. Nothing in these tests sets a "be bolder when losing" constant —
 * the preference for variance when trailing and against it when leading falls
 * out of integrating the win-probability curve over the outcomes, because a
 * trailing player sits on its convex limb and a leading player on its concave
 * one. If this ever stops holding, the whole rationale for §2.1 is gone.
 */

import { describe, test, expect } from 'vitest';
import type { Outcome } from './types.js';
import { riskPosture, scoreMeanVariance, scoreOutcomes } from './risk.js';
import { DEFAULT_TUNABLES } from './tunables.js';
import { testWinProbModel } from '../test-support.js';

const MODEL = testWinProbModel();
const TURN = 20;

/** Two plays with the same expected TSD: one certain, one a coin flip. */
const SAFE: readonly Outcome[] = [{ p: 1, label: 'certain +2', dtsd: 2 }];
const GAMBLE: readonly Outcome[] = [
  { p: 0.5, label: 'big win', dtsd: 12 },
  { p: 0.5, label: 'nothing', dtsd: -8 },
];

describe('risk posture', () => {
  test('is neutral at an even standing', () => {
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN);
    expect(posture.standing.winProbability).toBeCloseTo(0.5, 12);
    expect(posture.lambda).toBeCloseTo(0, 12);
    expect(posture.source).toBe('fitted');
  });

  test('turns risk-seeking when trailing and risk-averse when leading', () => {
    expect(riskPosture(MODEL, DEFAULT_TUNABLES, -12, TURN).lambda).toBeGreaterThan(0);
    expect(riskPosture(MODEL, DEFAULT_TUNABLES, 12, TURN).lambda).toBeLessThan(0);
  });

  test('sharpens as the game runs out of turns', () => {
    const early = riskPosture(MODEL, DEFAULT_TUNABLES, -8, 5).lambda;
    const late = riskPosture(MODEL, DEFAULT_TUNABLES, -8, 40).lambda;
    expect(late).toBeGreaterThan(early);
  });

  test('can be overridden, and records that it was', () => {
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, -12, TURN, -0.9);
    expect(posture.lambda).toBe(-0.9);
    expect(posture.source).toBe('override');
    // The standing itself is still reported honestly.
    expect(posture.standing.winProbability).toBeLessThan(0.5);
  });

  test('an override recentres the curve to the standing that has that curvature', () => {
    // λ and W are the same quantity twice (λ = 1 − 2W), so a requested λ names
    // a win probability and that names a point on the curve. Without this the
    // override would have nowhere to enter the integrated path.
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN, 0.5);
    expect(posture.standing.effectiveWinProbability).toBeCloseTo(0.25, 6);
    expect(posture.standing.effectiveTsd).toBeLessThan(0);
    // The real standing is still reported unchanged beside it.
    expect(posture.standing.tsd).toBe(0);
    expect(posture.standing.winProbability).toBeCloseTo(0.5, 12);
  });

  test('the fitted posture evaluates at the real standing', () => {
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, -7, TURN);
    expect(posture.standing.effectiveTsd).toBe(posture.standing.tsd);
    expect(posture.standing.effectiveWinProbability).toBe(posture.standing.winProbability);
  });

  test('stays inside [-1, 1] however extreme the override', () => {
    expect(riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN, 5).lambda).toBe(1);
    expect(riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN, -5).lambda).toBe(-1);
  });
});

describe('integrated utility', () => {
  test('mean expected TSD is identical for the safe and the risky line', () => {
    expect(scoreOutcomes(MODEL, riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN), SAFE).expectedTsd)
      .toBeCloseTo(scoreOutcomes(MODEL, riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN), GAMBLE).expectedTsd, 12);
  });

  test('prefers the gamble when trailing', () => {
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, -12, TURN);
    const safe = scoreOutcomes(MODEL, posture, SAFE);
    const gamble = scoreOutcomes(MODEL, posture, GAMBLE);
    expect(gamble.utility).toBeGreaterThan(safe.utility);
    expect(gamble.sigmaTsd).toBeGreaterThan(safe.sigmaTsd);
  });

  test('prefers the safe line when leading', () => {
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, 12, TURN);
    expect(scoreOutcomes(MODEL, posture, GAMBLE).utility)
      .toBeLessThan(scoreOutcomes(MODEL, posture, SAFE).utility);
  });

  test('an operator override changes the choice, not just the numbers', () => {
    // At an even standing the curve is symmetric and the two lines tie. Asking
    // for a risk-seeking posture must then prefer the gamble and a risk-averse
    // one the safe line — through the same integration, with no second formula.
    const seeking = riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN, 0.8);
    const averse = riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN, -0.8);
    const prefersGamble = (posture: ReturnType<typeof riskPosture>): boolean =>
      scoreOutcomes(MODEL, posture, GAMBLE).utility > scoreOutcomes(MODEL, posture, SAFE).utility;
    expect(prefersGamble(seeking)).toBe(true);
    expect(prefersGamble(averse)).toBe(false);
  });

  test('says so when the curve was moved, rather than hiding it in the total', () => {
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN, 0.8);
    const rationale = scoreOutcomes(MODEL, posture, GAMBLE).rationale;
    expect(rationale.children?.some(c => c.label === 'curve recentred to')).toBe(true);
  });

  test('reports how it was computed and names the constant it used', () => {
    const scored = scoreOutcomes(MODEL, riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN), GAMBLE);
    expect(scored.method).toBe('integrated');
    expect(scored.rationale.children?.some(c => c.tunable === 'riskCurvatureScale')).toBe(true);
  });
});

describe('mean-variance shortcut', () => {
  test('agrees with the integrated form on which line to take', () => {
    for (const tsd of [-12, 12]) {
      const posture = riskPosture(MODEL, DEFAULT_TUNABLES, tsd, TURN);
      const integratedPrefersGamble =
        scoreOutcomes(MODEL, posture, GAMBLE).utility > scoreOutcomes(MODEL, posture, SAFE).utility;
      const shortcutPrefersGamble =
        scoreMeanVariance(posture, DEFAULT_TUNABLES, 2, 10).utility
        > scoreMeanVariance(posture, DEFAULT_TUNABLES, 2, 0).utility;
      expect(shortcutPrefersGamble).toBe(integratedPrefersGamble);
    }
  });

  test('declares itself, so a cheap answer is never mistaken for an exact one', () => {
    const posture = riskPosture(MODEL, DEFAULT_TUNABLES, 0, TURN);
    expect(scoreMeanVariance(posture, DEFAULT_TUNABLES, 2, 1).method).toBe('mean-variance');
  });
});
