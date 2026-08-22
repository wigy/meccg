/**
 * @module agents/heuristic-agent
 *
 * Wraps the heuristic ("Smart") AI strategy behind the simulation agent
 * seam. The strategy assigns a weight to every legal action; the agent plays
 * the highest-weighted one, breaking ties uniformly at random from its seeded
 * stream so heuristic self-play games stay reproducible. The full weighted
 * candidate list is surfaced on the decision for transcripts and training
 * data.
 *
 * It used to *sample* from those weights, which cost it roughly 47 Elo. The
 * weights were written as a preference ordering and read as a distribution,
 * so a move the strategy scored half as good got played a third of the time —
 * measured over 3997 games it sampled outside its own top-weighted set on
 * 26.4% of contested decisions. Ten paired gates, 400 games each, all ten
 * favoured the argmax: +47 Elo [+37, +58], seed-wise range +14…+86.
 *
 * `sample: true` restores the old behaviour, and `heuristic:sample` reaches it
 * from a CLI. It is not a weaker rung for its own sake — off-policy coverage
 * is the point when the games are being exported as training data rather than
 * played to win, which is why the exporters still ask for it by name.
 */

import type { Agent, AgentContext, AgentDecision } from '../types.js';
import type { AiContext } from '../ai/index.js';
import { heuristicStrategy } from '../ai/heuristic.js';
import { sampleWeighted, pickBest } from '../ai/strategy.js';
import { createCycleGuard } from '../cycle-guard.js';
import { viewSignature } from '../state-signature.js';

/** Knobs for {@link createHeuristicAgent}. */
export interface HeuristicAgentOptions {
  /**
   * Sample from the weights instead of playing the highest-weighted action.
   * Defaults to `false` — weights are a preference ordering, not a policy.
   */
  readonly sample?: boolean;
}

/** Creates the heuristic-strategy agent. */
export function createHeuristicAgent(options: HeuristicAgentOptions = {}): Agent {
  const sample = options.sample === true;
  // A deterministic argmax over static weights walks legal no-op loops
  // forever: with the Demon fána swap (Great Shadow ba-62's free
  // return-self-to-hand scored 8 vs pass 5, replaying it scored 30) heuristic
  // self-play burned the full 25,000-decision budget inside one organization
  // phase — 0 of 10 Balrog/FW-deck games completed. The same guard the h2
  // agent carries narrows candidates only after a position has been revisited
  // 8 times, so healthy-game behaviour is bit-identical (see `cycle-guard`).
  const cycleGuard = createCycleGuard();
  return {
    name: sample ? 'heuristic:sample' : 'heuristic',
    startGame(): void {
      // Signatures are coarse on purpose — one game's history must never
      // narrow another's candidates.
      cycleGuard.reset();
    },
    chooseAction(context: AgentContext): AgentDecision {
      const signature = viewSignature(context.view);
      const legalActions = cycleGuard.allow(signature, context.legalActions);
      const aiContext: AiContext = {
        view: context.view,
        cardPool: context.cardPool,
        legalActions,
        random: context.random,
      };
      const weighted = heuristicStrategy.weighActions(aiContext);
      if (weighted.length === 0) {
        cycleGuard.taken(signature, legalActions[0]);
        return { action: legalActions[0], note: 'no weighted actions — took first legal action' };
      }
      const action = sample ? sampleWeighted(weighted, context.random) : pickBest(weighted, context.random);
      cycleGuard.taken(signature, action);
      return { action, considered: weighted };
    },
  };
}
