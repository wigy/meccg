/**
 * @module cli/human-results-core.test
 *
 * The scoreboard's counting rules.
 */

import { describe, expect, test } from 'vitest';
import { categoryTable, median, paceTable, playedOut, resultsByMonth, seatsOf } from './human-results-core.js';
import type { FinishedGame, FinishedSeat, Pace } from './human-results-core.js';

function seat(name: string, human: boolean, finalScore: number, item = 0): FinishedSeat {
  return { playerId: human ? 'p1' : 'p2', name, human, finalScore, mp: { item } };
}

function game(startedAt: string, human: number, ai: number, winReason = 'marshalling-points'): FinishedGame {
  return {
    gameId: `${startedAt}-${human}-${ai}`,
    startedAt,
    winReason,
    winner: human > ai ? 'Hannah' : 'AI-Modular',
    players: [seat('Hannah', true, human, human), seat('AI-Modular', false, ai)],
  };
}

describe('seatsOf', () => {
  test('is only for a game between one human and one AI', () => {
    expect(seatsOf(game('2026-10-01', 40, 10))?.ai.name).toBe('AI-Modular');
    const twoHumans = { ...game('2026-10-01', 40, 10), players: [seat('A', true, 1), seat('B', true, 2)] };
    expect(seatsOf(twoHumans)).toBeNull();
  });
});

describe('playedOut', () => {
  test('leaves out a forfeited game, and only that', () => {
    expect(playedOut(game('2026-10-01', 40, 10))).toBe(true);
    expect(playedOut(game('2026-10-01', 40, 10, 'one-ring'))).toBe(true);
    expect(playedOut(game('2026-10-01', 40, 10, 'concession'))).toBe(false);
  });
});

describe('median', () => {
  test('of odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('resultsByMonth', () => {
  test('groups by month and AI, and leaves concessions out', () => {
    const rows = resultsByMonth([
      game('2026-09-01', 40, 10),
      game('2026-10-01', 40, 10),
      game('2026-10-02', 20, 30),
      game('2026-10-03', 0, 0, 'concession'),
    ]);
    expect(rows).toEqual([
      { month: '2026-09', agent: 'AI-Modular', finished: 1, aiWins: 0, medianMargin: 30 },
      { month: '2026-10', agent: 'AI-Modular', finished: 2, aiWins: 1, medianMargin: 10 },
    ]);
  });
});

describe('categoryTable', () => {
  test('counts the AI games scoring nothing in a category', () => {
    const item = categoryTable([game('2026-10-01', 40, 10), game('2026-10-02', 20, 30)])
      .find(row => row.category === 'item');
    expect(item).toMatchObject({ humanMedian: 30, humanMean: 30, aiMedian: 0, aiZero: 2 });
  });
});

describe('paceTable', () => {
  const pace = (points: number): Pace => new Map([[2, { human: points, ai: 1 }]]);

  test('reports the median of the games reaching a turn', () => {
    expect(paceTable([1, 2, 3, 4, 5].map(pace))).toEqual([{ turn: 2, human: 3, ai: 1, games: 5 }]);
  });

  test('stops where too few games remain', () => {
    expect(paceTable([pace(1), pace(2)])).toEqual([]);
  });
});
