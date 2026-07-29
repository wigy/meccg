/**
 * @module ai/h2/core/tsd
 *
 * The common currency: tournament-score differential (TSD).
 *
 * ```text
 * TSD = computeTournamentScore(self, opp) - computeTournamentScore(opp, self)
 * ```
 *
 * Both terms come from the engine's own scorer, applied to *hypothetical* MP
 * totals. That is the whole upgrade over H1's `mp * 20`: marginal MP is not
 * linear. Under CoE §10.3 a marginal point can be worth 2 (the opponent has
 * none in that source, so the player's points double), 1, or **0** (the source
 * already sits at the half-total diversity cap). Adding a point can even move
 * the *opponent's* score, by removing the doubling they were enjoying. All of
 * that falls out of calling the real scorer on a projected total, and none of
 * it is visible to a linear weight.
 */

import { computeTournamentScore, MP_SOURCES } from '@meccg/shared';
import type { MarshallingPointTotals } from '@meccg/shared';
import type { Outcome } from './types.js';
import type { Tunables } from './tunables.js';

/** One of the six marshalling-point sources. */
export type MpSource = keyof MarshallingPointTotals;

/**
 * All six MP sources, in the order the tournament rules list them.
 * Re-exported from `@meccg/shared` so sim consumers need only one import.
 */
export { MP_SOURCES };

/** A hypothetical change to raw MP totals, by source. Omitted sources are 0. */
export type MpDelta = Partial<Record<MpSource, number>>;

/** Raw MP totals with a delta applied, leaving the input untouched. */
export function applyMpDelta(totals: MarshallingPointTotals, delta: MpDelta): MarshallingPointTotals {
  const out: Record<string, number> = {};
  for (const src of MP_SOURCES) out[src] = totals[src] + (delta[src] ?? 0);
  return out as unknown as MarshallingPointTotals;
}

/** Tournament-score differential from the perspective of the `self` totals. */
export function tsd(self: MarshallingPointTotals, opponent: MarshallingPointTotals): number {
  return computeTournamentScore(self, opponent) - computeTournamentScore(opponent, self);
}

/**
 * TSD after hypothetical MP changes on either side.
 *
 * Both deltas are applied before *either* score is computed, because the two
 * scores are coupled: the doubling rule reads the opponent's totals, so a
 * point gained by one player can change what the other player's points are
 * worth.
 */
export function tsdAfter(
  self: MarshallingPointTotals,
  opponent: MarshallingPointTotals,
  selfDelta: MpDelta = {},
  opponentDelta: MpDelta = {},
): number {
  return tsd(applyMpDelta(self, selfDelta), applyMpDelta(opponent, opponentDelta));
}

/**
 * What `amount` more raw MP in one source is actually worth, in TSD.
 *
 * This is the number every acquisition module asks for before spending a turn
 * chasing a source, and it is frequently **0**: a faction MP is worthless to a
 * player whose faction source is already capped at half their total. H1 has no
 * way to represent that and will happily spend a turn and a risky influence
 * check on it.
 */
export function marginalMpValue(
  self: MarshallingPointTotals,
  opponent: MarshallingPointTotals,
  source: MpSource,
  amount = 1,
): number {
  return tsdAfter(self, opponent, { [source]: amount }) - tsd(self, opponent);
}

/**
 * The three terms every outcome's TSD delta decomposes into (§2.3).
 *
 * Keeping potential and tempo explicit — rather than folding an optimistic
 * guess into `realized` — is the structural half of the anti-greed defence;
 * the horizon test is the empirical half.
 */
export interface TsdComponents {
  /** MP that actually move now, in TSD units. */
  readonly realized: number;
  /** MP unlocked but not yet banked, in TSD units, discounted by `γ`. */
  readonly potential?: number;
  /** Turns, taps and cards spent to get there, in TSD units. Positive = cost. */
  readonly tempo?: number;
}

/** Collapse the components into one TSD delta: `realized + γ·potential − tempo`. */
export function netTsdDelta(components: TsdComponents, tunables: Tunables): number {
  return components.realized
    + tunables.potentialDiscount * (components.potential ?? 0)
    - (components.tempo ?? 0);
}

/** Mean and standard deviation of an outcome distribution's TSD deltas. */
export function distributionStats(outcomes: readonly Outcome[]): { mean: number; sigma: number } {
  let mean = 0;
  for (const o of outcomes) mean += o.p * o.dtsd;
  let variance = 0;
  for (const o of outcomes) variance += o.p * (o.dtsd - mean) ** 2;
  return { mean, sigma: Math.sqrt(Math.max(0, variance)) };
}

/** Tolerance for the "probabilities sum to 1" invariant. */
const PROBABILITY_SUM_TOLERANCE = 1e-9;

/**
 * Assert an outcome distribution is well-formed: probabilities in [0, 1]
 * summing to 1, and no unreachable outcome. A module that cannot enumerate a
 * complete distribution is making a claim the calibration harness could never
 * check, so this throws rather than normalising silently.
 */
export function assertValidDistribution(outcomes: readonly Outcome[], moduleName: string): void {
  if (outcomes.length === 0) {
    throw new Error(`${moduleName}: outcome distribution is empty`);
  }
  let sum = 0;
  for (const o of outcomes) {
    if (!(o.p > 0) || o.p > 1) {
      throw new Error(`${moduleName}: outcome "${o.label}" has unreachable probability ${o.p}`);
    }
    sum += o.p;
  }
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    throw new Error(`${moduleName}: outcome probabilities sum to ${sum}, expected 1`);
  }
}
