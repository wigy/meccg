/**
 * @module agents/search-agent
 *
 * Determinizing-PUCT search agent (P5): wraps {@link searchBestAction}
 * behind the standard agent seam. At quiet, contested decision points it
 * samples K hidden worlds and searches with the net as prior/evaluator;
 * everywhere else (forced decisions, chain/combat/pending windows, or a
 * search that returns nothing) it falls back to the policy argmax — so
 * the agent is never weaker than the bare net. Weights files are loaded
 * with the same runtime-parity self-test as the bc agent, and world seeds
 * derive from the agent's seeded stream, keeping games reproducible.
 */

import type { CardDefinition } from '@meccg/shared';
import type { Agent, AgentContext, AgentDecision } from '../types.js';
import { loadBcWeights, runBcSelfTest, bcForward } from './bc-agent.js';
import { buildCardVocab, featurizeState, featurizeActions } from '../features/index.js';
import type { CardVocab } from '../features/index.js';
import { searchBestAction } from '../search/puct.js';
import type { LoadedDeck } from '../decks.js';

/** Options for {@link createSearchAgent}. */
export interface SearchAgentOptions {
  /** Decks by seat (the searcher picks its own by `view.selfIndex`). */
  readonly decks: readonly [LoadedDeck, LoadedDeck];
  /** Total simulations per searched decision (default 192). */
  readonly sims?: number;
  /** Root determinizations per decision (default 4). */
  readonly worlds?: number;
}

/** Creates the search agent from a weights file. */
export function createSearchAgent(weightsPath: string, options: SearchAgentOptions): Agent {
  const model = loadBcWeights(weightsPath);
  const selfTestError = runBcSelfTest(model);
  if (selfTestError > 2e-4) {
    throw new Error(`search agent weights self-test failed: deviation ${selfTestError}`);
  }
  let vocab: CardVocab | null = null;
  let cachedPool: Readonly<Record<string, CardDefinition>> | null = null;

  return {
    name: `search@${options.sims ?? 192}`,
    chooseAction(context: AgentContext): AgentDecision {
      if (vocab === null || cachedPool !== context.cardPool) {
        vocab = buildCardVocab(context.cardPool);
        cachedPool = context.cardPool;
        if (vocab.hash !== model.vocabHash) {
          throw new Error(`card vocabulary mismatch: weights ${model.vocabHash}, pool ${vocab.hash}`);
        }
      }

      const result = context.legalActions.length > 1
        ? searchBestAction(context.view, {
          model,
          vocab,
          cardPool: context.cardPool,
          decks: options.decks,
          sims: options.sims,
          worlds: options.worlds,
          seed: Math.floor(context.random() * 0x7fffffff),
        })
        : null;
      if (result) {
        const viable = context.view.legalActions.filter(e => e.viable);
        return {
          action: result.action,
          considered: viable.map((evaluated, i) => ({ action: evaluated.action, weight: result.visits[i] + 1e-6 })),
          note: `puct visits ${result.visits.join('/')}`,
        };
      }

      // Fallback: policy argmax (identical to the bc agent's play mode).
      const state = featurizeState(context.view, context.cardPool, vocab);
      const actions = featurizeActions(context.view, context.cardPool, vocab);
      const output = bcForward(model, state, actions);
      let bestIndex = -1;
      output.probs.forEach((prob, i) => {
        if (context.view.legalActions[i].viable && (bestIndex === -1 || prob > output.probs[bestIndex])) {
          bestIndex = i;
        }
      });
      if (bestIndex === -1) {
        return { action: context.legalActions[0], note: 'search: fallback took first legal action' };
      }
      return { action: context.view.legalActions[bestIndex].action, note: 'policy fallback' };
    },
  };
}
