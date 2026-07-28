/**
 * @module games/scoreboard.test
 *
 * Tests for the scoreboard aggregation over completed-game records.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect } from 'vitest';
import { aggregateScoreboard } from './scoreboard.js';
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
