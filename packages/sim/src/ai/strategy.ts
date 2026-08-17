/**
 * @module ai/strategy
 *
 * Interface for AI strategies. Each strategy computes a probability
 * distribution over legal actions, then the runner samples from it.
 * The probabilities are displayed to the user before the AI acts.
 */

import type { GameAction, PlayerView, CardDefinition } from '@meccg/shared';

/** The context provided to the AI for decision making. */
export interface AiContext {
  /** The current game view from this player's perspective. */
  readonly view: PlayerView;
  /** The card pool for resolving card definitions. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** All legal actions available this turn. */
  readonly legalActions: readonly GameAction[];
  /**
   * Source of randomness for probabilistic evaluators, returning values in
   * [0, 1). Defaults to `Math.random` when absent; the simulation harness
   * injects a seeded stream here so self-play games are bit-reproducible.
   */
  readonly random?: () => number;
}

/** An action with its assigned probability weight. */
export interface WeightedAction {
  /** The action. */
  readonly action: GameAction;
  /** Probability weight (0 = never, higher = more likely). Need not sum to 1. */
  readonly weight: number;
}

/** An AI strategy assigns probability weights to each legal action. */
export interface AiStrategy {
  /** Human-readable name of this strategy. */
  readonly name: string;
  /**
   * Compute probability weights for each legal action.
   * Weights need not sum to 1 — they are normalized by the runner.
   * A weight of 0 means the action will never be chosen.
   */
  weighActions(context: AiContext): WeightedAction[];
}

/**
 * Sample one action from the weighted distribution.
 * Normalizes weights and picks using a uniform random value.
 *
 * @param random - Source of uniform values in [0, 1). Pass a seeded stream
 *   for reproducible sampling; defaults to `Math.random`.
 */
export function sampleWeighted(weighted: WeightedAction[], random: () => number = Math.random): GameAction {
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) {
    // Fallback: uniform random if all weights are zero
    return weighted[Math.floor(random() * weighted.length)].action;
  }

  let r = random() * totalWeight;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.action;
  }
  return weighted[weighted.length - 1].action;
}

/**
 * Relative tolerance for "the same weight". Evaluators reach the same score by
 * different arithmetic paths, so exact equality would break a tie that only
 * floating-point rounding created and hand the decision to whichever candidate
 * the legal-action list happened to list first.
 */
const TIE_TOLERANCE = 1e-9;

/**
 * Pick the highest-weighted action, breaking ties uniformly at random.
 *
 * The greedy counterpart to {@link sampleWeighted}: it takes the strategy's
 * opinion at face value instead of treating the weights as a distribution. A
 * weight is a preference ordering, not a probability — a candidate scored twice
 * as good is not one the strategy wants played two-thirds of the time — so the
 * only randomness left is between candidates the strategy could not separate.
 *
 * @param random - Source of uniform values in [0, 1), used only for tie-breaks.
 */
export function pickBest(weighted: WeightedAction[], random: () => number = Math.random): GameAction {
  let best = -Infinity;
  for (const w of weighted) if (w.weight > best) best = w.weight;
  const threshold = best - Math.abs(best) * TIE_TOLERANCE;
  const top = weighted.filter(w => w.weight >= threshold);
  return top[Math.floor(random() * top.length)].action;
}
