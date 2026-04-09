/**
 * @module ai
 *
 * AI strategy loader. Maps strategy names (from --ai flag) to their
 * implementations. To add a new strategy:
 * 1. Create a new file in this directory implementing AiStrategy
 * 2. Register it in the STRATEGIES map below
 */

import type { AiStrategy } from './strategy.js';
import { randomStrategy } from './random.js';
import { heuristicStrategy } from './heuristic.js';

const STRATEGIES: Record<string, AiStrategy> = {
  random: randomStrategy,
  heuristic: heuristicStrategy,
};

/**
 * Loads an AI strategy by name. Returns null if the name is not recognized.
 * Available strategies: random, heuristic
 */
export function loadAiStrategy(name: string): AiStrategy | null {
  return STRATEGIES[name] ?? null;
}

export type { AiStrategy, AiContext, WeightedAction } from './strategy.js';
export { sampleWeighted } from './strategy.js';
