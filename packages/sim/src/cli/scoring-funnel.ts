/**
 * @module cli/scoring-funnel
 *
 * The tally behind `scoring-loop`: how often was an action type on the table,
 * and how often was it taken?
 *
 * Kept apart from the CLI because it is the metric the whole plan-layer spec
 * is judged on (`specs/2026-08-11-h2-plan-layer.md` §8), and a metric that
 * decides whether later work counts as progress has to be tested rather than
 * eyeballed. Two things it has to get right:
 *
 * - **Offered is per decision, not per candidate.** A site phase offering
 *   eleven different `play-hero-resource` actions is *one* opportunity to
 *   score, not eleven. Counting candidates would divide the take-rate by the
 *   branching factor and make a module that always scores look like one that
 *   never does.
 * - **Rank is fractional.** Branching here spans two orders of magnitude — the
 *   observed maximum is over a thousand candidates — so an absolute rank of 8
 *   means "narrowly declined" in one decision and "dead last" in another. Zero
 *   is the top of the ranking and one is the bottom, whatever its length.
 */

import type { GameAction } from '@meccg/shared';
import type { CandidateRecord } from '../types.js';

/** Offered/taken counts for one action type. */
export interface ActionTally {
  /** Contested decisions where at least one candidate had this type. */
  readonly offered: number;
  /** Decisions where the agent chose an action of this type. */
  readonly taken: number;
  /** Mean fractional rank of the type's best candidate when it was declined. */
  readonly meanDeclinedRank: number | null;
}

/**
 * The best (lowest) rank each action type reaches in a weighted candidate list.
 *
 * `candidates` arrives in the agent's own order, which is not guaranteed
 * sorted, so the ranking is recomputed here rather than assumed.
 */
export function bestRanks(candidates: readonly CandidateRecord[]): Map<string, number> {
  const ranked = [...candidates].sort((a, b) => b.weight - a.weight);
  const best = new Map<string, number>();
  ranked.forEach((candidate, index) => {
    if (!best.has(candidate.type)) best.set(candidate.type, index);
  });
  return best;
}

/**
 * Rank as a fraction of the list, so lists of different lengths compare.
 *
 * A single-candidate list has no ranking to speak of and reports zero rather
 * than dividing by it — but such a decision never reaches here, because a
 * forced decision is not an opportunity declined.
 */
export function fractionalRank(rank: number, count: number): number {
  return count > 1 ? rank / (count - 1) : 0;
}

/** Mutable accumulator for one action type. */
interface Counters {
  offered: number;
  taken: number;
  declinedRankSum: number;
  declinedRanked: number;
}

/** Offered-versus-taken over a run, for a fixed set of action types. */
export class ScoringFunnel {
  private readonly counters = new Map<string, Counters>();

  /**
   * @param tracked Action types to tally. Fixed up front so the report has a
   *   stable shape — a type that never appears must still print, since "never
   *   offered" is the finding this exists to surface.
   */
  constructor(tracked: readonly string[]) {
    for (const type of tracked) {
      this.counters.set(type, { offered: 0, taken: 0, declinedRankSum: 0, declinedRanked: 0 });
    }
  }

  /**
   * Fold one decision into the tally.
   *
   * Forced decisions are ignored outright: with one candidate there is nothing
   * to offer and nothing to decline, and counting them would report agreement
   * that was never in question.
   */
  record(candidates: readonly CandidateRecord[], chosen: GameAction): void {
    if (candidates.length <= 1) return;
    for (const [type, rank] of bestRanks(candidates)) {
      const counters = this.counters.get(type);
      if (counters === undefined) continue;
      counters.offered++;
      if (chosen.type === type) {
        counters.taken++;
      } else {
        counters.declinedRankSum += fractionalRank(rank, candidates.length);
        counters.declinedRanked++;
      }
    }
  }

  /** The tally for one type, or undefined if it is not tracked. */
  get(type: string): ActionTally | undefined {
    const counters = this.counters.get(type);
    if (counters === undefined) return undefined;
    return {
      offered: counters.offered,
      taken: counters.taken,
      meanDeclinedRank: counters.declinedRanked === 0
        ? null
        : counters.declinedRankSum / counters.declinedRanked,
    };
  }

  /** True when the run took at least one of the given types. */
  tookAny(types: readonly string[]): boolean {
    return types.some(type => (this.counters.get(type)?.taken ?? 0) > 0);
  }
}
