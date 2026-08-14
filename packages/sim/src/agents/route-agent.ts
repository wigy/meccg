/**
 * @module agents/route-agent
 *
 * Routes decisions between two agents by the action types on offer.
 *
 * A cloned policy is not uniformly weak: measured on the human corpus, the
 * deployed weights put 99.7% of their probability on the human's actual
 * `draw-cards` move and 3.3% on their actual `plan-movement` — barely above
 * the ~5% uniform guess over the mean 20 plans offered. Competence tracks
 * branching factor, because a one-hot demonstration splits its teaching
 * signal across every candidate it did not name. The action mix is calibrated
 * (it moves as often as a human) while the destinations are near-random,
 * which is close to the worst case in a game where movement decides what can
 * be scored.
 *
 * So this hands exactly those decisions to an agent that has explicit rules
 * for them and keeps the cloned policy everywhere else, rather than waiting
 * for a corpus large enough to learn a 20-to-286-way choice.
 *
 * A decision routes to the secondary when *any* viable candidate carries a
 * routed type — the secondary then answers the whole decision, including the
 * option to pass on it. Routing on the offer rather than on some guess at the
 * decision's "kind" keeps the rule checkable against the engine's own list.
 */

import type { Agent, AgentContext, AgentDecision } from '../types.js';

/**
 * Wraps two agents, routing by action type.
 *
 * @param types Action types whose presence sends a decision to `secondary`.
 * @param primary Answers every other decision.
 * @param secondary Answers decisions offering a routed type.
 */
export function createRouteAgent(
  types: ReadonlySet<string>,
  primary: Agent,
  secondary: Agent,
  name?: string,
): Agent {
  return {
    name: name ?? `route(${[...types].join('+')}: ${secondary.name} else ${primary.name})`,
    startGame(): void {
      primary.startGame?.();
      secondary.startGame?.();
    },
    chooseAction(context: AgentContext): AgentDecision {
      const routed = context.view.legalActions.some(
        evaluated => evaluated.viable && types.has(evaluated.action.type),
      );
      return routed ? secondary.chooseAction(context) : primary.chooseAction(context);
    },
  };
}
