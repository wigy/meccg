/**
 * @module ai/h2/core/winprob-fit
 *
 * Fitting and scoring for the win-probability model `W(tsd, turn)`.
 *
 * Separated from `winprob.ts` because this is tooling: the agent only ever
 * evaluates `W`, while the `fit-winprob` CLI and the model's tests are the
 * only callers that fit one. The fit is a two-parameter logistic regression
 * solved by Newton's method, which converges in a handful of iterations and,
 * unlike a step-size-dependent gradient descent, gives a deterministic answer
 * that a test can pin.
 *
 * Guard rail from `docs/ai-training-system.md` §9: **value sample size is
 * games, not decisions.** Samples drawn from the same game share their label,
 * so held-out evaluation splits by game or it flatters itself.
 */

import type { ReliabilityBin, WinProbHoldout, WinProbModel } from './winprob.js';
import { sigmoid, winProbability } from './winprob.js';

/** One training row: the standing at a moment, labelled with the eventual result. */
export interface WinProbSample {
  /** Tournament-score differential from the labelled player's perspective. */
  readonly tsd: number;
  /** Turn the observation was taken at. */
  readonly turn: number;
  /** 1 if this player eventually won, 0 if they lost. */
  readonly won: 0 | 1;
  /** Index of the game the sample came from, for game-level splitting. */
  readonly gameIndex: number;
}

/** Just the fitted part of a {@link WinProbModel}. */
export interface WinProbCoefficients {
  /** Coefficient on `tsd`. */
  readonly tsd: number;
  /** Coefficient on `tsd · t̂`. */
  readonly tsdTurn: number;
}

/** Knobs of the fitting procedure itself (not gameplay tunables). */
export interface FitOptions {
  /** Turn normaliser; `t̂ = turn / turnScale`. */
  readonly turnScale: number;
  /** L2 regularisation strength, keeping the fit finite on separable data. */
  readonly l2?: number;
  /** Maximum Newton iterations. */
  readonly maxIterations?: number;
  /** Stop when the largest coefficient step falls below this. */
  readonly tolerance?: number;
}

/** Default L2 strength: enough to bound coefficients, small enough to barely bias them. */
const DEFAULT_L2 = 1e-3;
/** Newton converges in a few steps; this is a safety bound, not a schedule. */
const DEFAULT_MAX_ITERATIONS = 50;
/** Coefficient step below which the fit is considered converged. */
const DEFAULT_TOLERANCE = 1e-10;

/**
 * Fit `z = β₁·tsd + β₂·tsd·t̂` by Newton's method on the penalised
 * log-likelihood. No intercept: `W` is odd in TSD by construction (§2.1).
 */
export function fitCoefficients(
  samples: readonly WinProbSample[],
  options: FitOptions,
): WinProbCoefficients {
  const l2 = options.l2 ?? DEFAULT_L2;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  if (samples.length === 0) throw new Error('fitCoefficients: no samples');

  let b0 = 0;
  let b1 = 0;
  for (let iter = 0; iter < maxIterations; iter++) {
    // Gradient of the penalised log-likelihood, and the negated Hessian
    // (positive definite, so the Newton step is a descent direction).
    let g0 = -l2 * b0;
    let g1 = -l2 * b1;
    let h00 = l2;
    let h01 = 0;
    let h11 = l2;
    for (const s of samples) {
      const x0 = s.tsd;
      const x1 = s.tsd * (s.turn / options.turnScale);
      const p = sigmoid(b0 * x0 + b1 * x1);
      const residual = s.won - p;
      g0 += residual * x0;
      g1 += residual * x1;
      const w = p * (1 - p);
      h00 += w * x0 * x0;
      h01 += w * x0 * x1;
      h11 += w * x1 * x1;
    }
    const det = h00 * h11 - h01 * h01;
    if (!Number.isFinite(det) || Math.abs(det) < Number.EPSILON) break;
    const step0 = (h11 * g0 - h01 * g1) / det;
    const step1 = (h00 * g1 - h01 * g0) / det;
    b0 += step0;
    b1 += step1;
    if (Math.abs(step0) < tolerance && Math.abs(step1) < tolerance) break;
  }
  return { tsd: b0, tsdTurn: b1 };
}

/** Number of equal-width bins in the reliability diagram. */
const RELIABILITY_BINS = 10;

/** Group predictions into bins and compare predicted against observed win rate. */
export function reliabilityDiagram(
  predictions: readonly number[],
  labels: readonly number[],
): ReliabilityBin[] {
  const sums = Array.from({ length: RELIABILITY_BINS }, () => ({ n: 0, predicted: 0, actual: 0 }));
  for (let i = 0; i < predictions.length; i++) {
    const idx = Math.min(RELIABILITY_BINS - 1, Math.floor(predictions[i] * RELIABILITY_BINS));
    sums[idx].n++;
    sums[idx].predicted += predictions[i];
    sums[idx].actual += labels[i];
  }
  return sums.map((s, i) => ({
    from: i / RELIABILITY_BINS,
    to: (i + 1) / RELIABILITY_BINS,
    count: s.n,
    predicted: s.n === 0 ? 0 : s.predicted / s.n,
    actual: s.n === 0 ? 0 : s.actual / s.n,
  }));
}

/** Clamp used to keep log-loss finite on confident predictions. */
const LOG_LOSS_EPSILON = 1e-12;

/**
 * Score a model on samples it was not fitted on. `signAccuracy` is directly
 * comparable to the value-head numbers in `docs/ai-training-system.md` §9
 * (0.56 / 0.63 / 0.68 / 0.79 by game quarter), which is what establishes that
 * the raw score differential carries real signal in the first place.
 */
export function evaluateModel(
  model: WinProbModel,
  samples: readonly WinProbSample[],
): Omit<WinProbHoldout, 'games'> {
  const predictions: number[] = [];
  const labels: number[] = [];
  let brier = 0;
  let logLoss = 0;
  let signHits = 0;
  let signCount = 0;
  for (const s of samples) {
    const p = winProbability(model, s.tsd, s.turn);
    predictions.push(p);
    labels.push(s.won);
    brier += (p - s.won) ** 2;
    logLoss -= s.won === 1 ? Math.log(Math.max(p, LOG_LOSS_EPSILON)) : Math.log(Math.max(1 - p, LOG_LOSS_EPSILON));
    // A tied standing predicts exactly 0.5 and takes no side; counting it as
    // a hit or a miss would both be wrong, so it is excluded.
    if (p !== 0.5) {
      signCount++;
      if ((p > 0.5 ? 1 : 0) === s.won) signHits++;
    }
  }
  const n = Math.max(1, samples.length);
  return {
    samples: samples.length,
    brier: brier / n,
    logLoss: logLoss / n,
    signAccuracy: signCount === 0 ? 0 : signHits / signCount,
    reliability: reliabilityDiagram(predictions, labels),
  };
}
