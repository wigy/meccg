/**
 * @module types
 *
 * Core types for the headless simulation harness: the agent seam that all
 * players (random, heuristic, and future learned agents) implement, and the
 * replay record types that capture a full game — every decision with its
 * weighted candidates, every phase/turn transition, and the final result —
 * as an ordered stream suitable for JSONL persistence, statistics
 * collection, text playback, and future machine-learning training data.
 */

import type {
  GameAction,
  PlayerView,
  CardDefinition,
  EvaluatedAction,
  PlayerId,
  GameEffect,
  MarshallingPointTotals,
} from '@meccg/shared';

// ---- Agent seam ----

/**
 * Everything an agent may observe when making a decision. The view is the
 * projected {@link PlayerView} — hidden information is already redacted, so
 * an agent can never cheat by reading the opponent's hand or deck.
 */
export interface AgentContext {
  /** The acting player's projected view of the game. */
  readonly view: PlayerView;
  /** The static card pool for resolving definitions. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** Viable actions only — the agent must return one of these. */
  readonly legalActions: readonly GameAction[];
  /** The full evaluated candidate list, including non-viable entries with reasons. */
  readonly evaluated: readonly EvaluatedAction[];
  /**
   * Seeded uniform [0, 1) stream owned by this agent for this game.
   * Agents must draw all randomness from here so games are reproducible.
   */
  readonly random: () => number;
}

/** A candidate action with the weight the agent assigned to it. */
export interface ConsideredAction {
  /** The candidate action. */
  readonly action: GameAction;
  /** Relative preference weight (need not be normalized). */
  readonly weight: number;
}

/**
 * An agent's decision: the chosen action plus, optionally, the full weighted
 * candidate list and a free-form note. The extras feed the decision log and
 * replay so the agent's reasoning is preserved alongside the game record.
 */
export interface AgentDecision {
  /** The chosen action — must be one of {@link AgentContext.legalActions}. */
  readonly action: GameAction;
  /** All candidates the agent weighed, for the decision transcript. */
  readonly considered?: readonly ConsideredAction[];
  /** Optional free-form remark about the reasoning (shown in transcripts). */
  readonly note?: string;
}

/** A game-playing agent. Implementations must be deterministic given the context. */
export interface Agent {
  /** Human-readable agent name (recorded in replays and statistics). */
  readonly name: string;
  /** Choose one of the viable actions. */
  chooseAction(context: AgentContext): AgentDecision;
  /**
   * Called once at the start of every game, before the first decision.
   *
   * Agents that carry per-game memory must clear it here. Harnesses reuse
   * one agent instance across a whole tournament, so state that is correct
   * within a game silently leaks between games otherwise — which both
   * corrupts play in later games and makes a failing game's seed
   * unreproducible on its own.
   */
  startGame?(): void;
}

// ---- Replay records ----

/** Identity of one player in a replay: who played, with what, driven by which agent. */
export interface ReplayPlayerInfo {
  /** Engine player ID (e.g. "p1"). */
  readonly id: PlayerId;
  /** Display name. */
  readonly name: string;
  /** Name of the agent that played this seat. */
  readonly agent: string;
  /** Catalog deck ID (e.g. "challenge-deck-a"). */
  readonly deckId: string;
  /** Deck display name. */
  readonly deckName: string;
  /** Deck alignment (hero / minion / fallen-wizard / balrog). */
  readonly alignment: string;
}

/** First record of every replay: identifies the game and makes it reproducible. */
export interface ReplayHeader {
  readonly kind: 'header';
  /** Replay format version, bumped on breaking changes. */
  readonly formatVersion: 1;
  /** ISO timestamp of when the game was played. */
  readonly createdAt: string;
  /** RNG seed — with the decks below, this makes the game bit-reproducible. */
  readonly seed: number;
  /** Both players in engine order (index 0 and 1). */
  readonly players: readonly [ReplayPlayerInfo, ReplayPlayerInfo];
  /** Decision cap the game was run with. */
  readonly maxDecisions: number;
}

/** Compact record of one weighted candidate at a decision point. */
export interface CandidateRecord {
  /** Action type discriminant. */
  readonly type: string;
  /** Canonical action ID (stable key for visit counts / training targets). */
  readonly actionId?: string;
  /** Weight the agent assigned. */
  readonly weight: number;
  /** Human-readable description — recorded for the top-weighted candidates. */
  readonly description?: string;
}

/**
 * One decision by one agent: the full context summary, the candidates that
 * were weighed, the chosen action, and the engine effects it produced.
 * This is the primary unit of both the text transcript and training data.
 */
export interface DecisionRecord {
  readonly kind: 'decision';
  /** 0-based decision counter within the game. */
  readonly seq: number;
  /** Engine state sequence number before the action was applied. */
  readonly stateSeq: number;
  /** Turn number the decision was made in. */
  readonly turn: number;
  /** Phase the decision was made in. */
  readonly phase: string;
  /** Setup step, when in the setup phase. */
  readonly step?: string;
  /** Acting player. */
  readonly player: PlayerId;
  /** Acting player's display name. */
  readonly playerName: string;
  /** Agent that made the decision. */
  readonly agent: string;
  /** Number of viable actions offered (the branching factor). */
  readonly viableCount: number;
  /** Total candidates including non-viable ones. */
  readonly candidateCount: number;
  /** Weighted candidates the agent considered (viable ones). */
  readonly candidates?: readonly CandidateRecord[];
  /** The chosen action, verbatim — replaying these reproduces the game. */
  readonly action: GameAction;
  /** Canonical ID of the chosen action. */
  readonly actionId?: string;
  /** Human-readable description of the chosen action. */
  readonly description: string;
  /** Agent's free-form reasoning note, if any. */
  readonly note?: string;
  /** Visual effects the reducer emitted (dice rolls, notifications). */
  readonly effects?: readonly GameEffect[];
  /** Wall-clock milliseconds the agent spent deciding. */
  readonly thinkMs: number;
}

/**
 * Emitted whenever the phase or turn changes as a result of a decision.
 * Carries a public score snapshot so score progression can be charted
 * without re-simulating.
 */
export interface TransitionRecord {
  readonly kind: 'transition';
  /** Decision counter at the time of the transition. */
  readonly seq: number;
  /** Turn number after the transition. */
  readonly turn: number;
  /** Phase after the transition. */
  readonly phase: string;
  /** Setup step after the transition, when in setup. */
  readonly step?: string;
  /** Active player after the transition. */
  readonly activePlayer: PlayerId | null;
  /** Tournament scores by player index (doubling rule applied). */
  readonly scores: readonly [number, number];
  /** Raw marshalling point totals by player index. */
  readonly marshallingPoints: readonly [MarshallingPointTotals, MarshallingPointTotals];
}

/** How the simulated game ended. */
export type GameOutcome = 'completed' | 'decision-limit' | 'deadlock' | 'engine-error';

/** Final record of a replay: outcome, winner, and the per-game statistics. */
export interface GameResultRecord {
  readonly kind: 'result';
  /** How the game ended (`completed` = reached the game-over phase). */
  readonly outcome: GameOutcome;
  /** Winner's player ID, or null for a draw / non-completed game. */
  readonly winner: PlayerId | null;
  /** Win reason from the engine, when completed. */
  readonly winReason?: string;
  /** Final scores keyed by player ID, when completed. */
  readonly finalScores?: Readonly<Record<string, number>>;
  /** Total decisions made. */
  readonly decisions: number;
  /** Total turns played. */
  readonly turns: number;
  /** Wall-clock duration of the simulated game in milliseconds. */
  readonly durationMs: number;
  /** Error detail for `deadlock` / `engine-error` outcomes. */
  readonly error?: string;
  /** Per-game statistics (see {@link module:stats}). */
  readonly stats: GameStatsSummary;
}

/** Any line of a replay file. */
export type ReplayRecord = ReplayHeader | DecisionRecord | TransitionRecord | GameResultRecord;

/**
 * Observer hooks the runner calls as the game progresses. Used by the
 * replay writer, the statistics collector, and the live transcript printer.
 */
export interface GameObserver {
  onHeader?(header: ReplayHeader): void;
  onDecision?(record: DecisionRecord): void;
  onTransition?(record: TransitionRecord): void;
  onResult?(record: GameResultRecord): void;
}

// ---- Statistics ----

/** Summary statistics of a numeric distribution. */
export interface DistributionSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
}

/** Per-game statistics embedded in the result record and aggregated by the bench. */
export interface GameStatsSummary {
  /** RNG seed of the game. */
  readonly seed: number;
  /** Total decisions made. */
  readonly decisions: number;
  /** Total turns played. */
  readonly turns: number;
  /** Wall-clock game duration in milliseconds. */
  readonly durationMs: number;
  /** Agent think time in milliseconds, by player index. */
  readonly thinkMsByPlayer: readonly [number, number];
  /** Decisions made per phase. */
  readonly decisionsByPhase: Readonly<Record<string, number>>;
  /** Decisions made per player index. */
  readonly decisionsByPlayer: readonly [number, number];
  /** Chosen action counts by action type. */
  readonly actionTypes: Readonly<Record<string, number>>;
  /** Branching factor (viable actions per decision) distribution. */
  readonly branching: DistributionSummary;
  /** Branching factor histogram over fixed buckets. */
  readonly branchingHistogram: Readonly<Record<string, number>>;
  /** Counts of engine effects by type (dice rolls, notifications). */
  readonly effectCounts: Readonly<Record<string, number>>;
  /** Histogram of 2d6 roll totals observed in dice-roll effects. */
  readonly diceTotals: Readonly<Record<string, number>>;
  /** Tournament score trajectory: one entry per turn, by player index. */
  readonly scoreByTurn: readonly { readonly turn: number; readonly scores: readonly [number, number] }[];
}
