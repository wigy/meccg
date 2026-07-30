/**
 * @module cli/divergence-cost.test
 *
 * The two things the price has to get right are the sign and the absence.
 *
 * The sign, because the whole point is a work list ordered by loss, and a
 * flipped subtraction would rank the action types the agent gets *right* at the
 * top. The absence, because a shortlisting driver never scores most of the
 * candidate list, and pricing an unexamined move at zero would quietly report
 * "this costs nothing" for every decision the driver declined to look at.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction } from '@meccg/shared';
import type { AgentDecision } from '../types.js';
import { DivergenceCost, UNITLESS, preferred, priceOf } from './divergence-cost.js';

const BEST = { type: 'pass' } as unknown as GameAction;
const WORSE = { type: 'pass' } as unknown as GameAction;
const UNSEARCHED = { type: 'discard-card' } as unknown as GameAction;

/** A searched decision that ranked `BEST` at 4 tsd and `WORSE` at 1.5. */
function decision(): AgentDecision {
  return {
    action: BEST,
    weightUnit: 'tsd',
    considered: [{ action: BEST, weight: 4 }, { action: WORSE, weight: 1.5 }],
  };
}

describe('pricing one divergence', () => {
  test('is what the driver thinks the shadow gave up, so it is positive', () => {
    expect(priceOf(decision(), BEST, WORSE)).toBeCloseTo(2.5, 12);
  });

  test('is null when the driver never scored the shadow-s move', () => {
    // `mc` caps its shortlist, so most candidates are never played forward.
    // Zero would read as "worth nothing"; this reads as "not measured".
    expect(priceOf(decision(), BEST, UNSEARCHED)).toBeNull();
  });

  test('is null when the driver published no ranking at all', () => {
    expect(priceOf({ action: BEST }, BEST, WORSE)).toBeNull();
  });
});

describe('the preferred action', () => {
  test('is the argmax of the reported weights, not the sampled move', () => {
    // The driver may have sampled; a comparison of samples measures the dice.
    expect(preferred({ action: WORSE, considered: decision().considered })).toBe(BEST);
  });

  test('falls back to the chosen action when nothing was reported', () => {
    expect(preferred({ action: WORSE })).toBe(WORSE);
  });
});

describe('the cost table', () => {
  test('separates priced divergences from unranked ones', () => {
    const cost = new DivergenceCost();
    cost.record(decision(), WORSE, () => 'x');
    cost.record(decision(), UNSEARCHED, () => 'x');
    const bucket = cost.buckets.get('tsd')!;
    const entry = bucket.byType.get('pass')!;
    expect(entry.divergences).toBe(2);
    expect(entry.priced).toBe(1);
    expect(entry.unranked).toBe(1);
    expect(entry.total).toBeCloseTo(2.5, 12);
    // An unranked divergence contributes no cost, so it cannot dilute a mean.
    expect(bucket.total()).toBeCloseTo(2.5, 12);
    expect(bucket.priced).toHaveLength(1);
  });

  test('ranks action types by total cost, dearest first', () => {
    const cost = new DivergenceCost();
    const cheap: AgentDecision = {
      action: UNSEARCHED,
      weightUnit: 'tsd',
      considered: [{ action: UNSEARCHED, weight: 1 }, { action: WORSE, weight: 0.9 }],
    };
    cost.record(cheap, WORSE, () => 'x');
    cost.record(decision(), WORSE, () => 'x');
    expect(cost.buckets.get('tsd')!.ranked().map(([type]) => type)).toEqual(['pass', 'discard-card']);
  });
});

describe('unit systems are never pooled', () => {
  // `mc` delegates every view it cannot determinize and hands back the
  // fallback's weights. Adding those to its own mean-TSD numbers would report
  // H1's weight soup as though it were tournament score.
  test('a delegated decision lands in its own bucket', () => {
    const cost = new DivergenceCost();
    cost.record(decision(), WORSE, () => 'x');
    cost.record({ action: BEST, considered: decision().considered }, WORSE, () => 'x');
    expect(cost.buckets.get('tsd')!.total()).toBeCloseTo(2.5, 12);
    expect(cost.buckets.get(UNITLESS)!.total()).toBeCloseTo(2.5, 12);
  });

  test('quantified units are reported before unitless ones', () => {
    const cost = new DivergenceCost();
    cost.record({ action: BEST, considered: decision().considered }, WORSE, () => 'x');
    cost.record(decision(), WORSE, () => 'x');
    expect(cost.units()).toEqual(['tsd', UNITLESS]);
  });
});
