/**
 * @module elo.test
 *
 * Elo rating arithmetic: expectation, K-factor tiers, simultaneous updates,
 * and the idempotency that keeps a replayed game log from double-counting.
 */

import { describe, it, expect } from 'vitest';
import {
  INITIAL_RATING, K_ESTABLISHED, K_PROVISIONAL, PROVISIONAL_GAMES,
  applyRatedGame, expectedScore, hasRatedGame, initialRating, kFactor,
} from './elo.js';
import type { PlayerRating, RatedGameResult } from './elo.js';

const GAME: RatedGameResult = {
  gameId: 'abc-1234',
  endedAt: '2026-08-13T12:00:00.000Z',
  winner: 'Alice',
};

/** A rating with an established (non-provisional) game count. */
function established(name: string, rating: number): PlayerRating {
  return {
    ...initialRating(name, true),
    rating,
    peak: rating,
    games: PROVISIONAL_GAMES,
    provisional: false,
  };
}

describe('expectedScore', () => {
  it('is even between equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });

  it('gives a 400-point favourite roughly a 10:1 expected score', () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(10 / 11, 6);
  });

  it('is symmetric: both sides sum to one', () => {
    expect(expectedScore(1700, 1450) + expectedScore(1450, 1700)).toBeCloseTo(1, 12);
  });
});

describe('kFactor', () => {
  it('is the provisional K below the game threshold', () => {
    expect(kFactor(0)).toBe(K_PROVISIONAL);
    expect(kFactor(PROVISIONAL_GAMES - 1)).toBe(K_PROVISIONAL);
  });

  it('drops to the established K at the threshold', () => {
    expect(kFactor(PROVISIONAL_GAMES)).toBe(K_ESTABLISHED);
  });
});

describe('applyRatedGame', () => {
  it('moves an even match by half the K-factor', () => {
    const [alice, bob] = applyRatedGame(
      established('Alice', 1500), established('Bob', 1500), GAME);

    expect(alice.rating).toBe(1500 + K_ESTABLISHED / 2);
    expect(bob.rating).toBe(1500 - K_ESTABLISHED / 2);
  });

  it('conserves rating between the two players', () => {
    const [alice, bob] = applyRatedGame(
      established('Alice', 1720), established('Bob', 1410), GAME);

    expect(alice.rating - 1720).toBe(-(bob.rating - 1410));
  });

  it('rewards an upset far more than an expected win', () => {
    const [underdog] = applyRatedGame(
      established('Alice', 1300), established('Bob', 1800), GAME);
    const [favourite] = applyRatedGame(
      established('Alice', 1800), established('Bob', 1300), GAME);

    expect(underdog.rating - 1300).toBeGreaterThan(favourite.rating - 1800);
  });

  it('splits a draw towards the weaker player', () => {
    const [alice, bob] = applyRatedGame(
      established('Alice', 1800), established('Bob', 1300), { ...GAME, winner: null });

    expect(alice.rating).toBeLessThan(1800);
    expect(bob.rating).toBeGreaterThan(1300);
    expect(alice.draws).toBe(1);
    expect(bob.draws).toBe(1);
  });

  it('computes both expectations from pre-game ratings, so order does not matter', () => {
    const [alice, bob] = applyRatedGame(
      established('Alice', 1600), established('Bob', 1450), GAME);
    const [bobFirst, aliceFirst] = applyRatedGame(
      established('Bob', 1450), established('Alice', 1600), GAME);

    expect(aliceFirst.rating).toBe(alice.rating);
    expect(bobFirst.rating).toBe(bob.rating);
  });

  it('tallies the outcome and records the swing in both histories', () => {
    const [alice, bob] = applyRatedGame(
      established('Alice', 1500), established('Bob', 1500), GAME);

    expect(alice.wins).toBe(1);
    expect(alice.losses).toBe(0);
    expect(bob.losses).toBe(1);
    expect(alice.history).toHaveLength(1);
    expect(alice.history[0]).toMatchObject({
      gameId: GAME.gameId, opponent: 'Bob', opponentRating: 1500, score: 1,
      before: 1500, after: alice.rating, delta: alice.rating - 1500,
    });
    expect(bob.history[0]).toMatchObject({ opponent: 'Alice', score: 0, delta: bob.rating - 1500 });
  });

  it('matches the winner case-insensitively', () => {
    const [alice] = applyRatedGame(
      established('Alice', 1500), established('Bob', 1500), { ...GAME, winner: 'ALICE' });

    expect(alice.wins).toBe(1);
  });

  it('ignores a game already counted, so replaying the log is safe', () => {
    const [alice, bob] = applyRatedGame(
      established('Alice', 1500), established('Bob', 1500), GAME);
    const [aliceAgain, bobAgain] = applyRatedGame(alice, bob, GAME);

    expect(aliceAgain).toBe(alice);
    expect(bobAgain).toBe(bob);
    expect(hasRatedGame(alice, GAME.gameId)).toBe(true);
  });

  it('leaves the rating provisional until the threshold is reached', () => {
    let alice = initialRating('Alice', true);
    let bob = initialRating('Bob', false);
    for (let i = 0; i < PROVISIONAL_GAMES; i++) {
      [alice, bob] = applyRatedGame(alice, bob, { ...GAME, gameId: `game-${i}` });
      expect(alice.provisional).toBe(i < PROVISIONAL_GAMES - 1);
    }
    expect(alice.games).toBe(PROVISIONAL_GAMES);
    expect(alice.provisional).toBe(false);
  });

  it('tracks the peak rating across a losing streak', () => {
    let alice = established('Alice', 1500);
    let bob = established('Bob', 1500);
    [alice, bob] = applyRatedGame(alice, bob, { ...GAME, gameId: 'won' });
    const peak = alice.rating;
    [alice] = applyRatedGame(alice, bob, { ...GAME, gameId: 'lost', winner: 'Bob' });

    expect(alice.rating).toBeLessThan(peak);
    expect(alice.peak).toBe(peak);
  });

  it('preserves the AI flag through an update', () => {
    const [, ai] = applyRatedGame(
      initialRating('Alice', true), initialRating('AI-Smart', false), GAME);

    expect(ai.human).toBe(false);
  });

  it('starts an unrated player at the conventional seed', () => {
    expect(initialRating('Alice', true).rating).toBe(INITIAL_RATING);
  });
});
