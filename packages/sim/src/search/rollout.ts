/**
 * @module search/rollout
 *
 * Seeded playouts over the real engine. Given a `GameState` (typically one
 * produced by `search/determinize-null`), steps `computeLegalActions` →
 * policy → `reduce` until a horizon, a terminal, or an engine error, and
 * reports the tournament-score differential reached.
 *
 * Three properties matter for the callers:
 *
 * - **Hidden cards stay unplayable.** Instances the searcher cannot
 *   identify carry the `unknown-card` stand-in, and any action that would
 *   use one is dropped — except placing it face-down on-guard (which the
 *   engine offers for *any* hand card) and discarding it, which must stay
 *   available or a mandatory end-of-turn discard could deadlock the
 *   playout. A filter that empties the candidate list is discarded whole,
 *   as a second guard against the same failure.
 * - **Cycles terminate.** A costless no-op loop (*I'll Report You* returns
 *   itself to hand for free in any organization phase) can otherwise spin a
 *   playout forever; `state-signature` detects the repeat and stops it.
 * - **The value is TSD**, the tournament-score differential from CoE §10.3
 *   — computed with the engine's own scorer so doubling and the half-total
 *   cap are included, rather than by subtracting raw marshalling points.
 */

import { reduce, Phase, computeTournamentScore, computeLegalActions } from '@meccg/shared';
import type {
  CardInstanceId,
  GameAction,
  GameState,
  PlayerId,
  PlayerState,
} from '@meccg/shared';

/**
 * TSD magnitude assigned to a decided game. Real differentials sit well
 * inside ±30, so a win dominates any score-based line without being so
 * large that a single lucky playout swamps the mean.
 */
export const WIN_TSD = 30;

/**
 * Action types an unidentified card may still appear in. On-guard
 * placement is the one *use* an unknown card keeps (the engine offers it
 * for any hand card, without consulting the definition); the discards are
 * present because they can be mandatory, and filtering them could leave a
 * player with nothing legal to do.
 */
const UNKNOWN_CARD_ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  'place-on-guard',
  'discard-card',
  'discard-card-for-hazard-limit',
]);

/** How a playout finished — reported so callers can spot pathologies. */
export type RolloutEnd = 'horizon' | 'game-over' | 'engine-error' | 'no-actions' | 'cycle' | 'decision-cap';

/** Outcome of one playout. */
export interface RolloutResult {
  /** Tournament-score differential at the stopping point, searcher-oriented. */
  readonly tsd: number;
  /** Decisions actually stepped. */
  readonly decisions: number;
  /** Why the playout stopped. */
  readonly end: RolloutEnd;
}

/** Options for {@link rollout}. */
export interface RolloutOptions {
  /** Both seats in engine order. */
  readonly playerIds: readonly [PlayerId, PlayerId];
  /** Whose perspective the returned TSD is oriented to. */
  readonly searcher: PlayerId;
  /** Instances carrying the `unknown-card` stand-in. */
  readonly unknownInstances: ReadonlySet<CardInstanceId>;
  /** Stop once this many game turns have elapsed from the start state. */
  readonly horizonTurns: number;
  /** Hard cap on stepped decisions, so a pathological line cannot hang. */
  readonly maxDecisions: number;
  /**
   * How often the coarse progress signature may recur before the playout is
   * called a cycle (default {@link DEFAULT_CYCLE_LIMIT}). Raise it to let a
   * deep playout actually reach its `horizonTurns` — at the default it
   * usually does not.
   */
  readonly cycleLimit?: number;
  /** Seeded uniform stream; the playout draws every choice from it. */
  readonly random: () => number;
  /**
   * Policy for choosing among the filtered candidates. Defaults to uniform
   * random. Supplied a plain action list rather than an `AgentContext` so
   * playouts never pay for view projection on the searcher's behalf.
   */
  readonly policy?: (actions: readonly GameAction[], random: () => number) => GameAction;
}

/** The seat that owns a player id, or undefined when absent. */
function playerState(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find(p => p.id === id);
}

/**
 * Tournament-score differential of a state from the searcher's side. Uses
 * `computeTournamentScore` on both sides so the §10.3 doubling and the
 * half-total cap are applied — the same currency the acquisition side of
 * `specs/2026-07-27-heuristics-2-ai.md` calls TSD.
 */
export function stateTsd(state: GameState, searcher: PlayerId): number {
  const self = playerState(state, searcher);
  const opponent = state.players.find(p => p.id !== searcher);
  if (!self || !opponent) return 0;
  return computeTournamentScore(self.marshallingPoints, opponent.marshallingPoints)
    - computeTournamentScore(opponent.marshallingPoints, self.marshallingPoints);
}

/** True when any instance id anywhere in the action is unidentified. */
function referencesUnknown(value: unknown, unknown: ReadonlySet<CardInstanceId>): boolean {
  if (typeof value === 'string') return unknown.has(value as CardInstanceId);
  if (Array.isArray(value)) return value.some(item => referencesUnknown(item, unknown));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(item => referencesUnknown(item, unknown));
  }
  return false;
}

/**
 * Drops actions that would use a card the searcher cannot identify. Returns
 * the original list when filtering would leave nothing legal, so a playout
 * can never deadlock on a mandatory step.
 */
export function filterUnknownCardActions(
  actions: readonly GameAction[],
  unknown: ReadonlySet<CardInstanceId>,
): readonly GameAction[] {
  if (unknown.size === 0) return actions;
  const kept = actions.filter(action =>
    UNKNOWN_CARD_ALLOWED_ACTIONS.has(action.type) || !referencesUnknown(action, unknown));
  return kept.length > 0 ? kept : actions;
}

/**
 * The player to move and their viable actions, following the runner's rule:
 * the active player acts first, and the opponent only when the active
 * player has nothing viable (hazard play, responses).
 */
function acting(
  state: GameState,
  playerIds: readonly [PlayerId, PlayerId],
): { actor: PlayerId; actions: readonly GameAction[] } | null {
  const order = state.activePlayer === playerIds[1] ? [1, 0] : [0, 1];
  for (const i of order) {
    const evaluated = computeLegalActions(state, playerIds[i]);
    const viable = evaluated.filter(e => e.viable).map(e => e.action);
    if (viable.length > 0) return { actor: playerIds[i], actions: viable };
  }
  return null;
}

/**
 * Coarse progress signature for cycle detection, computed straight from the
 * state (the view-level `state-signature` needs a projection this hot loop
 * cannot afford). Tracks quantities any real progress changes, so a
 * legitimately repeated action never collides with a true no-op loop.
 */
function stateSignature(state: GameState): string {
  const parts: (string | number)[] = [state.turnNumber, state.phaseState.phase, state.activePlayer ?? ''];
  for (const p of state.players) {
    const mp = p.marshallingPoints;
    parts.push(
      p.hand.length, p.playDeck.length, p.discardPile.length, p.cardsInPlay.length,
      p.siteDeck.length, p.killPile.length, p.companies.length,
      Object.keys(p.characters).length,
      mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc,
    );
  }
  return parts.join('|');
}

/**
 * How often one signature may recur before the playout is called a cycle.
 *
 * This is a *horizon* as much as it is a guard, which is why callers can
 * raise it. Under a uniform policy a signature recurs often for legitimate
 * reasons — the signature is coarse, and passing changes nothing in it — so
 * at 12 the guard, not `horizonTurns`, is what ends most playouts past two
 * turns (measured: 80% of 8-turn playouts stop here). A caller asking for a
 * deeper playout has to be able to say so.
 */
export const DEFAULT_CYCLE_LIMIT = 12;

/** Uniform choice from the candidate list. */
function uniformPolicy(actions: readonly GameAction[], random: () => number): GameAction {
  return actions[Math.floor(random() * actions.length)];
}

/**
 * Plays a state forward under `opts.policy` until the horizon, a terminal,
 * or a guard trips, and returns the tournament-score differential reached.
 */
export function rollout(start: GameState, opts: RolloutOptions): RolloutResult {
  const policy = opts.policy ?? uniformPolicy;
  const cycleLimit = opts.cycleLimit ?? DEFAULT_CYCLE_LIMIT;
  const endTurn = start.turnNumber + opts.horizonTurns;
  const seen = new Map<string, number>();
  let state = start;
  let decisions = 0;

  const finish = (end: RolloutEnd): RolloutResult => ({ tsd: stateTsd(state, opts.searcher), decisions, end });

  while (decisions < opts.maxDecisions) {
    if (state.phaseState.phase === Phase.GameOver) {
      const winner = (state.phaseState as { winner?: PlayerId | null }).winner ?? null;
      const tsd = winner === null ? 0 : winner === opts.searcher ? WIN_TSD : -WIN_TSD;
      return { tsd, decisions, end: 'game-over' };
    }
    if (state.turnNumber >= endTurn) return finish('horizon');

    const signature = stateSignature(state);
    const count = (seen.get(signature) ?? 0) + 1;
    if (count > cycleLimit) return finish('cycle');
    seen.set(signature, count);

    const next = acting(state, opts.playerIds);
    if (next === null) return finish('no-actions');

    const candidates = filterUnknownCardActions(next.actions, opts.unknownInstances);
    const result = reduce(state, policy(candidates, opts.random));
    if (result.error) return finish('engine-error');
    state = result.state;
    decisions++;
  }
  return finish('decision-cap');
}
