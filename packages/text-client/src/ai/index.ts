/**
 * @module ai
 *
 * AI strategy loader. Currently the project ships a single strategy —
 * the heuristic ("Smart") AI defined in `./heuristic.ts`. Additional
 * strategies can be added by registering them in the STRATEGIES map.
 */

import type { AiStrategy } from './strategy.js';
import { heuristicStrategy } from './heuristic.js';

const STRATEGIES: Record<string, AiStrategy> = {
  heuristic: heuristicStrategy,
};

/**
 * Loads an AI strategy by name. Returns null if the name is not recognized.
 * Available strategies: heuristic
 */
export function loadAiStrategy(name: string): AiStrategy | null {
  return STRATEGIES[name] ?? null;
}

export type { AiStrategy, AiContext, WeightedAction } from './strategy.js';
export { sampleWeighted } from './strategy.js';
