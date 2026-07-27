/**
 * @module ai/h2/core/winprob
 *
 * The empirical win-probability model `W(tsd, turn)`.
 *
 * TSD is the common currency but it is not the utility, because a point is
 * worth far more when the score is close than when the game is already
 * decided. Modules convert through `W`:
 *
 * ```text
 * U(action) = Σ_outcomes p_i · W(tsd + Δ_i, turn) − W(tsd, turn)
 * ```
 *
 * Taking the expectation over `W` of each outcome — rather than `W` of the
 * mean — is what makes risk posture emergent instead of hand-tuned: when
 * trailing, the standing sits on the convex limb of the sigmoid so spread
 * raises `E[W]` and the gamble wins; when leading it sits on the concave limb
 * and the safe line wins. See §2.1 of the plan.
 *
 * The model is deliberately **odd in TSD**: `z = β₁·tsd + β₂·tsd·t̂` with no
 * intercept, so `W(0) = 0.5` and `W(−x) = 1 − W(x)` hold by construction. Any
 * fit that needed an intercept to explain the corpus would be describing a
 * seat bias, not the value of a point. Coefficients are fitted from self-play
 * games and shipped as a versioned JSON beside this file; they are never
 * hand-authored.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Fitted coefficients plus the provenance needed to judge them. */
export interface WinProbModel {
  /** Format version of the coefficient file. */
  readonly version: number;
  /** ISO timestamp of the fit. */
  readonly fittedAt: string;
  /** Turn count used to normalise the turn feature (`t̂ = turn / turnScale`). */
  readonly turnScale: number;
  /** Coefficient on `tsd`. */
  readonly tsd: number;
  /** Coefficient on `tsd · t̂` — how much sharper a point gets late. */
  readonly tsdTurn: number;
  /** What the model was fitted on. */
  readonly corpus: WinProbCorpus;
  /** Held-out performance. Held out by *game*, never by decision. */
  readonly holdout: WinProbHoldout;
}

/** Provenance of the fitting corpus. */
export interface WinProbCorpus {
  /** Games that contributed samples (completed games only). */
  readonly games: number;
  /** Total (tsd, turn, won) samples, both perspectives of every game. */
  readonly samples: number;
  /** Agents that generated the corpus. */
  readonly agents: readonly string[];
  /** Deck IDs that generated the corpus. */
  readonly decks: readonly string[];
  /** First seed of the self-play batch, so the corpus is reproducible. */
  readonly seedBase: number;
  /** Fraction of games held out of the fit. */
  readonly holdoutFraction: number;
}

/** One bin of a reliability diagram: predicted vs. observed win rate. */
export interface ReliabilityBin {
  /** Lower edge of the predicted-probability bin. */
  readonly from: number;
  /** Upper edge of the predicted-probability bin. */
  readonly to: number;
  /** Samples that fell in this bin. */
  readonly count: number;
  /** Mean predicted probability in the bin. */
  readonly predicted: number;
  /** Observed win rate in the bin. */
  readonly actual: number;
}

/** Held-out metrics, the evidence that `W` is calibrated rather than merely fitted. */
export interface WinProbHoldout {
  /** Held-out games. */
  readonly games: number;
  /** Held-out samples. */
  readonly samples: number;
  /** Brier score (mean squared error); lower is better, 0.25 = coin flip. */
  readonly brier: number;
  /** Mean negative log-likelihood; 0.693 = coin flip. */
  readonly logLoss: number;
  /** Fraction of samples whose predicted side matched the winner. */
  readonly signAccuracy: number;
  /** Reliability diagram over predicted-probability bins. */
  readonly reliability: readonly ReliabilityBin[];
}

/** Logistic function. */
export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Normalised turn feature: how far into a typical game we are. */
export function turnFraction(model: Pick<WinProbModel, 'turnScale'>, turn: number): number {
  return turn / model.turnScale;
}

/**
 * `W(tsd, turn)` — the probability the player eventually wins, given the
 * tournament-score differential at that turn.
 */
export function winProbability(model: WinProbModel, tsd: number, turn: number): number {
  const t = turnFraction(model, turn);
  return sigmoid(model.tsd * tsd + model.tsdTurn * tsd * t);
}

/**
 * Local slope `dW/d(tsd)` at the current standing — how much one TSD point is
 * worth in win probability right now. Used by the mean-variance shortcut and
 * reported by `explain` so the conversion is never invisible.
 */
export function winProbabilitySlope(model: WinProbModel, tsd: number, turn: number): number {
  const w = winProbability(model, tsd, turn);
  const t = turnFraction(model, turn);
  return (model.tsd + model.tsdTurn * t) * w * (1 - w);
}

/** Location of the shipped coefficient file, checked in beside this module. */
export const MODEL_PATH = path.join(__dirname, 'winprob-model.json');

/** Cached model, so every decision does not re-read the file. */
let cached: WinProbModel | null = null;

/**
 * Load the shipped win-probability model.
 *
 * Throws when the file is missing: an H2 agent without `W` has no utility
 * scale at all, and silently substituting a guessed sigmoid would reintroduce
 * exactly the untraceable constants this design exists to remove. Regenerate
 * with `npm run fit-winprob -w @meccg/sim`.
 */
export function loadWinProbModel(path: string = MODEL_PATH): WinProbModel {
  if (cached && path === MODEL_PATH) return cached;
  if (!fs.existsSync(path)) {
    throw new Error(
      `Win-probability model not found at ${path} — run \`npm run fit-winprob -w @meccg/sim\` to fit one.`,
    );
  }
  const model = JSON.parse(fs.readFileSync(path, 'utf-8')) as WinProbModel;
  if (path === MODEL_PATH) cached = model;
  return model;
}
