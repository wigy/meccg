/**
 * @module ai/strategy
 *
 * Interface for AI strategies. Each strategy computes a probability
 * distribution over legal actions, then the runner samples from it.
 * The probabilities are displayed to the user before the AI acts.
 */

import type { GameAction } from '../types/actions.js';
import type { PlayerView } from '../types/player-view.js';
import type { CardDefinition } from '../types/cards.js';

/** The context provided to the AI for decision making. */
export interface AiContext {
  /** The current game view from this player's perspective. */
  readonly view: PlayerView;
  /** The card pool for resolving card definitions. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** All legal actions available this turn. */
  readonly legalActions: readonly GameAction[];
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
 */
export function sampleWeighted(weighted: WeightedAction[]): GameAction {
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) {
    // Fallback: uniform random if all weights are zero
    return weighted[Math.floor(Math.random() * weighted.length)].action;
  }

  let r = Math.random() * totalWeight;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.action;
  }
  return weighted[weighted.length - 1].action;
}
