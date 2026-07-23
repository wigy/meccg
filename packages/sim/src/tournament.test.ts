/**
 * @module tournament.test
 *
 * Elo-ladder tests: Glicko-2 math against the worked reference example
 * from Glickman's paper, Elo-from-score estimation, the paired-seed
 * side-swap schedule, rating-period bookkeeping, failure accounting,
 * determinism, and a real head-to-head smoke match through the game
 * runner.
 */

import { describe, test, expect } from 'vitest';
import { INITIAL_RATING, updateRating } from './glicko2.js';
import { estimateEloDiff, scoreToEloDiff, runTournament, runMatch } from './tournament.js';
import type { TournamentPlayFn } from './tournament.js';
import { createHeuristicAgent } from './agents/heuristic-agent.js';
import { createNoisyHeuristicAgent } from './agents/noisy-heuristic-agent.js';
import { loadDeck } from './decks.js';
import type { Agent } from './types.js';

const DECKS: [ReturnType<typeof loadDeck>, ReturnType<typeof loadDeck>] =
  [loadDeck('challenge-deck-a'), loadDeck('challenge-deck-b')];

/** An agent that is never actually consulted by the stubbed play functions. */
const inert = (name: string): Agent => ({
  name,
  chooseAction: context => ({ action: context.legalActions[0] }),
});

describe('glicko-2', () => {
  test('matches the worked example from the Glicko-2 paper', () => {
    const updated = updateRating(
      { rating: 1500, rd: 200, volatility: 0.06 },
      [
        { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
        { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
        { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
      ],
      0.5,
    );
    expect(updated.rating).toBeCloseTo(1464.06, 1);
    expect(updated.rd).toBeCloseTo(151.52, 1);
    expect(updated.volatility).toBeCloseTo(0.05999, 4);
  });

  test('an idle rating period inflates RD but never past the unrated 350', () => {
    const idle = updateRating({ rating: 1600, rd: 50, volatility: 0.06 }, []);
    expect(idle.rating).toBe(1600);
    expect(idle.rd).toBeGreaterThan(50);
    expect(idle.volatility).toBe(0.06);
    const maxed = updateRating({ rating: 1600, rd: 350, volatility: 0.06 }, []);
    expect(maxed.rd).toBe(350);
  });
});

describe('elo estimation', () => {
  test('score rate maps to the standard Elo curve', () => {
    expect(scoreToEloDiff(0.5)).toBe(0);
    expect(scoreToEloDiff(0.75)).toBeCloseTo(190.85, 1);
    expect(scoreToEloDiff(0.25)).toBeCloseTo(-190.85, 1);
  });

  test('confidence interval brackets the estimate and tightens with games', () => {
    const small = estimateEloDiff(15, 0, 5);
    const large = estimateEloDiff(150, 0, 50);
    expect(small.diff).toBeCloseTo(large.diff, 5);
    expect(small.low).toBeLessThan(small.diff);
    expect(small.high).toBeGreaterThan(small.diff);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  test('an empty record yields an unbounded interval', () => {
    const empty = estimateEloDiff(0, 0, 0);
    expect(empty.diff).toBe(0);
    expect(empty.low).toBe(-Infinity);
    expect(empty.high).toBe(Infinity);
  });
});

describe('tournament schedule', () => {
  test('plays every seed twice with seats swapped, one seed per pair', () => {
    const calls: { seed: number; seats: readonly [string, string] }[] = [];
    const play: TournamentPlayFn = options => {
      const names = options.names ?? ['?', '?'];
      calls.push({ seed: options.seed, seats: [names[0], names[1]] });
      return { result: { outcome: 'completed', decisions: 10, turns: 2 }, winnerIndex: 0 };
    };
    const result = runTournament({
      participants: [
        { name: 'a', agent: inert('a') },
        { name: 'b', agent: inert('b') },
        { name: 'c', agent: inert('c') },
      ],
      decks: DECKS,
      baseSeed: 100,
      rounds: 2,
      pairsPerRound: 2,
      play,
    });

    // 3 pairings × 2 pairs × 2 seats × 2 rounds.
    expect(calls.length).toBe(24);
    expect(result.games.length).toBe(24);

    const bySeed = new Map<number, (readonly [string, string])[]>();
    for (const call of calls) {
      const seatings = bySeed.get(call.seed) ?? [];
      seatings.push(call.seats);
      bySeed.set(call.seed, seatings);
    }
    // One seed per pair, each played exactly twice with the seats swapped.
    expect(bySeed.size).toBe(12);
    for (const seatings of bySeed.values()) {
      expect(seatings.length).toBe(2);
      expect(seatings[1]).toEqual([seatings[0][1], seatings[0][0]]);
    }
    expect(Math.min(...bySeed.keys())).toBe(100);
    expect(Math.max(...bySeed.keys())).toBe(111);

    // Seat 0 always wins, so side-swap makes every pairing dead even and
    // all ratings stay at the 1500 starting point.
    for (const pairing of result.pairings) {
      expect(pairing.aWins).toBe(pairing.bWins);
      expect(pairing.elo.diff).toBe(0);
    }
    for (const standing of result.standings) {
      expect(standing.wins).toBe(8);
      expect(standing.losses).toBe(8);
      expect(standing.rating.rating).toBeCloseTo(1500, 6);
    }
    expect(result.failures).toBe(0);
  });

  test('a dominant agent climbs clear of the field', () => {
    const play: TournamentPlayFn = options => {
      const names = options.names ?? ['?', '?'];
      const winnerIndex = names[0] === 'strong' ? 0 : names[1] === 'strong' ? 1 : 0;
      return { result: { outcome: 'completed', decisions: 10, turns: 2 }, winnerIndex };
    };
    const result = runTournament({
      participants: [
        { name: 'weak-1', agent: inert('weak-1') },
        { name: 'strong', agent: inert('strong') },
        { name: 'weak-2', agent: inert('weak-2') },
      ],
      decks: DECKS,
      baseSeed: 1,
      rounds: 3,
      pairsPerRound: 5,
      play,
    });
    expect(result.standings[0].name).toBe('strong');
    expect(result.standings[0].losses).toBe(0);
    // The winner's confidence interval separates from both losers'.
    for (const other of result.standings.slice(1)) {
      expect(result.standings[0].interval.low).toBeGreaterThan(other.interval.high);
    }
  });

  test('non-completed games count as failures and are excluded from ratings', () => {
    const play: TournamentPlayFn = options =>
      options.seed === 101
        ? { result: { outcome: 'engine-error', decisions: 5, turns: 1, error: 'boom' }, winnerIndex: null }
        : { result: { outcome: 'completed', decisions: 10, turns: 2 }, winnerIndex: 0 };
    const result = runTournament({
      participants: [
        { name: 'a', agent: inert('a') },
        { name: 'b', agent: inert('b') },
      ],
      decks: DECKS,
      baseSeed: 100,
      rounds: 1,
      pairsPerRound: 3,
      play,
    });
    // Seed 101 fails in both seatings; seeds 100 and 102 complete.
    expect(result.failures).toBe(2);
    expect(result.pairings[0].failures).toBe(2);
    expect(result.pairings[0].elo.games).toBe(4);
    for (const standing of result.standings) {
      expect(standing.failures).toBe(2);
      expect(standing.wins + standing.losses).toBe(4);
    }
    const failed = result.games.filter(game => game.outcome !== 'completed');
    expect(failed.map(game => game.seed)).toEqual([101, 101]);
    expect(failed[0].error).toBe('boom');
  });

  test('reruns with the same inputs are identical', () => {
    const play: TournamentPlayFn = options => ({
      result: { outcome: 'completed', decisions: options.seed % 7, turns: 2 },
      winnerIndex: options.seed % 2 === 0 ? 0 : 1,
    });
    const options = {
      participants: [
        { name: 'a', agent: inert('a') },
        { name: 'b', agent: inert('b') },
      ],
      decks: DECKS,
      baseSeed: 500,
      rounds: 2,
      pairsPerRound: 4,
      play,
    };
    expect(JSON.stringify(runTournament(options))).toBe(JSON.stringify(runTournament(options)));
  });

  test('rejects duplicate participant names', () => {
    expect(() => runTournament({
      participants: [
        { name: 'same', agent: inert('same') },
        { name: 'same', agent: inert('same') },
      ],
      decks: DECKS,
      baseSeed: 1,
    })).toThrow('unique');
  });
});

describe('head-to-head match', () => {
  test('disambiguates identical names and reports from the challenger side', () => {
    const play: TournamentPlayFn = options => {
      const names = options.names ?? ['?', '?'];
      // The champion always wins regardless of seat.
      return {
        result: { outcome: 'completed', decisions: 10, turns: 2 },
        winnerIndex: names[0] === 'heuristic-champion' ? 0 : 1,
      };
    };
    const match = runMatch({
      champion: { name: 'heuristic', agent: inert('heuristic') },
      challenger: { name: 'heuristic', agent: inert('heuristic') },
      decks: DECKS,
      baseSeed: 1,
      rounds: 2,
      pairsPerRound: 5,
      play,
    });
    expect(match.challenger.name).toBe('heuristic-challenger');
    expect(match.champion.name).toBe('heuristic-champion');
    expect(match.challenger.wins).toBe(0);
    expect(match.elo.score).toBe(0);
    expect(match.elo.diff).toBeLessThan(-400);
    expect(match.glickoDiff.diff).toBeLessThan(0);
  });

  test('a real match runs through the game runner with tightened ratings', () => {
    const match = runMatch({
      champion: { name: 'heuristic', agent: createHeuristicAgent() },
      challenger: { name: 'noisy', agent: createNoisyHeuristicAgent(0.5) },
      decks: DECKS,
      baseSeed: 11,
      rounds: 1,
      pairsPerRound: 1,
    });
    expect(match.failures).toBe(0);
    expect(match.games.length).toBe(2);
    expect(match.games[0].seed).toBe(match.games[1].seed);
    expect(match.games[0].seats).toEqual(['noisy', 'heuristic']);
    expect(match.games[1].seats).toEqual(['heuristic', 'noisy']);
    expect(Number.isFinite(match.elo.diff)).toBe(true);
    expect(match.challenger.rating.rd).toBeLessThan(INITIAL_RATING.rd);
    expect(match.champion.rating.rd).toBeLessThan(INITIAL_RATING.rd);
  }, 20000);
});

describe('noisy heuristic agent', () => {
  test('rejects an epsilon outside [0, 1]', () => {
    expect(() => createNoisyHeuristicAgent(1.5)).toThrow('epsilon');
    expect(() => createNoisyHeuristicAgent(-0.1)).toThrow('epsilon');
    expect(createNoisyHeuristicAgent(0.75).name).toBe('noisy-heuristic:0.75');
  });
});
