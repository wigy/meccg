/**
 * @module stats
 *
 * Statistics collection for simulated games. A {@link StatsCollector}
 * consumes runner observer events for one game and produces a
 * {@link GameStatsSummary}; {@link aggregateStats} folds many game
 * summaries into cross-game aggregates (win rates, throughput, branching
 * and length distributions). Everything is plain JSON so the numbers can
 * be archived alongside replays and compared across engine versions.
 */

import type {
  DecisionRecord,
  DistributionSummary,
  GameResultRecord,
  GameStatsSummary,
  GameOutcome,
  TransitionRecord,
} from './types.js';

/** Branching-factor histogram bucket edges (inclusive upper bounds). */
const BRANCHING_BUCKETS: readonly { readonly label: string; readonly max: number }[] = [
  { label: '1', max: 1 },
  { label: '2', max: 2 },
  { label: '3-5', max: 5 },
  { label: '6-10', max: 10 },
  { label: '11-20', max: 20 },
  { label: '21-50', max: 50 },
  { label: '51-100', max: 100 },
  { label: '101+', max: Infinity },
];

/** Summarize a numeric sample into min/max/mean/percentiles. */
export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p99: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    p50: pct(50),
    p90: pct(90),
    p99: pct(99),
  };
}

/** Collects per-game statistics from runner events. */
export class StatsCollector {
  private readonly seed: number;
  private readonly branchingValues: number[] = [];
  private readonly decisionsByPhase: Record<string, number> = {};
  private readonly decisionsByPlayer: [number, number] = [0, 0];
  private readonly thinkMsByPlayer: [number, number] = [0, 0];
  private readonly actionTypes: Record<string, number> = {};
  private readonly effectCounts: Record<string, number> = {};
  private readonly diceTotals: Record<string, number> = {};
  private readonly scoreByTurn: { turn: number; scores: [number, number] }[] = [];
  private decisions = 0;
  private lastTurn = 0;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Record one decision. `playerIndex` is the acting player's engine index. */
  onDecision(record: DecisionRecord, playerIndex: number): void {
    this.decisions++;
    this.branchingValues.push(record.viableCount);
    this.decisionsByPhase[record.phase] = (this.decisionsByPhase[record.phase] ?? 0) + 1;
    this.decisionsByPlayer[playerIndex]++;
    this.thinkMsByPlayer[playerIndex] += record.thinkMs;
    this.actionTypes[record.action.type] = (this.actionTypes[record.action.type] ?? 0) + 1;
    for (const effect of record.effects ?? []) {
      this.effectCounts[effect.effect] = (this.effectCounts[effect.effect] ?? 0) + 1;
      if (effect.effect === 'dice-roll') {
        const total = effect.die1 + effect.die2;
        this.diceTotals[String(total)] = (this.diceTotals[String(total)] ?? 0) + 1;
      }
    }
  }

  /** Record a phase/turn transition (score trajectory is sampled per turn). */
  onTransition(record: TransitionRecord): void {
    if (record.turn !== this.lastTurn) {
      this.lastTurn = record.turn;
      this.scoreByTurn.push({ turn: record.turn, scores: [record.scores[0], record.scores[1]] });
    } else if (this.scoreByTurn.length > 0) {
      // Keep the latest score snapshot for the current turn.
      this.scoreByTurn[this.scoreByTurn.length - 1].scores = [record.scores[0], record.scores[1]];
    }
  }

  /** Produce the per-game summary. */
  summary(turns: number, durationMs: number): GameStatsSummary {
    const histogram: Record<string, number> = {};
    for (const value of this.branchingValues) {
      const bucket = BRANCHING_BUCKETS.find(b => value <= b.max) ?? BRANCHING_BUCKETS[BRANCHING_BUCKETS.length - 1];
      histogram[bucket.label] = (histogram[bucket.label] ?? 0) + 1;
    }
    return {
      seed: this.seed,
      decisions: this.decisions,
      turns,
      durationMs,
      thinkMsByPlayer: [this.thinkMsByPlayer[0], this.thinkMsByPlayer[1]],
      decisionsByPhase: this.decisionsByPhase,
      decisionsByPlayer: [this.decisionsByPlayer[0], this.decisionsByPlayer[1]],
      actionTypes: this.actionTypes,
      branching: summarizeDistribution(this.branchingValues),
      branchingHistogram: histogram,
      effectCounts: this.effectCounts,
      diceTotals: this.diceTotals,
      scoreByTurn: this.scoreByTurn,
    };
  }
}

/** Cross-game aggregate statistics produced by benches and tournaments. */
export interface AggregateStats {
  /** Number of games aggregated. */
  readonly games: number;
  /** Wall-clock time for the whole batch in milliseconds. */
  readonly wallMs: number;
  /** Games per second over the batch wall clock. */
  readonly gamesPerSec: number;
  /** Decisions per second over the batch wall clock. */
  readonly decisionsPerSec: number;
  /** Outcome counts (completed / decision-limit / deadlock / engine-error). */
  readonly outcomes: Readonly<Record<GameOutcome, number>>;
  /** Wins by player index, plus draws (completed games only). */
  readonly winsByPlayer: readonly [number, number];
  readonly draws: number;
  /** Win reason counts (completed games only). */
  readonly winReasons: Readonly<Record<string, number>>;
  /** Distribution of decisions per game. */
  readonly decisionsPerGame: DistributionSummary;
  /** Distribution of turns per game. */
  readonly turnsPerGame: DistributionSummary;
  /** Distribution of branching factors across all decisions of all games. */
  readonly branchingMeanPerGame: DistributionSummary;
  /** Maximum branching factor observed anywhere in the batch. */
  readonly branchingMax: number;
  /** Summed branching histogram across all games. */
  readonly branchingHistogram: Readonly<Record<string, number>>;
  /** Summed chosen-action-type counts across all games. */
  readonly actionTypes: Readonly<Record<string, number>>;
  /** Summed decisions-per-phase counts across all games. */
  readonly decisionsByPhase: Readonly<Record<string, number>>;
  /** Summed dice-roll totals histogram. */
  readonly diceTotals: Readonly<Record<string, number>>;
}

/** Fold game results into cross-game aggregates. */
export function aggregateStats(
  results: readonly { readonly result: GameResultRecord; readonly winnerIndex: number | null }[],
  wallMs: number,
): AggregateStats {
  const outcomes: Record<GameOutcome, number> = { 'completed': 0, 'decision-limit': 0, 'deadlock': 0, 'engine-error': 0 };
  const winsByPlayer: [number, number] = [0, 0];
  let draws = 0;
  const winReasons: Record<string, number> = {};
  const actionTypes: Record<string, number> = {};
  const decisionsByPhase: Record<string, number> = {};
  const branchingHistogram: Record<string, number> = {};
  const diceTotals: Record<string, number> = {};
  let totalDecisions = 0;
  let branchingMax = 0;

  for (const { result, winnerIndex } of results) {
    outcomes[result.outcome]++;
    totalDecisions += result.decisions;
    if (result.outcome === 'completed') {
      if (winnerIndex === null) draws++;
      else winsByPlayer[winnerIndex]++;
      if (result.winReason) winReasons[result.winReason] = (winReasons[result.winReason] ?? 0) + 1;
    }
    const stats = result.stats;
    branchingMax = Math.max(branchingMax, stats.branching.max);
    for (const [k, v] of Object.entries(stats.actionTypes)) actionTypes[k] = (actionTypes[k] ?? 0) + v;
    for (const [k, v] of Object.entries(stats.decisionsByPhase)) decisionsByPhase[k] = (decisionsByPhase[k] ?? 0) + v;
    for (const [k, v] of Object.entries(stats.branchingHistogram)) branchingHistogram[k] = (branchingHistogram[k] ?? 0) + v;
    for (const [k, v] of Object.entries(stats.diceTotals)) diceTotals[k] = (diceTotals[k] ?? 0) + v;
  }

  return {
    games: results.length,
    wallMs,
    gamesPerSec: wallMs > 0 ? (results.length * 1000) / wallMs : 0,
    decisionsPerSec: wallMs > 0 ? (totalDecisions * 1000) / wallMs : 0,
    outcomes,
    winsByPlayer,
    draws,
    winReasons,
    decisionsPerGame: summarizeDistribution(results.map(r => r.result.decisions)),
    turnsPerGame: summarizeDistribution(results.map(r => r.result.turns)),
    branchingMeanPerGame: summarizeDistribution(results.map(r => r.result.stats.branching.mean)),
    branchingMax,
    branchingHistogram,
    actionTypes,
    decisionsByPhase,
    diceTotals,
  };
}
