/**
 * @module ai/explain-decision
 *
 * One decision, explained in text, for any agent in the registry.
 *
 * This is the single renderer behind three consumers: the `explain` CLI, the
 * `ai-client`'s per-decision log, and the Ask AI observer that answers a live
 * game's "what would this agent do here" from the browser
 * (`specs/2026-08-17-ask-ai-observer.md`). They used to render candidate
 * rankings in three places, which is how a CLI and a panel drift into
 * explaining different things.
 *
 * Two paths, because agents differ in what they can say about themselves:
 *
 * - **`h2`** re-runs its own pipeline — standing, plans, modules, ranking — and
 *   renders the module-by-module derivation in win-probability units.
 * - **every other agent** is asked to choose once, and its reported candidate
 *   weights are rendered in the unit it publishes them in.
 *
 * **The invariant**: every line is derived from `projectPlayerView(state,
 * playerId)`, never from the `GameState` the caller passed in. The full state
 * is an input only because projection needs one. An explanation travels to a
 * browser, so a line built from the omniscient state would be an information
 * leak — the thing `explain --state full` does on purpose and warns about.
 */

import type { CardDefinition, EvaluatedAction, GameAction, GameState, PlayerId, PlayerView } from '@meccg/shared';
import {
  buildCompanyNames,
  buildInstanceLookup,
  describeAction,
  stripCardMarkers,
  sumMarshallingPoints,
} from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import type { Agent, AgentContext, ConsideredAction } from '../types.js';
import { createRandomStream } from '../random-stream.js';
import { forwardActions } from './regress.js';
import { heuristicStrategy } from './heuristic.js';
import type { Evaluation } from './h2/core/types.js';
import type { Tunables } from './h2/core/tunables.js';
import { DEFAULT_TUNABLES } from './h2/core/tunables.js';
import { loadWinProbModel } from './h2/core/winprob.js';
import { evaluateDecision, proposePlans, resolveModules } from './h2/core/registry.js';
import { select } from './h2/services/portfolio.js';
import type { Commitment } from './h2/services/portfolio.js';
import { rankWithPlans } from './h2/services/plan-value.js';
import { computeStanding } from './h2/services/standing.js';
import type { Standing } from './h2/services/standing.js';
import { computeBudget } from './h2/services/budget.js';
import type { Budget } from './h2/services/budget.js';
import { computeExposure } from './h2/services/exposure.js';
import type { Exposure } from './h2/services/exposure.js';
import { computeCardPrices } from './h2/services/card-price.js';
import type { CardPrices } from './h2/services/card-price.js';
import { computeHazardPlan } from './h2/services/hazard-plan.js';
import type { HazardPlan } from './h2/services/hazard-plan.js';
import { renderExplanation } from './h2/explain.js';
import { withStandardCardPool } from './h2/scenario-store.js';
import { agentSpecParam, isH2Spec, parseH2Spec } from './h2/spec.js';

/** How many candidates are expanded in full when the caller does not say. */
const DEFAULT_TOP_N = 5;

/** How many non-viable candidates are listed with their engine reasons. */
const NON_VIABLE_SHOWN = 6;

/**
 * The candidates an agent may choose between at a position.
 *
 * Regressive actions are dropped, because every agent drops them: the engine
 * marks the actions that undo this phase's own progress, and explaining a
 * ranking that includes them would explain a decision nobody makes.
 */
export function decisionCandidates(view: PlayerView): {
  readonly legalActions: readonly GameAction[];
  readonly evaluated: readonly EvaluatedAction[];
  readonly viableCount: number;
} {
  const evaluated = view.legalActions;
  const viable = evaluated.filter(e => e.viable);
  return {
    legalActions: forwardActions(viable.map(e => e.action)),
    evaluated,
    viableCount: viable.length,
  };
}

/** Build a describer for one player's view — card names, company names, players. */
export function makeActionDescriber(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): (action: GameAction) => string {
  const lookup = buildInstanceLookup(view);
  const companies = buildCompanyNames(view.self.companies, view.self.characters, cardPool);
  const players: Record<string, string> = {
    [view.self.id as string]: view.self.name,
    [view.opponent.id as string]: view.opponent.name,
  };
  return action => stripCardMarkers(describeAction(action, cardPool, lookup, companies, players));
}

// ---- The H2 path ----

/** Everything H2's pipeline produces for one position. */
export interface H2Analysis {
  readonly standing: Standing;
  /** Modules that scored this decision; empty means the Heuristics-1 fallback owns it. */
  readonly modules: readonly string[];
  /** Action types no enabled module could score. */
  readonly uncovered: readonly string[];
  /** Ranked evaluations, plans folded in. Empty when the fallback owns the decision. */
  readonly evaluations: readonly Evaluation[];
  /** H1's weights, present only when no module claimed the decision. */
  readonly fallback?: readonly ConsideredAction[];
  readonly commitment: Commitment;
  readonly budget: Budget;
  readonly exposure: Exposure;
  readonly prices: CardPrices;
  readonly hazardPlan: HazardPlan;
}

/** Options for {@link analyzeH2Position} — the knobs an `h2` spec and the CLI flags carry. */
export interface H2AnalysisOptions {
  /** Module selector, as in the spec: `undefined`/`'all'`, or `'combat,kill'`. */
  readonly modules?: string;
  /** Constants; the shipped set unless a spec overrode them. */
  readonly tunables?: Tunables;
  /** Forced risk posture in [-1, 1], instead of deriving it from the standing. */
  readonly riskOverride?: number;
}

/**
 * Run H2's own pipeline over a position and return every intermediate.
 *
 * Shared by the `explain` CLI (which also renders these as JSON) and the
 * explanation below, so the two cannot disagree about what the agent thinks.
 */
export function analyzeH2Position(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  legalActions: readonly GameAction[],
  options: H2AnalysisOptions = {},
): H2Analysis {
  const tunables = options.tunables ?? DEFAULT_TUNABLES;
  const standing = computeStanding(view, loadWinProbModel(), tunables, options.riskOverride);
  const modules = resolveModules(options.modules);
  const moduleContext = { view, cardPool, legalActions, tunables, standing };
  const { modules: contributors, evaluations: tactical, uncovered }
    = evaluateDecision(modules, moduleContext);

  const fallback = contributors.length === 0
    ? heuristicStrategy.weighActions({ view, cardPool, legalActions })
    : undefined;

  // What the modules would commit to from this position, with no history behind
  // it. An explanation sees one position rather than a game, so there are no
  // incumbents to retain and the hysteresis has nothing to hold on to — this is
  // the portfolio a fresh agent would choose here, not necessarily the one an
  // agent that had been playing would still be carrying.
  const commitment = select(view.turnNumber, [], proposePlans(modules, moduleContext), tunables);

  // Ranked the way the agent ranks it: with the commitments folded in. Printing
  // the tactical order instead would explain a decision the agent does not make.
  const evaluations = rankWithPlans(modules, tactical, commitment, moduleContext)
    .map(p => p.evaluation);

  return {
    standing,
    modules: contributors,
    uncovered,
    evaluations,
    fallback,
    commitment,
    budget: computeBudget(view, cardPool),
    exposure: computeExposure(view, cardPool),
    prices: computeCardPrices(view, cardPool, standing, tunables),
    hazardPlan: computeHazardPlan(view, cardPool, standing, tunables),
  };
}

// ---- The generic path ----

/** One agent's ranked opinion of a position, rendered. */
interface Ranking {
  readonly lines: readonly string[];
  readonly chosen: GameAction | null;
  readonly chosenDescription: string;
}

/**
 * What a set of reported weights *means*, spelled out.
 *
 * Most agents publish sampling weights, comparable within one decision and
 * nowhere else; `mc` publishes a quantity. A reader who is told "42" and not
 * which of those it is cannot use the number at all.
 */
function weightUnitLabel(unit: 'tsd' | undefined): string {
  return unit === 'tsd'
    ? 'weights are expected tournament-score differential — differences are meaningful'
    : 'weights are relative preference — the ordering is meaningful, the differences are not';
}

/** Format a weight compactly: enough digits to separate near-ties. */
function formatWeight(weight: number): string {
  if (!Number.isFinite(weight)) return String(weight);
  if (weight === 0) return '0';
  return Math.abs(weight) >= 0.01 ? weight.toFixed(3) : weight.toExponential(2);
}

/** How many ranked rows are printed before the rest are summarized. */
const DEFAULT_MAX_ROWS = 20;

/** What to render, for {@link renderCandidateRanking}. */
export interface CandidateRankingInput {
  /** Describer for the acting player's view — see {@link makeActionDescriber}. */
  readonly describe: (action: GameAction) => string;
  /** The candidates the agent reported, in any order. */
  readonly candidates: readonly ConsideredAction[];
  /** The action the agent actually chose, marked with an arrow. */
  readonly picked: GameAction;
  /** Rows printed before the tail is summarized. Default 20. */
  readonly maxRows?: number;
  /** Unit of the reported weights, from the agent's decision. */
  readonly weightUnit?: 'tsd';
}

/**
 * The ranked candidate list, one row per candidate, the pick arrowed.
 *
 * Shared by the AI client's per-decision log and the Ask AI panel, so a
 * candidate list read in the lobby log and one read in the browser are the same
 * listing. The pick is *not* always the top row — the heuristic samples from
 * its distribution — so a pick outside `maxRows` is appended rather than
 * dropped: a listing that shows the ranking but not the choice answers the
 * wrong question.
 */
export function renderCandidateRanking(input: CandidateRankingInput): string[] {
  const { describe, picked } = input;
  const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
  const ranked = [...input.candidates].sort((a, b) => b.weight - a.weight);
  const pickedText = JSON.stringify(picked);
  const isPicked = (action: GameAction): boolean =>
    action === picked || JSON.stringify(action) === pickedText;

  const rows = ranked.slice(0, maxRows);
  const pickedRank = ranked.findIndex(c => isPicked(c.action));
  if (pickedRank >= maxRows) rows.push(ranked[pickedRank]);

  const lines = rows.map((candidate) => {
    const rank = ranked.indexOf(candidate) + 1;
    return `  ${isPicked(candidate.action) ? '→' : ' '} ${String(rank).padStart(2)}.`
      + ` ${formatWeight(candidate.weight)}  ${describe(candidate.action)}`;
  });
  const hidden = ranked.length - rows.length;
  if (hidden > 0) lines.push(`      … and ${hidden} more`);
  return lines;
}

/**
 * Ask any agent for its decision and render the candidate list it reports.
 *
 * This is the fallback path for every agent without a bespoke explanation —
 * `heuristic`, `mc`, `bc`, `search`, `route`, `random`. It is deliberately the
 * same rendering the AI client logs per decision while playing, so a candidate
 * list in the browser panel and one in the lobby log read alike.
 */
function renderAgentRanking(
  agent: Agent,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  legalActions: readonly GameAction[],
  evaluated: readonly EvaluatedAction[],
  topN: number,
  seed: number,
): Ranking {
  const describe = makeActionDescriber(view, cardPool);
  const lines: string[] = [];

  if (legalActions.length === 0) {
    lines.push('No viable action to choose between — nothing for the agent to decide here.');
    return { lines, chosen: null, chosenDescription: '(nothing to decide)' };
  }

  const context: AgentContext = {
    view,
    cardPool,
    legalActions,
    evaluated,
    // Seeded, so asking the same question twice gives the same answer.
    random: createRandomStream(seed),
  };
  const decision = agent.chooseAction(context);
  const chosenDescription = describe(decision.action);
  const considered = [...(decision.considered ?? [])].sort((a, b) => b.weight - a.weight);

  lines.push(`PICK  ${chosenDescription}`);
  if (decision.note) lines.push(`      note: ${decision.note}`);
  lines.push('');

  if (considered.length === 0) {
    // A forced action, or an agent that does not weigh. Say which, rather than
    // printing an empty ranking that reads as a bug.
    lines.push(legalActions.length === 1
      ? 'RANKING  only one action was available — the pick was forced.'
      : 'RANKING  the agent reported no candidate weights for this decision.');
    return { lines, chosen: decision.action, chosenDescription };
  }

  lines.push(`RANKING  ${considered.length} candidate${considered.length === 1 ? '' : 's'}`
    + ` — ${weightUnitLabel(decision.weightUnit)}`);
  lines.push(...renderCandidateRanking({
    describe,
    candidates: considered,
    picked: decision.action,
    maxRows: Math.max(topN * 4, DEFAULT_MAX_ROWS),
    weightUnit: decision.weightUnit,
  }));

  if (considered.length > 1) {
    const [first, second] = considered;
    lines.push('');
    lines.push(`GAP   ${formatWeight(first.weight - second.weight)} between the pick and`
      + ` "${describe(second.action)}"`
      + (decision.weightUnit === 'tsd' ? ' in expected score' : ' in preference'));
  }

  return { lines, chosen: decision.action, chosenDescription };
}

// ---- The explanation ----

/** What to explain, and with which agent. */
export interface DecisionExplanationInput {
  /** The agent to ask, already resolved so callers can reuse one instance. */
  readonly agent: Agent;
  /** The spec it was built from — decides the rendering path and names it in the header. */
  readonly agentSpec: string;
  /** Full game state; used only to project `playerId`'s view. */
  readonly state: GameState;
  /** Whose decision to explain. */
  readonly playerId: PlayerId;
  /** Heading line identifying the position, e.g. `game <id>#<seq>`. */
  readonly title: string;
  /** Static card pool, for describing actions. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** How many candidates to expand in full. Default 5. */
  readonly topN?: number;
  /** Seed for the agent's random stream, so an answer is reproducible. Default 1. */
  readonly seed?: number;
  /** Where the position came from, for the reproduce footer. */
  readonly source?: { readonly gameId: string; readonly stateSeq: number };
  /**
   * The move that was actually played from this position, when explaining a
   * decision already made ("would the agent have played that?").
   *
   * Rendered as a verdict against the agent's own pick, which is the whole
   * point of asking about a move afterwards: agreement is a much cheaper thing
   * to read than two rankings side by side.
   */
  readonly actuallyPlayed?: GameAction;
  /** H2 knobs; parsed from `agentSpec` when omitted. */
  readonly h2?: H2AnalysisOptions;
}

/** A rendered explanation, plus the facts a caller may want without parsing text. */
export interface DecisionExplanation {
  /** Agent name as reported by the agent itself. */
  readonly agent: string;
  /** The rendered explanation, one element per line. */
  readonly lines: readonly string[];
  /** The action the agent would take, or null when there was nothing to decide. */
  readonly chosen: GameAction | null;
  readonly chosenDescription: string;
  readonly viableCount: number;
  readonly candidateCount: number;
}

/** The distinct action types on offer, most numerous first — the decision's shape. */
function decisionShape(legalActions: readonly GameAction[]): string[] {
  const counts = new Map<string, number>();
  for (const action of legalActions) counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => (count === 1 ? type : `${type} ×${count}`));
}

/**
 * Explain what `agent` would do at one position, and why.
 *
 * The state is projected to `playerId`'s view first, and nothing below reads
 * the state again — see the module comment.
 */
export function explainDecision(input: DecisionExplanationInput): DecisionExplanation {
  const { agent, agentSpec, playerId, cardPool } = input;
  const topN = input.topN ?? DEFAULT_TOP_N;
  // A game-log record carries the position but not the card pool — the server
  // writes the definitions once per game rather than on every state — and
  // projection cannot resolve a single card without one. Rehydrating here means
  // a caller holding a log record does not have to know that.
  const state = withStandardCardPool(input.state);
  const view = projectPlayerView(state, playerId);
  const { legalActions, evaluated, viableCount } = decisionCandidates(view);
  const describe = makeActionDescriber(view, cardPool);

  const step = 'setupStep' in view.phaseState
    ? `/${(view.phaseState as { setupStep: { step: string } }).setupStep.step}`
    : '';
  const selfMp = sumMarshallingPoints(view.self.marshallingPoints);
  const opponentMp = sumMarshallingPoints(view.opponent.marshallingPoints);

  const lines: string[] = [
    `ASK AI — ${agentSpec}`,
    `Agent:    ${agent.name}${agent.name === agentSpec ? '' : ` (spec ${agentSpec})`}`,
    `Seat:     ${view.self.name} (${playerId}) — turn ${view.turnNumber}, ${view.phaseState.phase}${step}`,
    `Score:    ${view.self.name} ${selfMp} MP / ${view.opponent.name} ${opponentMp} MP`
    + `, hand ${view.self.hand.length}, opponent hand ${view.opponent.hand.length}`,
    `Choices:  ${viableCount} viable of ${evaluated.length} candidates`
    + `${legalActions.length === viableCount ? '' : ` (${viableCount - legalActions.length} regressive, dropped)`}`,
  ];

  // An agent that cannot bring its own machinery to bear answers by delegating,
  // and a reader who is not told that is reading the wrong agent's opinion.
  // Absent `canDecide` means the agent does not draw the distinction — not
  // "always" — so nothing is said in that case.
  if (agent.canDecide && legalActions.length > 0) {
    const context: AgentContext = {
      view, cardPool, legalActions, evaluated, random: createRandomStream(input.seed ?? 1),
    };
    if (!agent.canDecide(context)) {
      lines.push(`Note:     ${agent.name} cannot search this position (combat, mid-chain, or effects`
        + ' pending) — what follows is its fallback agent\'s answer.');
    }
  }

  if (legalActions.length > 0) {
    lines.push('');
    lines.push(`Asked:    ${decisionShape(legalActions).join(', ')}`);
  }
  lines.push('');

  let chosen: GameAction | null = null;
  let chosenDescription = '(nothing to decide)';

  if (isH2Spec(agentSpec)) {
    const spec = parseH2Spec(agentSpecParam(agentSpec));
    const analysis = analyzeH2Position(view, cardPool, legalActions, input.h2 ?? {
      modules: spec.modules,
      tunables: spec.tunables,
    });
    lines.push(...renderExplanation({
      title: input.title,
      view,
      cardPool,
      standing: analysis.standing,
      modules: analysis.modules,
      uncovered: analysis.uncovered,
      evaluations: analysis.evaluations,
      fallback: analysis.fallback,
      topN,
      budget: analysis.budget,
      exposure: analysis.exposure,
      prices: analysis.prices,
      hazardPlan: analysis.hazardPlan,
      commitment: analysis.commitment,
    }));
    const best = analysis.evaluations[0] ?? null;
    if (best) {
      chosen = best.action;
      chosenDescription = describe(best.action);
    } else if (analysis.fallback && analysis.fallback.length > 0) {
      const top = [...analysis.fallback].sort((a, b) => b.weight - a.weight)[0];
      chosen = top.action;
      chosenDescription = describe(top.action);
    }
  } else {
    const ranking = renderAgentRanking(
      agent, view, cardPool, legalActions, evaluated, topN, input.seed ?? 1,
    );
    lines.push(`Position: ${input.title}`);
    lines.push('');
    lines.push(...ranking.lines);
    chosen = ranking.chosen;
    chosenDescription = ranking.chosenDescription;
  }

  // Half of "explain this position" is "why can't I do X", and the engine has
  // already written the answer down for every action it refused.
  const nonViable = evaluated.filter(e => !e.viable);
  if (nonViable.length > 0) {
    lines.push('');
    lines.push(`NOT AVAILABLE  ${nonViable.length} candidate${nonViable.length === 1 ? '' : 's'}`
      + ' the engine refused:');
    for (const entry of nonViable.slice(0, NON_VIABLE_SHOWN)) {
      lines.push(`  ${describe(entry.action)} — ${entry.reason ?? 'no reason given'}`);
    }
    if (nonViable.length > NON_VIABLE_SHOWN) {
      lines.push(`  … and ${nonViable.length - NON_VIABLE_SHOWN} more`);
    }
  }

  if (input.actuallyPlayed) {
    const played = describe(input.actuallyPlayed);
    lines.push('');
    lines.push('ACTUALLY PLAYED');
    lines.push(`  ${played}`);
    if (chosen === null) {
      lines.push('  The agent had no opinion about this position.');
    } else if (JSON.stringify(chosen) === JSON.stringify(input.actuallyPlayed)) {
      lines.push(`  ${agent.name} agrees — it would have played the same move.`);
    } else {
      lines.push(`  ${agent.name} would have played ${chosenDescription} instead.`);
    }
  }

  if (input.source) {
    lines.push('');
    lines.push('REPRODUCE');
    lines.push(`  npm run explain -w @meccg/sim -- --game ${input.source.gameId}`
      + ` --seq ${input.source.stateSeq} --player ${playerId}`);
  }

  return {
    agent: agent.name,
    lines,
    chosen,
    chosenDescription,
    viableCount,
    candidateCount: evaluated.length,
  };
}
