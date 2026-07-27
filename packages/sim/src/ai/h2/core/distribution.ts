/**
 * @module ai/h2/core/distribution
 *
 * Composing independent outcome distributions.
 *
 * A single strike is one distribution; an attack is several of them in a row.
 * Summing their expectations would lose the spread, and spread is exactly what
 * the risk oracle integrates over — a player who is behind should be willing
 * to face a four-strike attack precisely *because* it might go well. So the
 * distributions are convolved rather than averaged.
 *
 * The joint space grows multiplicatively, so outcomes are merged into buckets
 * once they exceed a cap. The cap and the merge are reported by the caller in
 * its rationale: a truncated enumeration must never be mistaken for an
 * exhaustive one.
 */

import type { Outcome } from './types.js';

/** Width of the TSD buckets outcomes are merged into once the cap is hit. */
const BUCKET_WIDTH = 0.25;

/** Default ceiling on the number of composite outcomes carried forward. */
export const DEFAULT_MAX_OUTCOMES = 64;

/** Merge outcomes whose TSD deltas fall in the same bucket. */
function merge(outcomes: readonly Outcome[]): Outcome[] {
  const buckets = new Map<number, { p: number; weighted: number; label: string }>();
  for (const outcome of outcomes) {
    const key = Math.round(outcome.dtsd / BUCKET_WIDTH);
    const existing = buckets.get(key);
    if (existing) {
      existing.p += outcome.p;
      existing.weighted += outcome.p * outcome.dtsd;
    } else {
      buckets.set(key, { p: outcome.p, weighted: outcome.p * outcome.dtsd, label: outcome.label });
    }
  }
  return [...buckets.entries()]
    .map(([, b]) => ({ p: b.p, label: b.label, dtsd: b.weighted / b.p }))
    .sort((a, b) => b.dtsd - a.dtsd);
}

/** Whether merging was needed to stay inside the cap. */
export interface ConvolutionResult {
  /** The composed distribution. */
  readonly outcomes: readonly Outcome[];
  /** True when outcomes were bucketed to respect the cap. */
  readonly merged: boolean;
}

/**
 * Convolve independent distributions: the joint outcome of taking all of them,
 * with TSD deltas added.
 *
 * Labels of the composite outcomes describe the branch that produced them,
 * which keeps `explain` readable without pretending the enumeration is a
 * complete narration of a four-strike combat.
 */
export function convolveOutcomes(
  distributions: readonly (readonly Outcome[])[],
  maxOutcomes: number = DEFAULT_MAX_OUTCOMES,
): ConvolutionResult {
  let current: Outcome[] = [{ p: 1, label: 'nothing happens', dtsd: 0 }];
  let merged = false;

  for (const [index, distribution] of distributions.entries()) {
    const next: Outcome[] = [];
    for (const left of current) {
      for (const right of distribution) {
        next.push({
          p: left.p * right.p,
          label: index === 0 ? right.label : `${left.label}; then ${right.label}`,
          dtsd: left.dtsd + right.dtsd,
        });
      }
    }
    current = next;
    if (current.length > maxOutcomes) {
      current = merge(current);
      merged = true;
    }
  }

  // Drop branches that cannot happen, so the distribution satisfies the core
  // invariant that every listed outcome is reachable.
  return { outcomes: current.filter(o => o.p > 0), merged };
}
