/**
 * @module ai/h2/services/standing.test
 *
 * The P0 exit criterion: `standing` reports the correct marginal MP value per
 * source on hand-built cases. These are the positions where H1's linear
 * `mp * 20` gives the wrong answer outright — a capped source it would chase,
 * a doubled source it would undervalue by half.
 */

import { describe, test, expect } from 'vitest';
import { computeStanding } from './standing.js';
import { DEFAULT_TUNABLES } from '../core/tunables.js';
import { collectTunables } from '../core/rationale.js';
import { testStandingView, testWinProbModel } from '../test-support.js';

const MODEL = testWinProbModel();

describe('standing', () => {
  test('reports the score, the differential and the turn', () => {
    const view = testStandingView({ character: 4, item: 4 }, { character: 3, item: 3 }, 14);
    const standing = computeStanding(view, MODEL, DEFAULT_TUNABLES);
    expect(standing.selfScore).toBe(8);
    expect(standing.opponentScore).toBe(6);
    expect(standing.tsd).toBe(2);
    expect(standing.turnNumber).toBe(14);
  });

  test('values a capped source at zero', () => {
    // Character is exactly half of a 12-point total, so a seventh character
    // point is capped straight back off. H1 would still spend a turn on it.
    const standing = computeStanding(
      testStandingView(
        { character: 6, item: 2, faction: 2, ally: 2 },
        { character: 3, item: 3, faction: 3, ally: 3 },
        14,
      ),
      MODEL,
      DEFAULT_TUNABLES,
    );
    expect(standing.marginal.character).toBe(0);
    expect(standing.marginal.item).toBe(1);
  });

  test('values a doubled source at two', () => {
    // The opponent has no allies, so every ally point of ours counts twice.
    const standing = computeStanding(
      testStandingView(
        { character: 3, item: 3, faction: 3, ally: 3 },
        { character: 3, item: 3, faction: 3, ally: 0 },
        14,
      ),
      MODEL,
      DEFAULT_TUNABLES,
    );
    expect(standing.marginal.ally).toBe(2);
    expect(standing.marginal.character).toBe(1);
  });

  test('projects hypothetical plays through the real scorer, both sides at once', () => {
    const view = testStandingView(
      { character: 4, item: 4, faction: 4, ally: 4 },
      { character: 4, item: 4, faction: 4, ally: 0 },
      10,
    );
    const standing = computeStanding(view, MODEL, DEFAULT_TUNABLES);
    expect(standing.tsd).toBe(8);
    expect(standing.tsdAfter({ item: 1 })).toBe(9);
    // The opponent's *first* ally point costs us five: it ends the doubling
    // our four allies were enjoying. A per-source linear weight cannot see
    // that a point in the opponent's hand is worth more than a point in ours.
    expect(standing.tsdAfter({}, { ally: 1 })).toBe(3);
  });

  test('derives the risk posture from the standing', () => {
    const trailing = computeStanding(testStandingView({ character: 2, item: 2 }, { character: 8, item: 8 }, 30), MODEL, DEFAULT_TUNABLES);
    const leading = computeStanding(testStandingView({ character: 8, item: 8 }, { character: 2, item: 2 }, 30), MODEL, DEFAULT_TUNABLES);
    expect(trailing.risk.lambda).toBeGreaterThan(0);
    expect(leading.risk.lambda).toBeLessThan(0);
    expect(trailing.risk.lambda).toBeCloseTo(-leading.risk.lambda, 12);
  });

  test('converts outcome distributions into win-probability deltas', () => {
    const standing = computeStanding(testStandingView({ character: 4 }, { character: 4 }, 20), MODEL, DEFAULT_TUNABLES);
    const scored = standing.score([
      { p: 0.6, label: 'succeeds', dtsd: 3 },
      { p: 0.4, label: 'fails', dtsd: -1 },
    ]);
    expect(scored.expectedTsd).toBeCloseTo(0.6 * 3 + 0.4 * -1, 12);
    expect(scored.utility).toBeGreaterThan(0);
    expect(scored.method).toBe('integrated');
  });

  test('explains itself, naming the constant behind the risk posture', () => {
    const standing = computeStanding(testStandingView({ character: 4 }, { faction: 9 }, 12), MODEL, DEFAULT_TUNABLES);
    const rationale = standing.rationale();
    expect(rationale.value).toBe(standing.tsd);
    expect(collectTunables(rationale).has('riskCurvatureScale')).toBe(true);
    const sources = rationale.children?.find(c => c.label.startsWith('marginal value'));
    expect(sources?.children?.map(c => c.label)).toEqual(
      ['character', 'item', 'faction', 'ally', 'kill', 'misc'],
    );
  });
});
