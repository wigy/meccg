/**
 * @module cli/scoring-funnel.test
 *
 * The funnel decides whether the plan layer counts as progress, so the two
 * ways it could lie quietly both get a test.
 *
 * It could **inflate the denominator**, by counting candidates instead of
 * decisions: a site phase offering eleven `play-hero-resource` actions is one
 * opportunity to score, and counting eleven would divide every take-rate by
 * the branching factor. And it could **flatten the rank**, by reporting
 * absolute positions: 8th of 10 and 8th of 1000 are opposite findings, and the
 * whole "declined at rank 1.00, dead last, every time" result depends on the
 * difference.
 */

import { describe, test, expect } from 'vitest';
import type { GameAction } from '@meccg/shared';
import type { CandidateRecord } from '../types.js';
import { ScoringFunnel, bestRanks, fractionalRank } from './scoring-funnel.js';

/** A weighted candidate of the given type. */
function candidate(type: string, weight: number): CandidateRecord {
  return { type, weight };
}

/** The chosen action — the funnel reads nothing but its type. */
function chose(type: string): GameAction {
  return { type } as unknown as GameAction;
}

const TRACKED = ['play-hero-resource', 'enter-site', 'pass'];

describe('bestRanks', () => {
  test('ranks by descending weight regardless of the order it is given', () => {
    const ranks = bestRanks([
      candidate('enter-site', 0.1),
      candidate('pass', 0.7),
      candidate('play-hero-resource', 0.2),
    ]);
    expect(ranks.get('pass')).toBe(0);
    expect(ranks.get('play-hero-resource')).toBe(1);
    expect(ranks.get('enter-site')).toBe(2);
  });

  test('keeps a type at its best position, not its last', () => {
    const ranks = bestRanks([
      candidate('play-hero-resource', 0.9),
      candidate('pass', 0.5),
      candidate('play-hero-resource', 0.1),
    ]);
    expect(ranks.get('play-hero-resource')).toBe(0);
  });
});

describe('fractionalRank', () => {
  test('maps the top of any list to zero and the bottom to one', () => {
    expect(fractionalRank(0, 10)).toBe(0);
    expect(fractionalRank(9, 10)).toBe(1);
    expect(fractionalRank(999, 1000)).toBe(1);
  });

  test('separates the same absolute rank in lists of different lengths', () => {
    expect(fractionalRank(8, 10)).toBeCloseTo(0.889, 3);
    expect(fractionalRank(8, 1000)).toBeCloseTo(0.008, 3);
  });

  test('does not divide by zero on a list with nothing to rank', () => {
    expect(fractionalRank(0, 1)).toBe(0);
  });
});

describe('ScoringFunnel', () => {
  test('counts one offer per decision however many candidates share the type', () => {
    const funnel = new ScoringFunnel(TRACKED);
    funnel.record([
      candidate('play-hero-resource', 0.3),
      candidate('play-hero-resource', 0.2),
      candidate('play-hero-resource', 0.1),
      candidate('pass', 0.9),
    ], chose('pass'));

    expect(funnel.get('play-hero-resource')?.offered).toBe(1);
    expect(funnel.get('pass')?.offered).toBe(1);
  });

  test('records the take and leaves the rank unscored when the type was chosen', () => {
    const funnel = new ScoringFunnel(TRACKED);
    funnel.record(
      [candidate('play-hero-resource', 0.9), candidate('pass', 0.1)],
      chose('play-hero-resource'),
    );
    const tally = funnel.get('play-hero-resource');
    expect(tally?.taken).toBe(1);
    expect(tally?.meanDeclinedRank).toBeNull();
  });

  test('reports a fractional rank of one for a type declined at the bottom', () => {
    const funnel = new ScoringFunnel(TRACKED);
    for (let i = 0; i < 3; i++) {
      funnel.record([
        candidate('pass', 0.9),
        candidate('play-hero-resource', 0.5),
        candidate('enter-site', 0.1),
      ], chose('pass'));
    }
    const tally = funnel.get('enter-site');
    expect(tally?.offered).toBe(3);
    expect(tally?.taken).toBe(0);
    expect(tally?.meanDeclinedRank).toBe(1);
  });

  test('averages the rank only over the decisions that declined it', () => {
    const funnel = new ScoringFunnel(TRACKED);
    // Declined at the bottom of a three-candidate list…
    funnel.record([
      candidate('pass', 0.9), candidate('play-hero-resource', 0.5), candidate('enter-site', 0.1),
    ], chose('pass'));
    // …then taken, which must not be averaged in as a rank of zero.
    funnel.record([
      candidate('pass', 0.9), candidate('enter-site', 0.1),
    ], chose('enter-site'));

    const tally = funnel.get('enter-site');
    expect(tally?.offered).toBe(2);
    expect(tally?.taken).toBe(1);
    expect(tally?.meanDeclinedRank).toBe(1);
  });

  test('ignores forced decisions entirely', () => {
    const funnel = new ScoringFunnel(TRACKED);
    funnel.record([candidate('enter-site', 1)], chose('enter-site'));
    const tally = funnel.get('enter-site');
    expect(tally?.offered).toBe(0);
    expect(tally?.taken).toBe(0);
  });

  test('keeps a tracked type that never appears, because that is the finding', () => {
    const funnel = new ScoringFunnel(TRACKED);
    funnel.record([candidate('pass', 0.9), candidate('enter-site', 0.1)], chose('pass'));
    expect(funnel.get('play-hero-resource')).toEqual({
      offered: 0, taken: 0, meanDeclinedRank: null,
    });
  });

  test('ignores types it was not asked to track', () => {
    const funnel = new ScoringFunnel(TRACKED);
    funnel.record([candidate('split-company', 0.9), candidate('pass', 0.1)], chose('split-company'));
    expect(funnel.get('split-company')).toBeUndefined();
    expect(funnel.get('pass')?.offered).toBe(1);
  });

  test('tookAny is false until one of the given types is actually chosen', () => {
    const funnel = new ScoringFunnel(TRACKED);
    const scoring = ['play-hero-resource'];
    funnel.record([candidate('play-hero-resource', 0.1), candidate('pass', 0.9)], chose('pass'));
    expect(funnel.tookAny(scoring)).toBe(false);
    funnel.record([candidate('play-hero-resource', 0.9), candidate('pass', 0.1)],
      chose('play-hero-resource'));
    expect(funnel.tookAny(scoring)).toBe(true);
  });
});
