/**
 * @module search/puct
 *
 * Determinizing PUCT search (P5): net-guided Monte-Carlo tree search over
 * the real engine. The searcher samples K hidden worlds consistent with
 * its {@link PlayerView} (see search/determinize), runs a PUCT tree per
 * world using the behavioral-cloning net for move priors and leaf values,
 * steps worlds with the pure reducer, and aggregates root visit counts
 * across worlds by canonical action id — the standard PIMC/IS-MCTS root
 * scheme. Forced nodes (a single viable action) are auto-advanced without
 * spending search budget; ~half of all decisions are forced, so this
 * matters. Values are stored from the searcher's perspective and negated
 * at opponent-to-move nodes during selection.
 */

import { reduce, Phase, computeTournamentScore } from '@meccg/shared';
import type {
  CardDefinition,
  EvaluatedAction,
  GameAction,
  GameState,
  PlayerId,
  PlayerView,
} from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import { determinize, isDeterminizableView } from './determinize.js';
import type { LoadedDeck } from '../decks.js';
import { bcForward } from '../agents/bc-agent.js';
import type { BcWeightsFile } from '../agents/bc-agent.js';
import { featurizeState, featurizeActions } from '../features/index.js';
import type { CardVocab } from '../features/index.js';
import type { WinProbModel } from '../ai/h2/core/winprob.js';
import { winProbability } from '../ai/h2/core/winprob.js';

/** Options for {@link searchBestAction}. */
export interface SearchOptions {
  /** Trained policy/value net (priors + leaf evaluation). */
  readonly model: BcWeightsFile;
  /** Card vocabulary matching the model. */
  readonly vocab: CardVocab;
  /** Static card pool. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** Decks by seat (challenge decks are public). */
  readonly decks: readonly [LoadedDeck, LoadedDeck];
  /** Total simulation budget across all worlds (default 192). */
  readonly sims?: number;
  /** Number of root determinizations (default 4). */
  readonly worlds?: number;
  /** PUCT exploration constant (default 1.5). */
  readonly cPuct?: number;
  /** Ply depth cap before bootstrapping with the net value (default 60). */
  readonly maxDepth?: number;
  /** Base seed for world sampling (derive from the agent's seeded stream). */
  readonly seed: number;
  /**
   * Weight of the observable tournament-score differential in a leaf's
   * value, in [0, 1]. **Defaults to 0 (off) — measured harmful at 0.5.**
   *
   * The motivation was sound but the experiment refuted it: the trained
   * value head calls the winner well only in the last quarter of a game
   * (sign accuracy 0.78) and sits at chance through the middle (0.48) —
   * and a few-dozen-ply search from a mid-game position lands every leaf
   * in exactly that blind zone, which is why pure-net search only tied
   * the bare policy (50.5%, +3 Elo over 100 games). The score
   * differential is computable directly from the leaf state, so it
   * looked like signal where the net is noise — but at weight 0.5,
   * search collapsed to 2 wins in 12 games against that same policy.
   * Maximizing the immediate score spread is greedy in a game where
   * marshalling points are bought with corruption risk and capped by
   * the doubling rule, and that greed costs more than the noisy net
   * value does. Retained as a tunable (small weights are untested) but
   * off by default; revisit once the value head beats the
   * score-differential baseline it currently loses to mid-game.
   */
  readonly mpWeight?: number;
  /**
   * Use the fitted Heuristics-2 win-probability model as the leaf value.
   *
   * This is the same idea `mpWeight` tried and the same idea that failed —
   * with the three defects that made it fail removed. The raw differential
   * above is an unfitted `tanh(spread / 6)`: a guessed scale, no turn term,
   * and no notion that a point means less once a game is decided. So it
   * valued an early six-point spread as decisively as a late one, which is
   * precisely the greed that cost search 2 wins in 12 games.
   *
   * `W(tsd, turn)` is fitted on held-out *games* (Brier 0.2084 against 0.25
   * for a coin flip, sign accuracy 69.6%) and is explicitly a function of how
   * far the game has run. It is also already a win probability, so blending
   * it with the net's value head mixes two estimates of the same quantity
   * rather than two different ones.
   *
   * `weight` in [0, 1]; 1 replaces the net's value entirely.
   */
  readonly winProb?: { readonly model: WinProbModel; readonly weight: number };
}

/**
 * Tournament-score points that map to a decisive evaluation. MECCG games
 * are decided by a handful of points, so a spread of ~6 saturates tanh
 * toward ±1.
 */
const MP_SPREAD_SCALE = 6;

/**
 * Observable score differential at a leaf, oriented to the searcher and
 * squashed into [-1, 1].
 */
function mpSpreadValue(view: PlayerView, actorIsSearcher: boolean): number {
  const selfScore = computeTournamentScore(view.self.marshallingPoints, view.opponent.marshallingPoints);
  const opponentScore = computeTournamentScore(view.opponent.marshallingPoints, view.self.marshallingPoints);
  const spread = (selfScore - opponentScore) / MP_SPREAD_SCALE;
  return Math.tanh(actorIsSearcher ? spread : -spread);
}

/**
 * The fitted win probability at a leaf, on the search's [-1, 1] scale and
 * oriented to the searcher.
 *
 * Orientation is free here in a way it is not for the net: `W` is odd in TSD
 * by construction, so negating the value and negating the differential give
 * the same number. The net's two views of one state are different feature
 * vectors whose values need not sum to zero, which is why that path has to
 * re-project instead.
 */
function winProbLeafValue(model: WinProbModel, view: PlayerView, actorIsSearcher: boolean): number {
  const differential = computeTournamentScore(view.self.marshallingPoints, view.opponent.marshallingPoints)
    - computeTournamentScore(view.opponent.marshallingPoints, view.self.marshallingPoints);
  const w = winProbability(model, actorIsSearcher ? differential : -differential, view.turnNumber);
  return 2 * w - 1;
}

/**
 * How many forced decisions may be skipped in one step. Kept small: with
 * boundary-stopping in place this is a backstop, and a large budget would
 * reintroduce the depth asymmetry it exists to prevent.
 */
const FORCED_SKIP_LIMIT = 8;

/** One search tree node: a concrete world state plus PUCT statistics. */
interface Node {
  readonly state: GameState;
  /** Player to move at this node (null = terminal). */
  actor: PlayerId | null;
  /** Viable candidates for the actor. */
  candidates: readonly EvaluatedAction[];
  /** Net prior per candidate. */
  priors: readonly number[];
  visits: number[];
  /** Summed backed-up values per child, searcher-perspective. */
  values: number[];
  children: (Node | null)[];
  /** Set when the node is terminal or unexpandable. */
  terminalValue: number | null;
  expanded: boolean;
}

/** The acting player of a state per the runner's rule, with their view. */
function actingView(state: GameState, playerIds: readonly [PlayerId, PlayerId]):
  { actor: PlayerId; view: PlayerView; viable: EvaluatedAction[] } | null {
  const order = state.activePlayer === playerIds[1] ? [1, 0] : [0, 1];
  for (const i of order) {
    const view = projectPlayerView(state, playerIds[i]);
    const viable = view.legalActions.filter(e => e.viable);
    if (viable.length > 0) return { actor: playerIds[i], view, viable };
  }
  return null;
}

/** Terminal value of a game-over state from the searcher's perspective. */
function terminalValue(state: GameState, searcher: PlayerId): number {
  if (state.phaseState.phase !== Phase.GameOver) return 0;
  const winner = (state.phaseState as { winner: PlayerId | null }).winner;
  return winner === null ? 0 : winner === searcher ? 1 : -1;
}

/** Outcome of forced-move skipping: where we stopped and how far we went. */
interface AdvanceResult {
  /** State at the stopping point, or null on an engine error. */
  readonly state: GameState | null;
  /** Forced decisions consumed, counted toward search depth. */
  readonly plies: number;
}

/**
 * Steps through forced decisions (exactly one viable action) until a
 * branching point, terminal, error, the step limit, or **a phase/turn
 * boundary**.
 *
 * Stopping at boundaries is what keeps leaf evaluations comparable. The
 * value head's calibration is strongly stage-dependent (mean |value| runs
 * 0.40 early to 0.82 late), so a child reached by skipping deep into a
 * later phase is scored on a different scale than a sibling evaluated
 * immediately. Measured: with unbounded skipping, `pass` — which ends the
 * phase and therefore triggers long forced sequences — collected 22 root
 * visits against 2-7 for real moves at a position where the policy ranked
 * it nowhere, and search lost to its own policy at 5.8%. That is the
 * classic horizon effect, not a value-sign error.
 */
function autoAdvanceForced(
  state: GameState,
  playerIds: readonly [PlayerId, PlayerId],
  limit: number,
): AdvanceResult {
  let current = state;
  const startPhase = current.phaseState.phase;
  const startTurn = current.turnNumber;
  for (let plies = 0; plies < limit; plies++) {
    if (current.phaseState.phase === Phase.GameOver) return { state: current, plies };
    if (current.phaseState.phase !== startPhase || current.turnNumber !== startTurn) {
      return { state: current, plies };
    }
    const acting = actingView(current, playerIds);
    if (!acting) return { state: current, plies }; // deadlock-shaped
    if (acting.viable.length !== 1) return { state: current, plies };
    const result = reduce(current, acting.viable[0].action);
    if (result.error) return { state: null, plies };
    current = result.state;
  }
  return { state: current, plies: limit };
}

/** Creates an unexpanded node for a state (classifying terminals). */
function makeNode(state: GameState, searcher: PlayerId): Node {
  const node: Node = {
    state,
    actor: null,
    candidates: [],
    priors: [],
    visits: [],
    values: [],
    children: [],
    terminalValue: null,
    expanded: false,
  };
  if (state.phaseState.phase === Phase.GameOver) {
    node.terminalValue = terminalValue(state, searcher);
  }
  return node;
}

/**
 * Expands a node: computes the actor's view, net priors over viable
 * candidates, and returns the net leaf value (searcher-perspective).
 */
function expand(node: Node, searcher: PlayerId, playerIds: readonly [PlayerId, PlayerId], opts: SearchOptions): number {
  const acting = actingView(node.state, playerIds);
  if (!acting) {
    // No player can act (engine gap in a hypothetical world): value neutral.
    node.terminalValue = 0;
    return 0;
  }
  const stateFeatures = featurizeState(acting.view, opts.cardPool, opts.vocab);
  const actionFeatures = featurizeActions(acting.view, opts.cardPool, opts.vocab);
  const output = bcForward(opts.model, stateFeatures, actionFeatures);

  // Leaf value is always read from the SEARCHER's own view, never from the
  // actor's view negated. Nothing in training makes the value head
  // zero-sum consistent — the two players' views of one state are
  // different feature vectors and can yield values that do not sum to
  // zero — so negating the opponent's estimate puts siblings on
  // incomparable scales. Search exploited exactly that: handing the turn
  // over scored better than acting, and `pass` collected 19-22 root visits
  // against 2-8 for real moves. Priors still come from the actor's view,
  // which is the only view whose candidates are meaningful.
  const valueOutput = acting.actor === searcher
    ? output
    : bcForward(
      opts.model,
      featurizeState(projectPlayerView(node.state, searcher), opts.cardPool, opts.vocab),
      { candidates: [], mask: [] },
    );

  // Collect priors for viable candidates only, renormalized.
  const priors: number[] = [];
  const candidates: EvaluatedAction[] = [];
  acting.view.legalActions.forEach((evaluated, i) => {
    if (!evaluated.viable) return;
    candidates.push(evaluated);
    priors.push(output.probs[i]);
  });
  const total = priors.reduce((sum, p) => sum + p, 0) || 1;

  node.actor = acting.actor;
  node.candidates = candidates;
  node.priors = priors.map(p => p / total);
  node.visits = new Array<number>(candidates.length).fill(0);
  node.values = new Array<number>(candidates.length).fill(0);
  node.children = new Array<Node | null>(candidates.length).fill(null);
  node.expanded = true;

  // Leaf value: the net's opinion (already searcher-oriented above)
  // blended with the observable score differential (see mpWeight).
  const netValue = valueOutput.value;
  if (opts.winProb) {
    const weight = opts.winProb.weight;
    return (1 - weight) * netValue
      + weight * winProbLeafValue(opts.winProb.model, acting.view, acting.actor === searcher);
  }
  const mpWeight = opts.mpWeight ?? 0;
  return (1 - mpWeight) * netValue + mpWeight * mpSpreadValue(acting.view, acting.actor === searcher);
}

/** One PUCT simulation from the root; returns the searcher-value backed up. */
function simulate(
  node: Node,
  searcher: PlayerId,
  playerIds: readonly [PlayerId, PlayerId],
  opts: SearchOptions,
  depth: number,
): number {
  if (node.terminalValue !== null) return node.terminalValue;
  if (!node.expanded) return expand(node, searcher, playerIds, opts);
  if (depth >= (opts.maxDepth ?? 60)) {
    // Depth cap: bootstrap with the net value of this node's actor view.
    return expand({ ...node, expanded: false } as Node, searcher, playerIds, opts);
  }

  // PUCT selection (opponent nodes minimize searcher value → negate Q).
  const c = opts.cPuct ?? 1.5;
  const totalVisits = node.visits.reduce((sum, n) => sum + n, 0);
  const sqrtTotal = Math.sqrt(totalVisits + 1);
  const sign = node.actor === searcher ? 1 : -1;
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < node.candidates.length; i++) {
    const q = node.visits[i] > 0 ? (sign * node.values[i]) / node.visits[i] : 0;
    const u = c * node.priors[i] * (sqrtTotal / (1 + node.visits[i]));
    const score = q + u;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  let child = node.children[best];
  let childPlies = 0;
  if (!child) {
    const result = reduce(node.state, node.candidates[best].action);
    if (result.error) {
      // The engine rejected its own offer inside a hypothetical world —
      // treat as a dead branch, neutral value, never revisit.
      child = makeNode(node.state, searcher);
      child.terminalValue = 0;
    } else {
      const advanced = autoAdvanceForced(result.state, playerIds, FORCED_SKIP_LIMIT);
      child = makeNode(advanced.state ?? result.state, searcher);
      if (advanced.state === null) child.terminalValue = 0;
      // Forced plies are real game progress and count toward the depth
      // budget, so a line that skips ahead cannot buy extra lookahead.
      childPlies = advanced.plies;
    }
    node.children[best] = child;
  }

  const value = simulate(child, searcher, playerIds, opts, depth + 1 + childPlies);
  node.visits[best] += 1;
  node.values[best] += value;
  return value;
}

/** Result of a root search. */
export interface SearchResult {
  /** The chosen action (an entry of the original view's viable candidates). */
  readonly action: GameAction;
  /** Aggregated root visit counts keyed like the view's candidate order. */
  readonly visits: readonly number[];
}

/**
 * Runs determinizing PUCT from the searcher's view. Returns null when the
 * view is not determinizable or search is pointless (≤1 viable candidate)
 * — the caller falls back to the policy.
 */
export function searchBestAction(view: PlayerView, opts: SearchOptions): SearchResult | null {
  const viable = view.legalActions.filter(e => e.viable);
  if (viable.length <= 1 || !isDeterminizableView(view)) return null;

  const searcher = view.self.id;
  const playerIds: [PlayerId, PlayerId] =
    view.selfIndex === 0 ? [searcher, view.opponent.id] : [view.opponent.id, searcher];
  const worlds = Math.max(1, opts.worlds ?? 4);
  const simsPerWorld = Math.max(1, Math.floor((opts.sims ?? 192) / worlds));
  const ownDeck = opts.decks[view.selfIndex];
  const opponentDeck = opts.decks[1 - view.selfIndex];

  // Aggregate visits by canonical action id (fall back to candidate index).
  const keyOf = (evaluated: EvaluatedAction, index: number): string =>
    evaluated.actionId ?? `#${index}`;
  const aggregated = new Map<string, number>();

  for (let w = 0; w < worlds; w++) {
    const world = determinize({
      view, ownDeck, opponentDeck,
      seed: (opts.seed + w * 0x9e3779b9) | 0,
      cardPool: opts.cardPool,
    });
    const root = makeNode(world, searcher);
    for (let sim = 0; sim < simsPerWorld; sim++) {
      simulate(root, searcher, playerIds, opts, 0);
    }
    if (!root.expanded) continue;
    root.candidates.forEach((candidate, i) => {
      const key = keyOf(candidate, i);
      aggregated.set(key, (aggregated.get(key) ?? 0) + root.visits[i]);
    });
  }
  if (aggregated.size === 0) return null;

  // Pick argmax visits among the ORIGINAL view's viable candidates.
  let bestIndex = -1;
  let bestVisits = -1;
  const visitsOut: number[] = [];
  viable.forEach((evaluated, i) => {
    const count = aggregated.get(keyOf(evaluated, i)) ?? 0;
    visitsOut.push(count);
    if (count > bestVisits) {
      bestVisits = count;
      bestIndex = i;
    }
  });
  if (bestIndex < 0 || bestVisits <= 0) return null;
  return { action: viable[bestIndex].action, visits: visitsOut };
}
