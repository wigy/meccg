/**
 * @module agents/random-agent
 *
 * Uniform-random baseline agent. Picks any viable action with equal
 * probability from its seeded stream. Serves as the throughput benchmark
 * driver and the weakest rung of the evaluation ladder.
 */

import type { Agent, AgentContext, AgentDecision } from '../types.js';

/** Creates the uniform-random agent. */
export function createRandomAgent(): Agent {
  return {
    name: 'random',
    chooseAction(context: AgentContext): AgentDecision {
      const actions = context.legalActions;
      const index = Math.floor(context.random() * actions.length);
      return {
        action: actions[index],
        considered: actions.map(action => ({ action, weight: 1 })),
      };
    },
  };
}
