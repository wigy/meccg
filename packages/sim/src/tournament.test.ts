/**
 * @module tournament.test
 *
 * The paired Elo interval. A gate plays every seed twice, once per seating,
 * from one RNG stream — so whatever the seed and the seating are worth is
 * common to both games of a pair and cancels inside it. These tests are about
 * that cancellation: it must happen when the pairing is intact, and must not be
 * faked when it is not.
 */

import { describe, test, expect } from 'vitest';
import {
  estimateEloDiff, estimatePairedEloDiff, MIN_PAIRS_FOR_INTERVAL,
} from './tournament.js';
import type { TournamentGameRecord } from './tournament.js';

const CHALLENGER = 'challenger';
const CHAMPION = 'champion';

/** One completed game record, seated as the arrangement says. */
function game(seed: number, arrangement: 0 | 1, challengerWon: boolean): TournamentGameRecord {
  return {
    round: 0,
    seed,
    seats: arrangement === 0 ? [CHALLENGER, CHAMPION] : [CHAMPION, CHALLENGER],
    outcome: 'completed',
    winner: challengerWon ? CHALLENGER : CHAMPION,
    decisions: 100,
    turns: 10,
  };
}

/** `count` seeds, each played both seatings, with the given per-pair scores. */
function schedule(results: readonly (readonly [boolean, boolean])[]): TournamentGameRecord[] {
  return results.flatMap(([asFirst, asSecond], seed) => [
    game(seed, 0, asFirst),
    game(seed, 1, asSecond),
  ]);
}

describe('the paired interval', () => {
  test('a seating effect that decides every game cancels to no uncertainty at all', () => {
    // The pathological case the pairing exists for: whoever sits second wins,
    // every time, and the agents are identical. Per game that reads as a 50%
    // score with full binomial variance; per pair every seed scores exactly
    // 0.5, so the interval collapses.
    const games = schedule(Array.from({ length: 30 }, () => [false, true] as const));

    const paired = estimatePairedEloDiff(games, CHALLENGER)!;
    expect(paired.score).toBeCloseTo(0.5, 9);
    expect(paired.high - paired.low).toBeCloseTo(0, 9);

    const unpaired = estimateEloDiff(30, 0, 30);
    expect(unpaired.high - unpaired.low).toBeGreaterThan(100);
  });

  test('it is never wider than the per-game interval on the same games', () => {
    // Half the seeds split, the rest the challenger takes outright.
    const games = schedule([
      ...Array.from({ length: 15 }, () => [true, false] as const),
      ...Array.from({ length: 15 }, () => [true, true] as const),
    ]);

    const paired = estimatePairedEloDiff(games, CHALLENGER)!;
    const unpaired = estimateEloDiff(45, 0, 15);

    expect(paired.score).toBeCloseTo(unpaired.score, 9);
    expect(paired.high - paired.low).toBeLessThanOrEqual(unpaired.high - unpaired.low);
  });

  test('a seed whose other seating did not complete is dropped, not half-counted', () => {
    // Counting a one-sided seed would put the seating effect back in
    // uncancelled, which is the whole thing being removed.
    const games = schedule(Array.from({ length: 25 }, () => [true, false] as const));
    games.push({
      round: 0,
      seed: 999,
      seats: [CHALLENGER, CHAMPION],
      outcome: 'decision-limit',
      winner: null,
      decisions: 25000,
      turns: 2503,
      error: 'decision limit of 25000 reached',
    });
    games.push(game(998, 0, true)); // completed, but its pair never played

    const paired = estimatePairedEloDiff(games, CHALLENGER)!;
    expect(paired.games).toBe(50);
    expect(paired.score).toBeCloseTo(0.5, 9);
  });

  test('too few complete pairs returns null rather than a tight interval on nothing', () => {
    const games = schedule(
      Array.from({ length: MIN_PAIRS_FOR_INTERVAL - 1 }, () => [true, false] as const),
    );
    expect(estimatePairedEloDiff(games, CHALLENGER)).toBeNull();
  });

  test('draws score a half for each side', () => {
    const games = schedule(Array.from({ length: 25 }, () => [true, false] as const));
    for (const record of games) {
      (record as { winner: string | null }).winner = null;
    }
    const paired = estimatePairedEloDiff(games, CHALLENGER)!;
    expect(paired.score).toBeCloseTo(0.5, 9);
  });
});
