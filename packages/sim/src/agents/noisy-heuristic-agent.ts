/**
 * @module agents/noisy-heuristic-agent
 *
 * Deliberately weakened heuristic agent: with probability ε it ignores the
 * heuristic and picks a uniformly random legal action instead. Exists to
 * calibrate the Elo ladder with a rung between random and heuristic, and
 * to prove the regression gate blocks a weaker agent.
 */

import type { Agent, AgentContext, AgentDecision } from '../types.js';
import { createHeuristicAgent } from './heuristic-agent.js';

/** Creates a heuristic agent that blunders uniformly with probability `epsilon`. */
export function createNoisyHeuristicAgent(epsilon = 0.5): Agent {
  if (!(epsilon >= 0 && epsilon <= 1)) {
    throw new Error(`noisy-heuristic epsilon must be in [0, 1], got ${epsilon}`);
  }
  const inner = createHeuristicAgent();
  return {
    name: `noisy-heuristic:${epsilon}`,
    chooseAction(context: AgentContext): AgentDecision {
      if (context.random() < epsilon) {
        const index = Math.floor(context.random() * context.legalActions.length);
        return { action: context.legalActions[index], note: `blunder (ε=${epsilon})` };
      }
      return inner.chooseAction(context);
    },
  };
}
