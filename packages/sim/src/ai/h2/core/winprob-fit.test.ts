/**
 * @module ai/h2/core/winprob-fit.test
 *
 * The fit has to be trustworthy before anything built on `W` means anything,
 * so it is checked the only way a fit can be: generate data from known
 * coefficients and confirm they come back. The synthetic corpus is built
 * deterministically (exact expected counts, no sampling), so the test cannot
 * flake and a failure is always a real regression.
 */

import { describe, test, expect } from 'vitest';
import { evaluateModel, fitCoefficients, reliabilityDiagram } from './winprob-fit.js';
import type { WinProbSample } from './winprob-fit.js';
import { sigmoid, winProbability, winProbabilitySlope } from './winprob.js';
import { testWinProbModel } from '../test-support.js';

const TURN_SCALE = 40;
const TRUE_TSD = 0.09;
const TRUE_TSD_TURN = 0.11;
/** Samples generated per (tsd, turn) cell; large enough to pin the fit tightly. */
const CELL_SIZE = 200;

/** A corpus whose win rates match the true coefficients exactly. */
function syntheticCorpus(): WinProbSample[] {
  const samples: WinProbSample[] = [];
  let gameIndex = 0;
  for (let tsd = -20; tsd <= 20; tsd += 2) {
    for (let turn = 5; turn <= 40; turn += 5) {
      const p = sigmoid(TRUE_TSD * tsd + TRUE_TSD_TURN * tsd * (turn / TURN_SCALE));
      const wins = Math.round(p * CELL_SIZE);
      for (let i = 0; i < CELL_SIZE; i++) {
        samples.push({ tsd, turn, won: i < wins ? 1 : 0, gameIndex: gameIndex++ });
      }
    }
  }
  return samples;
}

describe('fitting W', () => {
  test('recovers the coefficients that generated the data', () => {
    const fitted = fitCoefficients(syntheticCorpus(), { turnScale: TURN_SCALE });
    expect(fitted.tsd).toBeCloseTo(TRUE_TSD, 2);
    expect(fitted.tsdTurn).toBeCloseTo(TRUE_TSD_TURN, 2);
  });

  test('is deterministic — the same corpus always gives the same answer', () => {
    const corpus = syntheticCorpus();
    expect(fitCoefficients(corpus, { turnScale: TURN_SCALE }))
      .toEqual(fitCoefficients(corpus, { turnScale: TURN_SCALE }));
  });

  test('refuses an empty corpus rather than inventing a curve', () => {
    expect(() => fitCoefficients([], { turnScale: TURN_SCALE })).toThrow('no samples');
  });
});

describe('the model itself', () => {
  const model = testWinProbModel();

  test('is odd in TSD by construction: an even game is exactly a coin flip', () => {
    expect(winProbability(model, 0, 20)).toBe(0.5);
    expect(winProbability(model, 7, 20) + winProbability(model, -7, 20)).toBeCloseTo(1, 12);
  });

  test('a point of TSD is worth more the later it is scored', () => {
    expect(winProbability(model, 5, 40)).toBeGreaterThan(winProbability(model, 5, 5));
    expect(winProbabilitySlope(model, 0, 40)).toBeGreaterThan(winProbabilitySlope(model, 0, 5));
  });

  test('the slope flattens once the game is decided', () => {
    expect(winProbabilitySlope(model, 30, 40)).toBeLessThan(winProbabilitySlope(model, 0, 40));
  });
});

describe('scoring', () => {
  test('a perfect predictor scores 0 and a coin flip scores 0.25', () => {
    const model = testWinProbModel({ tsd: 100, tsdTurn: 0 });
    const decisive: WinProbSample[] = [
      { tsd: 5, turn: 10, won: 1, gameIndex: 0 },
      { tsd: -5, turn: 10, won: 0, gameIndex: 1 },
    ];
    expect(evaluateModel(model, decisive).brier).toBeCloseTo(0, 6);
    expect(evaluateModel(model, decisive).signAccuracy).toBe(1);

    const blind = testWinProbModel({ tsd: 0, tsdTurn: 0 });
    expect(evaluateModel(blind, decisive).brier).toBeCloseTo(0.25, 12);
  });

  test('ties take no side, so they neither help nor hurt sign accuracy', () => {
    const model = testWinProbModel();
    const scored = evaluateModel(model, [
      { tsd: 0, turn: 10, won: 1, gameIndex: 0 },
      { tsd: 5, turn: 10, won: 1, gameIndex: 1 },
    ]);
    expect(scored.signAccuracy).toBe(1);
  });

  test('the reliability diagram bins predictions against observed rates', () => {
    const bins = reliabilityDiagram([0.05, 0.15, 0.95], [0, 1, 1]);
    expect(bins).toHaveLength(10);
    expect(bins[0].count).toBe(1);
    expect(bins[0].actual).toBe(0);
    expect(bins[9].actual).toBe(1);
    expect(bins.reduce((sum, b) => sum + b.count, 0)).toBe(3);
  });
});
