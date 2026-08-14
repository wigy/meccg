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

import type { GameAction } from '@meccg/shared';
import type { Agent, AgentContext, AgentDecision, ConsideredAction } from '../../types.js';
import { forwardActions } from '../regress.js';
import { createCycleGuard } from '../../cycle-guard.js';
import { viewSignature } from '../../state-signature.js';
import { sampleWeighted } from '../strategy.js';
import type { H2Module, ModuleContext } from './core/types.js';
import type { Tunables } from './core/tunables.js';
import { DEFAULT_TUNABLES } from './core/tunables.js';
import type { WinProbModel } from './core/winprob.js';
import { loadWinProbModel } from './core/winprob.js';
import { ALL_MODULES, evaluateDecision, proposePlans, resolveModules } from './core/registry.js';
import { createPlanPortfolio } from './services/portfolio.js';
import { rankWithPlans } from './services/plan-value.js';
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
 * The tunables that differ from the shipped set, as a spec-shaped suffix.
 *
 * Empty for the defaults, so the common case still reports plain `h2`.
 */
function describeTunableOverrides(tunables: Tunables): string {
  const changed = (Object.keys(DEFAULT_TUNABLES) as (keyof Tunables)[])
    .filter(name => tunables[name] !== DEFAULT_TUNABLES[name])
    .map(name => `/${name}=${tunables[name]}`);
  return changed.join('');
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
  const selector = options.modules && options.modules !== 'all' ? `h2:${options.modules}` : 'h2';
  // A tunable override changes how every module scores, so a run that reports
  // plain `h2` for two different constant sets cannot be read afterwards —
  // which is exactly the failure a tunable gate would produce.
  const base = `${selector}${describeTunableOverrides(tunables)}`;
  // Sampled play and the fallback are each a different agent from plain argmax
  // play — a run that reports `h2` for differently-configured agents cannot be
  // read afterwards. The fallback's connector records whether the agent yields
  // outright (`>`) or only on what its own modules cannot price (`+`).
  const label = options.sample ? `${base}@${temperature}` : base;

  // The long-term commitments in force. Per-agent because a commitment is
  // exactly the state a stateless evaluator cannot hold, and reset per game
  // because carrying one across games would have an early game silently steer
  // a later one — the failure the `bc` agent's guard memory already documents.
  const portfolio = createPlanPortfolio();
  // Three filters now run in front of the modules, and they answer different
  // questions. `forwardActions` drops what the engine has *proved* undoes this
  // phase's progress; the cycle guard drops what has *demonstrably* led back to
  // this position, which is the part the engine cannot see when every lap mints
  // fresh instance IDs; the plan layer then re-ranks what is left. See
  // `cycle-guard`.
  const cycleGuard = createCycleGuard();

  /**
   * Which sites each company has already been sent to, this game.
   *
   * `route-compare` measured H2 returning to a site it had already worked on 12
   * of 64 recorded movement decisions, against the human's 1 — and the human
   * never moves to the same region twice running, where H2 does on 23.4% of
   * moves. Every one of those revisits is a defensible *destination* (playable
   * cards, survivable danger, all of which H2 optimises well), and wrong only
   * given where the company has already been. Nothing in the state records
   * that, so the agent does.
   */
  const visited = new Map<string, string[]>();

  return {
    name: label,

    startGame(): void {
      portfolio.reset();
      visited.clear();
      // Signatures are coarse on purpose, so one game's history must never
      // narrow another's candidates.
      cycleGuard.reset();
    },

    chooseAction(context: AgentContext): AgentDecision {
      if (context.legalActions.length === 0) {
        throw new Error('h2 agent asked to choose with no legal actions');
      }
      const signature = viewSignature(context.view);
      // The engine marks candidates that undo this phase's own progress, and
      // that is a fact rather than a preference — see `ai/regress`. Filtering
      // here rather than inside a module keeps every module's coverage honest:
      // an action H2 never sees cannot be one it declined to score.
      const legalActions = cycleGuard.allow(signature, forwardActions(context.legalActions));
      const decision = decide(context, legalActions);
      cycleGuard.taken(signature, decision.action);
      rememberDestination(context, decision.action);
      return decision;
    },
  };

  /**
   * Record where a company was just sent, so the next decision can see it.
   *
   * Keyed by *definition*, because two instances of one site are the same
   * place, and recorded only for movement the agent itself chose — a route it
   * did not walk is not a route it should charge itself for.
   */
  function rememberDestination(context: AgentContext, action: GameAction): void {
    if (action.type !== 'plan-movement') return;
    const record = action as unknown as { companyId?: string; destinationSite?: string };
    if (!record.companyId || !record.destinationSite) return;
    const site = context.view.self.siteDeck?.find(
      c => (c.instanceId as string) === record.destinationSite,
    );
    if (!site) return;
    const seen = visited.get(record.companyId) ?? [];
    visited.set(record.companyId, [...seen, site.definitionId as string]);
  }

  /** The ranking itself, on whatever candidate list survived the filters. */
  function decide(context: AgentContext, legalActions: readonly GameAction[]): AgentDecision {
      const moduleContext: ModuleContext = {
        view: context.view,
        cardPool: context.cardPool,
        legalActions,
        tunables,
        standing: computeStanding(context.view, model, tunables, options.riskOverride),
        visited: Object.fromEntries(visited),
      };
      // Commit once per turn, then price every candidate against what is
      // committed. Re-selecting per decision would let the portfolio churn
      // inside one organization phase, which is the plan-thrash on a shorter
      // clock — see `services/portfolio`.
      const commitment = portfolio.commit(
        context.view.turnNumber,
        proposePlans(modules, moduleContext),
        tunables,
      );
      const { modules: contributors, evaluations: tactical, complete }
        = evaluateDecision(modules, moduleContext);
      // The plan contributions are folded in here rather than inside
      // `evaluateDecision` because they are not a module's opinion about an
      // action — they are what the *commitment* says about it, and the registry
      // is the wrong place for a number no module owns. Re-ranking is the whole
      // point: a candidate that serves a commitment has to be able to outrank
      // one that looked better tactically.
      const planned = rankWithPlans(modules, tactical, commitment, moduleContext);
      const evaluations = planned.map(p => p.evaluation);
      const best = evaluations[0];
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
      // The comparison is against the *runner-up*, not the worst candidate.
      // A decision with several tied 0-utility actions (e.g. `transfer-item`,
      // `store-item`, `pass`, all correctly scored as "moves no points") and
      // one clearly worse one (`split-company`, priced negative by `defence`)
      // has a real spread between best and worst — but no opinion at the top:
      // `evaluations[0]` after the stable sort is just whichever tied
      // candidate happened to appear first in `legalActions`, not a preferred
      // one. Comparing best to worst called that "discriminating" and played
      // it, which is how H2 came to deterministically hand away two starting
      // items it never had a reason to move (game msp8zwew-ddwnxz, turn 2).
      // Comparing to the runner-up asks the right question: is the top of the
      // ranking uncontested? A single covered candidate has no runner-up to
      // clear, so it falls through to the `best.utility > TIE_EPSILON` check
      // below rather than discriminating by default — a lone action scored
      // exactly 0 (e.g. `pass` on the baseline, with no modules registered)
      // still has to earn `speaks` on its own, which is what keeps `h2` with
      // no modules an exact replay of Heuristics 1.
      //
      // Requiring the *margin* instead cost real decisions. Drawing a card is
      // worth `resourceDrawValue`, which comes out around +0.3% against passing
      // at 0 — a correct and confident preference that fell below the 0.5%
      // margin and went to H1 every turn of every game.
      const runnerUp = evaluations[1];
      const discriminates = evaluations.length > 0 && runnerUp !== undefined
        && best.utility - runnerUp.utility > TIE_EPSILON;
      // …and a *near* tie is only a tie worth keeping when the fallback is
      // weaker than the module tree. It is a parameter now, so this is too:
      // `decisiveMargin` is how far the best candidate must beat its runner-up
      // before H2 claims a decision it fully covers. At the shipped zero the
      // clause cannot fire and the rule above is unchanged.
      const decisive = tunables.decisiveMargin <= 0
        || runnerUp === undefined
        || best.utility - runnerUp.utility > tunables.decisiveMargin;
      // `decisiveMargin` and the tie test no longer decide *who* plays the
      // move — nobody else is left to play it — only whether H2 acts on a
      // preference or declines to act at all. See below.
      const speaks = evaluations.length > 0
        && (complete ? (discriminates || best.utility > TIE_EPSILON) && decisive
          : best.utility > tunables.partialCoverageMargin);

      if (!speaks) {
        // **This is where Heuristics 1 used to play the move.** It decided
        // 41.2% of every real choice in the recorded corpus — 96.8% of
        // `corruption-check`, 72.5% of `play-hazard`, 58.7% of `pass`, 55.1% of
        // `discard-card` — so more than two decisions in five credited to H2
        // were H1's, and every module improvement was being measured on the
        // fraction that reached the modules at all. A ceiling made of another
        // agent cannot be raised by working on this one, so it is gone and H2
        // answers its own decisions, including the ones it cannot rank.
        //
        // What it says when it cannot rank them is **one of the tied best, at
        // random** — never `pass` by preference.
        //
        // This clause said `pass` first, on the argument that every action
        // costs something the model may not have priced, so an action with no
        // modelled benefit has nothing to set against it. That argument is
        // wrong about this game. Not acting is not the neutral option: a turn
        // spent passing plays no resource, attempts no faction and scores
        // nothing, while the opponent's turn arrives regardless. `pass` is a
        // move with its own cost, and preferring it on every tie made H2
        // decline 44% of its decisions.
        //
        // Random rather than first-in-list, because the failure this clause
        // was originally written to prevent is real: a tie at the top of the
        // ranking is whichever candidate sorted first, not a preferred one, and
        // taking it deterministically once had H2 give away two starting items
        // it had no reason to move. Choosing uniformly among the tied removes
        // the false preference without inventing one — and it is honest about
        // what a tie is, which array order is not.
        const tied = evaluations.filter(e => e.utility >= best.utility - TIE_EPSILON);
        // Among equals, act. `pass` only wins a tie when nothing else is tied
        // with it.
        const acting = tied.filter(e => e.action.type !== 'pass');
        const pool = (acting.length > 0 ? acting : tied).map(e => e.action);
        const fallbackPool = legalActions.filter(a => a.type !== 'pass');
        const options = pool.length > 0
          ? pool
          : (fallbackPool.length > 0 ? fallbackPool : legalActions);
        const chosen = options[Math.min(options.length - 1, Math.floor(context.random() * options.length))];
        return {
          action: chosen,
          note: `no opinion — one of ${options.length} tied at random: ${chosen.type} `
            + `(${evaluations.length} candidate(s) scored)`,
        };
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
  }
}
