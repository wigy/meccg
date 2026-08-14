/**
 * @module agents/from-weights
 *
 * Builds the agent a weights file asks for, rather than assuming every file
 * wants the plain behavioral-cloning policy.
 *
 * The lobby's Real-AI seat names a bare file from `~/.meccg/models` and has
 * no way to express anything else — no temperature, no composition. That is
 * the right shape for an operator (drop a file in, pick it in the UI) and the
 * wrong shape for a policy whose strength depends on how it is read and on
 * which decisions it should not be answering at all. So the file carries
 * both: `decode` (see {@link BcWeightsFile.decode}) and `route`.
 *
 * `route` names the action types this policy should hand to another agent.
 * Measured on the human corpus, a cloned policy's competence tracks branching
 * factor — 99.7% of its probability on the human's actual `draw-cards` move,
 * 3.3% on their actual `plan-movement` — and delegating just those two types
 * to the heuristic was worth ~106 Elo, from -83 to +23 against it. Expressing
 * that in the file means the hybrid is a model you can upload, not a lobby
 * feature that needs a button.
 *
 * The delegate is looked up in a small local table rather than through the
 * CLI's `resolveAgent`, which would be a circular import and would also let a
 * weights file name an arbitrarily expensive agent (an `mc` spec in a model
 * file would silently put a multi-second search in every lobby game).
 */

import { createBcAgent } from './bc-agent.js';
import { loadBcWeights } from './bc-agent.js';
import { createHeuristicAgent } from './heuristic-agent.js';
import { createRouteAgent } from './route-agent.js';
import type { Agent } from '../types.js';

/** Agents a weights file may delegate decisions to, by name. */
const DELEGATES: Readonly<Record<string, () => Agent>> = {
  heuristic: createHeuristicAgent,
};

/**
 * The agent a weights file describes: the cloned policy, optionally wrapped
 * so that the action types it names are answered by another agent.
 */
export function createAgentFromWeights(weightsPath: string): Agent {
  const model = loadBcWeights(weightsPath);
  const policy = createBcAgent(weightsPath);
  const route = model.route;
  if (route === undefined) return policy;

  const delegate = DELEGATES[route.to];
  if (delegate === undefined) {
    throw new Error(
      `${weightsPath}: route.to "${route.to}" is not a known delegate — expected one of ${Object.keys(DELEGATES).join(', ')}`);
  }
  if (!Array.isArray(route.types) || route.types.length === 0) {
    throw new Error(`${weightsPath}: route.types must be a non-empty list of action types`);
  }
  return createRouteAgent(new Set(route.types), policy, delegate(), `${policy.name}+${route.to}`);
}
