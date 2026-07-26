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

/**
 * Steps through forced decisions (exactly one viable action) until a
 * branching point, terminal, error, or the step limit. Returns the final
 * state (or null on engine error — treated as terminal by the caller).
 */
function autoAdvanceForced(
  state: GameState,
  playerIds: readonly [PlayerId, PlayerId],
  limit: number,
): GameState | null {
  let current = state;
  for (let i = 0; i < limit; i++) {
    if (current.phaseState.phase === Phase.GameOver) return current;
    const acting = actingView(current, playerIds);
    if (!acting) return current; // deadlock-shaped: let the caller value it
    if (acting.viable.length !== 1) return current;
    const result = reduce(current, acting.viable[0].action);
    if (result.error) return null;
    current = result.state;
  }
  return current;
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

  // Leaf value: the net's opinion blended with the observable score
  // differential (see SearchOptions.mpWeight). Both are oriented to the
  // searcher before blending.
  const actorIsSearcher = acting.actor === searcher;
  const netValue = actorIsSearcher ? output.value : -output.value;
  const mpWeight = opts.mpWeight ?? 0;
  return (1 - mpWeight) * netValue + mpWeight * mpSpreadValue(acting.view, actorIsSearcher);
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
  if (!child) {
    const result = reduce(node.state, node.candidates[best].action);
    if (result.error) {
      // The engine rejected its own offer inside a hypothetical world —
      // treat as a dead branch, neutral value, never revisit.
      child = makeNode(node.state, searcher);
      child.terminalValue = 0;
    } else {
      const advanced = autoAdvanceForced(result.state, playerIds, 40);
      child = advanced === null ? makeNode(result.state, searcher) : makeNode(advanced, searcher);
      if (advanced === null) child.terminalValue = 0;
    }
    node.children[best] = child;
  }

  const value = simulate(child, searcher, playerIds, opts, depth + 1);
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
