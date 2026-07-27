/**
 * @module agents/mc-agent
 *
 * Flat Monte-Carlo agent: no tree, no network, no deck lists.
 *
 * For each decision it widens its own view into a playable state with
 * `search/determinize-null` (hidden cards stay hidden and may only be
 * placed face-down on-guard), plays every candidate action forward through
 * the real engine under a random policy for a few turns, and keeps the
 * candidate whose playouts end with the best average tournament-score
 * differential.
 *
 * Two choices depart from the textbook rollout algorithm, both to spend a
 * small budget better rather than to change what is being estimated:
 *
 * - **Round-robin allocation.** Sampling the first action at random would
 *   spread an already tight budget unevenly across candidates; cycling
 *   through them gives every candidate the same sample count, which is
 *   what a per-candidate average wants.
 * - **Common random numbers.** Round *r* uses one determinized world and
 *   one playout seed for *every* candidate, so candidates are compared on
 *   matched futures. The between-candidate noise that paired sampling
 *   removes is far larger than the differences being measured, so this is
 *   worth more than doubling the rollout count.
 *
 * Views the null determinizer does not support — mid-chain, in combat, or
 * with pending effects — are delegated to a fallback agent, as
 * `search/determinize` documents for the same reason. Since combat and
 * chain responses are a large share of all decisions, the fallback choice
 * materially shapes how this agent plays.
 */

import { reduce } from '@meccg/shared';
import type { GameAction, PlayerId } from '@meccg/shared';
import type { Agent, AgentContext, AgentDecision, ConsideredAction } from '../types.js';
import { determinizeNull } from '../search/determinize-null.js';
import { isDeterminizableView } from '../search/determinize.js';
import { rollout } from '../search/rollout.js';
import { createRandomStream } from '../random-stream.js';
import { createHeuristicAgent } from './heuristic-agent.js';

/** Tuning for {@link createMcAgent}. */
export interface McAgentOptions {
  /** Playouts per candidate action (default 8). */
  readonly rollouts?: number;
  /**
   * Most candidates to search at one decision (default 8); the rest are
   * dropped after ranking. This is the cost control that makes the agent
   * usable at all — work is `candidates × rollouts × playout length`, and
   * the branching factor here reaches 640, so an uncapped decision can cost
   * a minute on its own. Candidates are ranked by the fallback agent's
   * weights, and its own pick is always kept, so the cap narrows the search
   * to the moves a competent policy already likes rather than to an
   * arbitrary prefix.
   */
  readonly maxCandidates?: number;
  /** Game turns simulated per playout (default 2). */
  readonly horizonTurns?: number;
  /**
   * Decision cap inside one playout (default 120 per horizon turn). A
   * backstop against a line that never reaches the turn boundary.
   */
  readonly maxDecisions?: number;
  /**
   * Optional wall-clock budget per decision, in milliseconds. Rounds stop
   * once it is exceeded, so a decision cannot stall an interactive game.
   * **Leaving this unset keeps the agent reproducible**; with it set, the
   * same seed can pick different actions on a differently loaded machine.
   */
  readonly timeMs?: number;
  /** Agent used where the determinizer does not apply (default heuristic). */
  readonly fallback?: Agent;
  /** Hidden-site policy passed through to the determinizer (default sample). */
  readonly unknownSites?: 'sample' | 'inert';
  /** Name reported in replays and statistics. */
  readonly name?: string;
}

/** Per-candidate playout statistics. */
interface Tally {
  sum: number;
  count: number;
}

/**
 * Narrows the candidate list to at most `limit` actions, ranked by the
 * fallback agent's own weights.
 *
 * Searching every candidate is what makes an uncapped decision unaffordable,
 * but truncating an arbitrary prefix would throw away good moves for no
 * reason. Asking the fallback to weigh them first turns the cap into a
 * prior: the search refines a competent policy's shortlist instead of
 * replacing it. The fallback's own pick is always included, so the agent can
 * never do worse than "the fallback's move was not even considered".
 */
function shortlist(
  context: AgentContext,
  fallback: Agent,
  limit: number,
): readonly GameAction[] {
  const actions = context.legalActions;
  if (actions.length <= limit) return actions;

  const decision = fallback.chooseAction(context);
  const weights = new Map<GameAction, number>();
  for (const candidate of decision.considered ?? []) weights.set(candidate.action, candidate.weight);

  const ranked = [...actions].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0));
  const kept = ranked.slice(0, limit);
  if (!kept.includes(decision.action)) kept[kept.length - 1] = decision.action;
  return kept;
}

/** Mean playout value, or `-Infinity` for a candidate with no valid playout. */
function meanOf(tally: Tally): number {
  return tally.count === 0 ? -Infinity : tally.sum / tally.count;
}

/**
 * Builds the transcript's candidate list. Weights are shifted to be
 * non-negative so downstream consumers that treat them as sampling weights
 * stay well-defined; the ordering, which is what the decision rests on, is
 * unchanged.
 */
function buildConsidered(actions: readonly GameAction[], tallies: readonly Tally[]): ConsideredAction[] {
  const means = tallies.map(meanOf);
  const finite = means.filter(value => Number.isFinite(value));
  const floor = finite.length > 0 ? Math.min(...finite) : 0;
  return actions.map((action, i) => ({
    action,
    weight: Number.isFinite(means[i]) ? means[i] - floor + 0.001 : 0,
  }));
}

/**
 * Creates the flat Monte-Carlo agent. Needs no deck lists and no trained
 * weights, so it runs against any opponent in any deck.
 */
export function createMcAgent(options: McAgentOptions = {}): Agent {
  const rounds = Math.max(1, options.rollouts ?? 8);
  const maxCandidates = Math.max(2, options.maxCandidates ?? 8);
  const horizonTurns = Math.max(1, options.horizonTurns ?? 2);
  const maxDecisions = Math.max(1, options.maxDecisions ?? horizonTurns * 120);
  const fallback = options.fallback ?? createHeuristicAgent();
  const timeMs = options.timeMs;

  return {
    name: options.name ?? `mc:${rounds}@${horizonTurns}t`,

    chooseAction(context: AgentContext): AgentDecision {
      if (context.legalActions.length === 1) return { action: context.legalActions[0], note: 'forced' };
      if (!isDeterminizableView(context.view)) return fallback.chooseAction(context);

      const actions = shortlist(context, fallback, maxCandidates);
      const view = context.view;
      const searcher: PlayerId = view.self.id;
      const playerIds: [PlayerId, PlayerId] = view.selfIndex === 0
        ? [searcher, view.opponent.id]
        : [view.opponent.id, searcher];
      const cardPool = context.cardPool;

      // One base seed per decision, drawn from the agent's own stream so a
      // whole game stays reproducible from (seed, decks, agents).
      const baseSeed = Math.floor(context.random() * 0x7fffffff);
      const tallies: Tally[] = actions.map(() => ({ sum: 0, count: 0 }));
      const startedAt = timeMs === undefined ? 0 : Date.now();
      let played = 0;

      for (let round = 0; round < rounds; round++) {
        if (timeMs !== undefined && round > 0 && Date.now() - startedAt >= timeMs) break;

        // Common random numbers: one world and one playout seed shared by
        // every candidate this round.
        const roundSeed = (baseSeed + round * 0x9e3779b9) | 0;
        const world = determinizeNull({
          view,
          seed: roundSeed,
          cardPool,
          unknownSites: options.unknownSites,
        });

        for (let i = 0; i < actions.length; i++) {
          // A hypothetical world can differ from the true one in ways that
          // make a legal action inapplicable; that candidate loses this
          // round's sample rather than the whole decision.
          const applied = reduce(world.state, actions[i]);
          if (applied.error) continue;
          const result = rollout(applied.state, {
            playerIds,
            searcher,
            unknownInstances: world.unknownInstances,
            horizonTurns,
            maxDecisions,
            random: createRandomStream(roundSeed ^ 0x2545f491),
          });
          tallies[i].sum += result.tsd;
          tallies[i].count += 1;
          played++;
        }
      }

      // No candidate applied in any sampled world — defer rather than guess.
      if (played === 0) return fallback.chooseAction(context);

      let best = 0;
      let bestMean = -Infinity;
      for (let i = 0; i < actions.length; i++) {
        const value = meanOf(tallies[i]);
        if (value > bestMean) {
          bestMean = value;
          best = i;
        }
      }

      return {
        action: actions[best],
        considered: buildConsidered(actions, tallies),
        // The reported weights are TSD *above the worst candidate* (see
        // buildConsidered), not absolute TSD — say so, or a watcher reads
        // the ranking as a score differential it is not.
        note: `mc ${played} playouts over ${actions.length}/${context.legalActions.length} candidates, `
          + `${horizonTurns}t horizon, best mean TSD ${bestMean.toFixed(2)} (w = TSD above worst)`,
      };
    },
  };
}
