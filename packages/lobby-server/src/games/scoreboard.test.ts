/**
 * @module games/scoreboard.test
 *
 * Tests for the scoreboard aggregation over completed-game records.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect } from 'vitest';
import { aggregateScoreboard, playerGames } from './scoreboard.js';
import type { ScoreboardGameRecord } from './scoreboard.js';

function record(
  players: readonly { name: string; human?: boolean }[],
  winner: string | null,
  endedAt: string,
): ScoreboardGameRecord {
  return { players, winner, endedAt };
}

describe('aggregateScoreboard', () => {
  test('tallies wins, losses, and draws per player, sorted by games played', () => {
    const rows = aggregateScoreboard([
      record([{ name: 'Alice', human: true }, { name: 'AI-MC', human: false }], 'Alice', '2026-07-01T10:00:00.000Z'),
      record([{ name: 'Alice', human: true }, { name: 'AI-MC', human: false }], 'AI-MC', '2026-07-02T10:00:00.000Z'),
      record([{ name: 'Alice', human: true }, { name: 'Bob', human: true }], null, '2026-07-03T10:00:00.000Z'),
    ]);

    expect(rows.map(r => r.name)).toEqual(['Alice', 'AI-MC', 'Bob']);

    const [alice, aiMc, bob] = rows;
    expect(alice).toMatchObject({ games: 3, wins: 1, losses: 1, draws: 1, human: true });
    expect(alice.lastPlayed).toBe('2026-07-03T10:00:00.000Z');
    expect(aiMc).toMatchObject({ games: 2, wins: 1, losses: 1, draws: 0, human: false });
    expect(bob).toMatchObject({ games: 1, wins: 0, losses: 0, draws: 1, human: true });
  });

  test('ties on games played break by name', () => {
    const rows = aggregateScoreboard([
      record([{ name: 'Zoe' }, { name: 'Amy' }], 'Zoe', '2026-07-01T10:00:00.000Z'),
    ]);
    expect(rows.map(r => r.name)).toEqual(['Amy', 'Zoe']);
  });

  test('winner matching is case-insensitive and records without the human flag use the AI- name convention', () => {
    const rows = aggregateScoreboard([
      record([{ name: 'Alice' }, { name: 'AI-Heuristic' }], 'alice', '2026-07-01T10:00:00.000Z'),
    ]);
    const alice = rows.find(r => r.name === 'Alice')!;
    const ai = rows.find(r => r.name === 'AI-Heuristic')!;
    expect(alice.wins).toBe(1);
    expect(alice.human).toBe(true);
    expect(ai.human).toBe(false);
  });

  test('skips records with missing players and returns empty for no input', () => {
    expect(aggregateScoreboard([])).toEqual([]);
    expect(aggregateScoreboard([{ winner: 'Alice' }])).toEqual([]);
  });

  test('ranks by rating, above games played', () => {
    const games = [
      record([{ name: 'Alice' }, { name: 'Bob' }], 'Alice', '2026-07-01T10:00:00.000Z'),
      record([{ name: 'Alice' }, { name: 'Bob' }], 'Alice', '2026-07-02T10:00:00.000Z'),
      record([{ name: 'Carol' }, { name: 'Bob' }], 'Carol', '2026-07-03T10:00:00.000Z'),
    ];
    const rows = aggregateScoreboard(games, new Map([
      ['alice', { rating: 1550, peak: 1560, ratedGames: 2, provisional: true }],
      ['bob', { rating: 1420, peak: 1500, ratedGames: 3, provisional: true }],
      ['carol', { rating: 1700, peak: 1700, ratedGames: 1, provisional: true }],
    ]));

    // Bob has the most games but the worst rating, so he ranks last.
    expect(rows.map(r => r.name)).toEqual(['Carol', 'Alice', 'Bob']);
    expect(rows[1]).toMatchObject({ rating: 1550, peak: 1560, provisional: true, games: 2 });
  });

  test('players with no rating file rank below every rated player', () => {
    const rows = aggregateScoreboard([
      record([{ name: 'Alice' }, { name: 'Bob' }], 'Alice', '2026-07-01T10:00:00.000Z'),
      record([{ name: 'Alice' }, { name: 'Bob' }], 'Alice', '2026-07-02T10:00:00.000Z'),
    ], new Map([['bob', { rating: 1400, peak: 1500, ratedGames: 2, provisional: false }]]));

    expect(rows.map(r => r.name)).toEqual(['Bob', 'Alice']);
    expect(rows[0]).toMatchObject({ rating: 1400, provisional: false });
    expect(rows[1]).toMatchObject({ rating: null, peak: null, provisional: true });
  });
});

describe('playerGames', () => {
  const detailed: ScoreboardGameRecord = {
    gameId: 'g-2',
    startedAt: '2026-07-02T09:00:00.000Z',
    endedAt: '2026-07-02T10:00:00.000Z',
    durationSeconds: 3600,
    turns: 12,
    winner: 'Alice',
    winReason: 'marshalling-points',
    winCard: null,
    players: [
      {
        name: 'Alice', human: true, alignment: 'hero', avatar: 'Gandalf',
        deck: { name: 'Rangers', gameLength: 'standard' }, startingPlayer: true,
        finalScore: 21, mp: { character: 4, item: 6 }, tournamentMp: { character: 4, item: 5 },
        stagePoints: 0,
      },
      { name: 'AI-MC', human: false, alignment: 'minion', finalScore: 9 },
    ],
  };

  test('returns one entry per game the player took part in, newest first', () => {
    const games = playerGames([
      record([{ name: 'Alice' }, { name: 'Bob' }], null, '2026-07-01T10:00:00.000Z'),
      detailed,
      record([{ name: 'Bob' }, { name: 'AI-MC' }], 'Bob', '2026-07-03T10:00:00.000Z'),
    ], 'alice');

    expect(games.map(g => g.endedAt)).toEqual([
      '2026-07-02T10:00:00.000Z', '2026-07-01T10:00:00.000Z',
    ]);
    expect(games.map(g => g.result)).toEqual(['win', 'draw']);
  });

  test('reports the requested player as `self` with both sides fully detailed', () => {
    const [game] = playerGames([detailed], 'Alice');

    expect(game).toMatchObject({
      gameId: 'g-2', turns: 12, durationSeconds: 3600,
      winner: 'Alice', winReason: 'marshalling-points', result: 'win',
    });
    expect(game.self).toMatchObject({
      name: 'Alice', human: true, alignment: 'hero', avatar: 'Gandalf',
      deckName: 'Rangers', gameLength: 'standard', startingPlayer: true, finalScore: 21,
    });
    // Missing categories are filled in so the client renders a fixed table.
    expect(game.self.mp).toEqual({ character: 4, item: 6, faction: 0, ally: 0, kill: 0, misc: 0 });
    expect(game.self.tournamentMp).toEqual({ character: 4, item: 5, faction: 0, ally: 0, kill: 0, misc: 0 });
    expect(game.opponent).toMatchObject({ name: 'AI-MC', human: false, finalScore: 9 });
    // Fields the record omits stay null rather than being invented.
    expect(game.opponent?.mp).toBeNull();
    expect(game.opponent?.deckName).toBeNull();
  });

  test('a loss is a game another player won, and unknown players have no games', () => {
    expect(playerGames([detailed], 'AI-MC')[0].result).toBe('loss');
    expect(playerGames([detailed], 'Nobody')).toEqual([]);
  });

  test('annotates a game with the rating swing it caused', () => {
    const [game] = playerGames([detailed], 'Alice', new Map([
      ['g-2', { gameId: 'g-2', before: 1500, after: 1516, delta: 16 }],
    ]));

    expect(game).toMatchObject({ ratingBefore: 1500, ratingAfter: 1516, ratingDelta: 16 });
  });

  test('games finished before ratings existed report no swing', () => {
    const [game] = playerGames([detailed], 'Alice');

    expect(game).toMatchObject({ ratingBefore: null, ratingAfter: null, ratingDelta: null });
  });
});

describe('loadScoreboard', () => {
  test('reads records from GAME_RECORDS_DIR, skipping malformed files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-scoreboard-'));
    process.env.GAME_RECORDS_DIR = dir;
    fs.writeFileSync(path.join(dir, 'g1.json'), JSON.stringify(
      record([{ name: 'Alice', human: true }, { name: 'AI-MC', human: false }], 'Alice', '2026-07-01T10:00:00.000Z')));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');

    const { loadScoreboard } = await import('./scoreboard.js');
    const rows = loadScoreboard();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.name === 'Alice')?.wins).toBe(1);
  });

  test('returns empty when the directory does not exist', async () => {
    process.env.GAME_RECORDS_DIR = path.join(os.tmpdir(), 'meccg-scoreboard-missing-' + process.pid);
    const { loadScoreboard } = await import('./scoreboard.js');
    expect(loadScoreboard()).toEqual([]);
  });
});
