/**
 * @module agents/heuristic-agent
 *
 * Wraps the heuristic ("Smart") AI strategy behind the simulation agent
 * seam. The strategy assigns a weight to every legal action; the agent
 * samples from that distribution using its seeded stream, so heuristic
 * self-play games are reproducible. The full weighted candidate list is
 * surfaced on the decision for transcripts and training data.
 */

import type { Agent, AgentContext, AgentDecision } from '../types.js';
import type { AiContext } from '../ai/index.js';
import { heuristicStrategy } from '../ai/heuristic.js';
import { sampleWeighted } from '../ai/strategy.js';

/** Creates the heuristic-strategy agent. */
export function createHeuristicAgent(): Agent {
  return {
    name: 'heuristic',
    chooseAction(context: AgentContext): AgentDecision {
      const aiContext: AiContext = {
        view: context.view,
        cardPool: context.cardPool,
        legalActions: context.legalActions,
        random: context.random,
      };
      const weighted = heuristicStrategy.weighActions(aiContext);
      if (weighted.length === 0) {
        return { action: context.legalActions[0], note: 'no weighted actions — took first legal action' };
      }
      const action = sampleWeighted(weighted, context.random);
      return { action, considered: weighted };
    },
  };
}
