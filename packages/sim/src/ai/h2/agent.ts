/**
 * @module ai/h2/agent
 *
 * The Heuristics-2 agent: builds the module context for a decision, lets the
 * registry pick an owning module, and converts the resulting utilities into
 * the weighted distribution the rest of the harness already speaks.
 *
 * Two seams are preserved deliberately. First, H2 returns *utilities* and the
 * agent converts them into a softmax distribution, because the
 * behavioural-cloning pipeline consumes that distribution as soft targets.
 * Second, decisions H2 cannot speak to are delegated to Heuristics 1
 * unchanged.
 *
 * It *reports* that distribution and *plays* the argmax. Those are different
 * questions and were once answered by the same number, which meant the agent
 * spent every decision sampling a move its own model rated worse. At
 * `softmaxTemperature` 0.02 against utilities that are win-probability deltas
 * of a few thousandths, that is not a rounding error: a candidate 0.5% worse
 * in win probability came out at weight 0.44 against the best one's 0.56, so
 * "draw a card" versus "pass" was close to a coin flip in a position where the
 * agent knew which it preferred. `compare` had already written the principle
 * down — the sampling temperature belongs to the harness, not to the opinion,
 * which is why it polls both agents at their argmax. This makes the agent obey
 * it too.
 *
 * Sampled play is still available (`Heuristic2Options.sample`, or an explicit
 * `@T` on the CLI spec) because exploration is what generates diverse
 * self-play data. It is a data-collection mode, not how the agent plays when
 * it is trying to win.
 *
 * The interesting case is a decision H2 can speak to only *partly*. Measured
 * over four self-play games, a dozen action types still have no owner, so
 * demanding complete coverage means nothing outside combat ever runs. But
 * ranking a covered candidate against an uncovered one is impossible: the two
 * numbers are a win-probability delta and a unitless H1 weight.
 *
 * Falling back is a cost, not a safety net. Heuristics 1 is the weight soup
 * this design exists to replace, so every decision handed to it is one played
 * by the worse of the two agents — the fallback is there because a wrong
 * ranking is worse still, not because H1 is an acceptable answer.
 *
 * Which is why the fallback is a *parameter* (`Heuristic2Options.fallback`)
 * and not a hard-wired call. H1 is the default because it is free, but it is
 * not the strongest agent in the package: the flat Monte-Carlo rollout agent
 * is, by a wide margin. Handing the decisions H2 cannot price to `mc` instead
 * costs a rollout budget on the one-in-seven contested decisions that reach
 * the fallback, and nothing at all on the rest — and the two agents' blind
 * spots are close to complementary, since `mc` cannot determinize a view in
 * combat or mid-chain, which is exactly where H2's modules are strongest.
 *
 * The way out is that a utility is a change in win probability *relative to
 * doing nothing*. So "this action improves the position by 2%" is a claim
 * that stands on its own, without reference to the candidates H2 could not
 * score. On partial coverage the agent therefore acts only when the best
 * covered utility clears `partialCoverageMargin` — a claim strong enough to
 * be worth making blind — and otherwise hands the whole decision to
 * Heuristics 1. The two scales are never compared.
 *
 * What that concedes is real and bounded: an unowned candidate might have
 * been better still, and H2 will sometimes take a good action instead of the
 * best one. The margin is what buys that risk down.
 *
 * The opposite case is guarded separately, and by a much smaller number. A
 * decision H2 covers completely but scores flat — every candidate identical —
 * is a tie, not an opinion, and acting on it would choose uniformly at random
 * where Heuristics 1 would at least have a preference. So a flat ranking hands
 * the decision over too. But *flat* means tied, not "below the margin": with
 * nothing unscored there is nothing to be blind to, so any strict preference is
 * actionable however small. Requiring the margin there cost real decisions —
 * drawing a card is worth about +0.3% against passing at 0, a correct and
 * confident preference that went to Heuristics 1 every turn of every game.
 */

import type { Agent, AgentContext, AgentDecision, ConsideredAction } from '../../types.js';
import { createHeuristicAgent } from '../../agents/heuristic-agent.js';
import { forwardActions } from '../regress.js';
import { sampleWeighted } from '../strategy.js';
import type { H2Module, ModuleContext } from './core/types.js';
import type { Tunables } from './core/tunables.js';
import { DEFAULT_TUNABLES } from './core/tunables.js';
import type { WinProbModel } from './core/winprob.js';
import { loadWinProbModel } from './core/winprob.js';
import { ALL_MODULES, evaluateDecision, resolveModules } from './core/registry.js';
import { computeStanding } from './services/standing.js';

/** Construction options for {@link createHeuristic2Agent}. */
export interface Heuristic2Options {
  /** Module selector: `undefined`/`'all'` for everything, or `'combat,kill'`. */
  readonly modules?: string;
  /** Softmax temperature override; defaults to `tunables.softmaxTemperature`. */
  readonly temperature?: number;
  /** Forces the risk posture instead of deriving it from `W`. */
  readonly riskOverride?: number;
  /** Constants override, for sweeps. */
  readonly tunables?: Tunables;
  /** Win-probability model override; loaded from the shipped fit by default. */
  readonly model?: WinProbModel;
  /** Module set override, for tests that register a stub module. */
  readonly available?: readonly H2Module[];
  /**
   * Sample the reported distribution instead of playing its argmax.
   *
   * Off by default: sampling a move the agent's own model ranks below another
   * is a self-inflicted error, and the distribution is reported either way, so
   * nothing downstream needs it. Turn it on to generate exploratory self-play
   * data, where the point is coverage of positions rather than winning.
   */
  readonly sample?: boolean;
  /**
   * Agent asked for the decisions H2 cannot speak to — an unowned candidate
   * it dare not rank blind, or a covered ranking that came out flat.
   *
   * Defaults to Heuristics 1, which is free and always applicable. Anything
   * stronger is a straight upgrade on those decisions and costs nothing on
   * the others, because the fallback is only ever consulted after the module
   * tree has declined; see the module docstring.
   */
  readonly fallback?: Agent;
}

/**
 * Below this spread, a complete ranking is a tie rather than an opinion.
 *
 * Deliberately far smaller than `partialCoverageMargin`, which answers a
 * different question — how sure H2 must be before acting *blind* to candidates
 * it could not score. With nothing unscored there is nothing to be blind to, so
 * the only reason left to hand a decision over is that the module genuinely
 * cannot separate the candidates.
 */
const TIE_EPSILON = 1e-9;

/**
 * Softmax over utilities. Utilities are win-probability deltas — small numbers
 * in absolute terms — so the temperature is correspondingly small; shifting by
 * the maximum first keeps `exp` in range.
 */
function softmax(utilities: readonly number[], temperature: number): number[] {
  const max = Math.max(...utilities);
  const weights = utilities.map(u => Math.exp((u - max) / temperature));
  const total = weights.reduce((sum, w) => sum + w, 0);
  return total > 0 ? weights.map(w => w / total) : utilities.map(() => 1 / utilities.length);
}

/**
 * Create the Heuristics-2 agent.
 *
 * The win-probability model is resolved once at construction: an agent without
 * `W` has no utility scale, and discovering that mid-game would abort a whole
 * self-play batch rather than the run that misconfigured it.
 */
export function createHeuristic2Agent(options: Heuristic2Options = {}): Agent {
  const tunables = options.tunables ?? DEFAULT_TUNABLES;
  const modules = resolveModules(options.modules, options.available ?? ALL_MODULES);
  const model = options.model ?? loadWinProbModel();
  const temperature = options.temperature ?? tunables.softmaxTemperature;
  const fallback = options.fallback ?? createHeuristicAgent();
  const base = options.modules && options.modules !== 'all' ? `h2:${options.modules}` : 'h2';
  // Sampled play and the fallback are each a different agent from plain argmax
  // play — a run that reports `h2` for differently-configured agents cannot be
  // read afterwards.
  const sampled = options.sample ? `${base}@${temperature}` : base;
  const label = options.fallback ? `${sampled}+${fallback.name}` : sampled;

  return {
    name: label,

    chooseAction(context: AgentContext): AgentDecision {
      if (context.legalActions.length === 0) {
        throw new Error('h2 agent asked to choose with no legal actions');
      }
      // The engine marks candidates that undo this phase's own progress, and
      // that is a fact rather than a preference — see `ai/regress`. Filtering
      // here rather than inside a module keeps every module's coverage honest:
      // an action H2 never sees cannot be one it declined to score.
      const legalActions = forwardActions(context.legalActions);
      const moduleContext: ModuleContext = {
        view: context.view,
        cardPool: context.cardPool,
        legalActions,
        tunables,
        standing: computeStanding(context.view, model, tunables, options.riskOverride),
      };
      const { modules: contributors, evaluations, complete } = evaluateDecision(modules, moduleContext);
      const best = evaluations[0];
      const worst = evaluations[evaluations.length - 1];
      // A ranking whose candidates all score the same is not an opinion, it is
      // a tie — and acting on it means choosing uniformly at random where
      // Heuristics 1 would at least have a preference. Complete coverage is
      // not enough on its own; there has to be something to discriminate.
      // On a *complete* view the margin has no work to do. It exists because an
      // unscored candidate might have been better, and there are none here — so
      // any strict preference is actionable, however small. What still hands
      // over is a genuine tie, which is what "flat" was always meant to mean:
      // acting on identical scores samples uniformly where Heuristics 1 would
      // at least have a preference.
      //
      // Requiring the *margin* instead cost real decisions. Drawing a card is
      // worth `resourceDrawValue`, which comes out around +0.3% against passing
      // at 0 — a correct and confident preference that fell below the 0.5%
      // margin and went to H1 every turn of every game.
      const discriminates = evaluations.length > 0
        && best.utility - worst.utility > TIE_EPSILON;
      const speaks = evaluations.length > 0
        && (complete ? discriminates || best.utility > TIE_EPSILON
          : best.utility > tunables.partialCoverageMargin);

      if (!speaks) {
        // No H2 owner: the fallback handles the decision in its own units.
        // It sees the *forward* candidate list rather than the raw one, so a
        // fallback cannot pick a move H2 had already ruled out as an undo.
        const decision = fallback.chooseAction({ ...context, legalActions });
        return { ...decision, note: `${fallback.name} fallback${decision.note ? `: ${decision.note}` : ''}` };
      }

      // On a partial view the candidate list is not the whole decision, so it
      // is not a distribution the behavioural-cloning pipeline should learn
      // from as though it were. Take the best action and report no weights.
      if (!complete) {
        return {
          action: best.action,
          note: `${contributors.join('+')} (partial coverage): ΔP(win) ${(best.utility * 100).toFixed(2)}% `
            + `clears the ${(tunables.partialCoverageMargin * 100).toFixed(1)}% margin; `
            + `${legalActions.length - evaluations.length} candidate(s) unscored`,
        };
      }

      const probabilities = softmax(evaluations.map(e => e.utility), temperature);
      const considered: ConsideredAction[] = evaluations.map((e, i) => ({
        action: e.action,
        weight: probabilities[i],
      }));
      // `evaluations` is ranked, so `best` is the argmax. Sampling it instead
      // is exploration, and exploration is a data-collection setting.
      const action = options.sample ? sampleWeighted(considered, context.random) : best.action;
      return {
        action,
        considered,
        note: `${contributors.join('+')}: best ΔP(win) ${(best.utility * 100).toFixed(2)}% `
          + `(E[Δtsd] ${best.expectedTsd.toFixed(1)}, σ ${best.sigmaTsd.toFixed(1)}, ${best.method})`,
      };
    },
  };
}
