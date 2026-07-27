/**
 * @module ai/h2/core/risk
 *
 * The Risk Oracle — a shared dependency of every H2 module.
 *
 * Risk is not a separate scoring term bolted onto the utility. It is the
 * curvature of the win-probability curve, and the oracle's job is to expose
 * that fact in two forms:
 *
 * - **Integrated** (§2.1): `Σ p·W(tsd + Δ) − W(tsd)`. Nothing else is needed —
 *   a trailing player sits on the convex limb, so spread raises `E[W]` and the
 *   gamble is chosen automatically; a leading player sits on the concave limb
 *   and the safe line wins. This is the path modules should take.
 * - **Mean-variance** (`μ + λ·σ`, §2.2): the cheap shortcut for a module that
 *   cannot afford a full distribution. `λ` is *derived* from the same
 *   curvature, so the two forms are one idea expressed twice — but a module
 *   must report which one it used, because they are not identical.
 *
 * An explicit posture is kept even though it is derived, because the CLI has
 * to sweep it (`sweep --over risk`), tests have to pin it, and an operator may
 * want to override the fitted curve.
 */

import type { Outcome } from './types.js';
import type { Tunables } from './tunables.js';
import type { WinProbModel } from './winprob.js';
import { tsdAtWinProbability, winProbability, winProbabilitySlope } from './winprob.js';
import { distributionStats } from './tsd.js';
import { leaf, node } from './rationale.js';
import type { Rationale } from './types.js';

/** The standing the posture was derived from. */
export interface RiskStanding {
  /** Tournament-score differential now. */
  readonly tsd: number;
  /** Current turn number. */
  readonly turnNumber: number;
  /** `W(tsd, turn)` — the fitted win probability at the *real* standing. */
  readonly winProbability: number;
  /** `dW/d(tsd)` here: what one TSD point is worth in win probability. */
  readonly winProbabilitySlope: number;
  /**
   * The point on the curve utilities are integrated at. Equal to `tsd` under
   * the fitted posture; under an override it is the standing whose curvature
   * matches the requested `lambda`, so the override acts through the same
   * mechanism the fitted posture does instead of a parallel formula.
   */
  readonly effectiveTsd: number;
  /** `W(effectiveTsd, turn)` — the baseline every utility is measured from. */
  readonly effectiveWinProbability: number;
}

/** How risk-seeking the player should be, and why. */
export interface RiskPosture {
  /** −1 = maximally risk-averse … +1 = maximally risk-seeking. */
  readonly lambda: number;
  /** `fitted` = derived from the curvature of `W`; `override` = forced. */
  readonly source: 'fitted' | 'override';
  /** The standing `lambda` was derived from. */
  readonly standing: RiskStanding;
}

/** Bounds of the risk posture. */
const LAMBDA_MIN = -1;
const LAMBDA_MAX = 1;

/** Clamp a value into `[lo, hi]`. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Derive the risk posture at a standing.
 *
 * For a logistic `W`, the second derivative carries the factor `(1 − 2W)`, so
 * `λ = 1 − 2W` *is* the normalised curvature: strongly positive (seek
 * variance) when losing, strongly negative (avoid it) when winning, zero at an
 * even game. No separate constant is needed beyond a scale, and that scale
 * defaults to 1.
 */
export function riskPosture(
  model: WinProbModel,
  tunables: Tunables,
  tsd: number,
  turnNumber: number,
  override?: number,
): RiskPosture {
  const w = winProbability(model, tsd, turnNumber);
  const base = {
    tsd,
    turnNumber,
    winProbability: w,
    winProbabilitySlope: winProbabilitySlope(model, tsd, turnNumber),
  };

  if (override === undefined) {
    return {
      lambda: clamp(tunables.riskCurvatureScale * (1 - 2 * w), LAMBDA_MIN, LAMBDA_MAX),
      source: 'fitted',
      standing: { ...base, effectiveTsd: tsd, effectiveWinProbability: w },
    };
  }

  // `λ = 1 − 2W`, so a requested lambda names a win probability, and that win
  // probability names a point on the curve. Evaluating there is what gives the
  // override teeth on the integrated path — without it, an operator could set
  // any lambda and watch nothing happen.
  const lambda = clamp(override, LAMBDA_MIN, LAMBDA_MAX);
  const target = (1 - lambda / (tunables.riskCurvatureScale || 1)) / 2;
  const shifted = tsdAtWinProbability(model, target, turnNumber);
  const effectiveTsd = shifted ?? tsd;
  return {
    lambda,
    source: 'override',
    standing: {
      ...base,
      effectiveTsd,
      effectiveWinProbability: winProbability(model, effectiveTsd, turnNumber),
    },
  };
}

/** The utility of an outcome distribution, plus its distribution statistics. */
export interface ScoredOutcomes {
  /** Mean TSD delta. */
  readonly expectedTsd: number;
  /** Standard deviation of the TSD delta. */
  readonly sigmaTsd: number;
  /** Change in win probability. */
  readonly utility: number;
  /** Which conversion was used. */
  readonly method: 'integrated' | 'mean-variance';
  /** Explanation of the conversion, for splicing into a module's rationale. */
  readonly rationale: Rationale;
}

/**
 * Convert an outcome distribution into a change in win probability by
 * integrating `W` over the outcomes. This is the preferred path: it needs no
 * risk constant at all, because the curve supplies the risk attitude.
 */
export function scoreOutcomes(
  model: WinProbModel,
  posture: RiskPosture,
  outcomes: readonly Outcome[],
): ScoredOutcomes {
  const { mean, sigma } = distributionStats(outcomes);
  const { effectiveTsd, effectiveWinProbability: base, turnNumber: turn } = posture.standing;
  let expected = 0;
  for (const o of outcomes) expected += o.p * winProbability(model, effectiveTsd + o.dtsd, turn);
  const utility = expected - base;

  const children = [
    leaf('W(now)', base, { unit: 'winprob' }),
    leaf('E[W(after)]', expected, { unit: 'winprob', note: 'expectation over outcomes, not W of the mean' }),
    leaf('E[Δtsd]', mean, { unit: 'tsd' }),
    leaf('σ[Δtsd]', sigma, { unit: 'tsd' }),
    leaf('risk λ', posture.lambda, { note: posture.source, tunable: 'riskCurvatureScale' }),
  ];
  if (posture.source === 'override') {
    // Moving the curve is a large intervention, so it is stated rather than
    // folded silently into the numbers above.
    children.push(leaf('curve recentred to', effectiveTsd, {
      unit: 'tsd',
      note: `override λ ${posture.lambda.toFixed(2)}; the real standing is ${posture.standing.tsd.toFixed(1)}`,
    }));
  }

  return {
    expectedTsd: mean,
    sigmaTsd: sigma,
    utility,
    method: 'integrated',
    rationale: node('utility', utility, children, { unit: 'winprob' }),
  };
}

/**
 * The mean-variance shortcut, `μ + λ·σ` in TSD units, converted to win
 * probability by the local slope. For modules that genuinely cannot enumerate
 * outcomes; anything that can should call {@link scoreOutcomes} instead, and
 * the reported `method` makes the difference auditable.
 */
export function scoreMeanVariance(
  posture: RiskPosture,
  tunables: Tunables,
  mean: number,
  sigma: number,
): ScoredOutcomes {
  const riskAdjustedTsd = mean + posture.lambda * sigma;
  const utility = riskAdjustedTsd * tunables.meanVarianceWinProbSlope;
  return {
    expectedTsd: mean,
    sigmaTsd: sigma,
    utility,
    method: 'mean-variance',
    rationale: node('utility', utility, [
      leaf('μ', mean, { unit: 'tsd' }),
      leaf('σ', sigma, { unit: 'tsd' }),
      leaf('risk λ', posture.lambda, { note: posture.source, tunable: 'riskCurvatureScale' }),
      leaf('μ + λ·σ', riskAdjustedTsd, { unit: 'tsd' }),
      leaf('win probability per tsd', tunables.meanVarianceWinProbSlope, {
        unit: 'winprob',
        tunable: 'meanVarianceWinProbSlope',
      }),
    ], { unit: 'winprob' }),
  };
}
