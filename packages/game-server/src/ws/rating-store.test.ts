/**
 * @module rating-store.test
 *
 * Tests for the on-disk rating store: the live per-game update, its
 * idempotency, and the full-log rebuild that `bin/ratings rebuild` runs.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, beforeEach } from 'vitest';
import { INITIAL_RATING, K_PROVISIONAL } from './elo.js';
import type { PlayerRating } from './elo.js';
import {
  ratingPath, readRating, rebuildRatings, recordRatedGame, toDirName, writeRating,
} from './rating-store.js';
import type { RatableGame } from './rating-store.js';

// The store resolves the players directory per call, so pointing the
// environment at a temp directory keeps the real `~/.meccg/players` untouched.
const PLAYERS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-ratings-'));
process.env.PLAYERS_DIR = PLAYERS_DIR;

function game(
  gameId: string,
  endedAt: string,
  winner: string | null,
  players: readonly { name: string; human: boolean }[] = [
    { name: 'Alice', human: true }, { name: 'AI-MC', human: false },
  ],
): RatableGame {
  return { gameId, endedAt, winner, players };
}

/** Read a rating file straight off disk, bypassing the store's fallbacks. */
function onDisk(name: string): PlayerRating {
  return JSON.parse(fs.readFileSync(ratingPath(name), 'utf-8')) as PlayerRating;
}

beforeEach(() => {
  for (const dir of fs.readdirSync(PLAYERS_DIR)) {
    fs.rmSync(path.join(PLAYERS_DIR, dir), { recursive: true, force: true });
  }
});

describe('toDirName', () => {
  test('matches the lobby player store: lowercase, non-alphanumerics to dashes', () => {
    expect(toDirName('AI-MC')).toBe('ai-mc');
    expect(toDirName('Bob Smith')).toBe('bob-smith');
  });
});

describe('readRating', () => {
  test('falls back to the seed rating when no file exists', () => {
    expect(readRating('Nobody', true)).toMatchObject({
      rating: INITIAL_RATING, games: 0, provisional: true,
    });
  });

  test('falls back to the seed rating when the file is corrupt', () => {
    const filePath = ratingPath('Alice');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not json');

    expect(readRating('Alice', true).rating).toBe(INITIAL_RATING);
  });

  test('refreshes the name and AI flag from the caller, which the record knows best', () => {
    writeRating({ ...readRating('AI-MC', true), rating: 1600 });

    expect(readRating('AI-MC', false)).toMatchObject({ rating: 1600, human: false });
  });
});

describe('recordRatedGame', () => {
  test('writes both players and moves an even first game by half the K-factor', () => {
    const updated = recordRatedGame(game('g-1', '2026-08-01T10:00:00.000Z', 'Alice'));

    expect(updated).not.toBeNull();
    expect(onDisk('Alice').rating).toBeGreaterThan(INITIAL_RATING);
    expect(onDisk('AI-MC').rating).toBeLessThan(INITIAL_RATING);
    expect(onDisk('Alice').rating - INITIAL_RATING).toBe(INITIAL_RATING - onDisk('AI-MC').rating);
  });

  test('records the AI flag so the scoreboard can badge the row', () => {
    recordRatedGame(game('g-1', '2026-08-01T10:00:00.000Z', 'Alice'));

    expect(onDisk('Alice').human).toBe(true);
    expect(onDisk('AI-MC').human).toBe(false);
  });

  test('is idempotent in the gameId, so a rewritten record is not counted twice', () => {
    recordRatedGame(game('g-1', '2026-08-01T10:00:00.000Z', 'Alice'));
    const after = onDisk('Alice').rating;

    expect(recordRatedGame(game('g-1', '2026-08-01T10:00:00.000Z', 'Alice'))).toBeNull();
    expect(onDisk('Alice')).toMatchObject({ rating: after, games: 1 });
  });

  test('refuses a game a player somehow played against themselves', () => {
    expect(recordRatedGame(game('g-1', '2026-08-01T10:00:00.000Z', 'Alice', [
      { name: 'Alice', human: true }, { name: 'alice', human: true },
    ]))).toBeNull();
    expect(fs.existsSync(ratingPath('Alice'))).toBe(false);
  });
});

describe('rebuildRatings', () => {
  const LOG = [
    game('g-3', '2026-08-03T10:00:00.000Z', 'AI-MC'),
    game('g-1', '2026-08-01T10:00:00.000Z', 'Alice'),
    game('g-2', '2026-08-02T10:00:00.000Z', null),
  ];

  test('reproduces exactly what the live path builds game by game', () => {
    for (const g of [LOG[1], LOG[2], LOG[0]]) recordRatedGame(g);
    const live = { alice: onDisk('Alice'), ai: onDisk('AI-MC') };

    rebuildRatings(LOG);

    expect(onDisk('Alice')).toEqual(live.alice);
    expect(onDisk('AI-MC')).toEqual(live.ai);
  });

  test('replays in the order games ended, not the order they are listed', () => {
    rebuildRatings(LOG);

    expect(onDisk('Alice').history.map(h => h.gameId)).toEqual(['g-1', 'g-2', 'g-3']);
  });

  test('is idempotent: rebuilding twice yields the same ratings', () => {
    const first = rebuildRatings(LOG);

    expect(rebuildRatings(LOG)).toEqual(first);
  });

  test('discards a stale rating no game record backs any more', () => {
    recordRatedGame(game('g-9', '2026-08-09T10:00:00.000Z', 'Ghost', [
      { name: 'Ghost', human: true }, { name: 'Alice', human: true },
    ]));
    expect(fs.existsSync(ratingPath('Ghost'))).toBe(true);

    rebuildRatings(LOG);

    expect(fs.existsSync(ratingPath('Ghost'))).toBe(false);
    expect(fs.existsSync(ratingPath('Alice'))).toBe(true);
  });

  test('leaves the account directory itself alone when clearing a stale rating', () => {
    const infoPath = path.join(PLAYERS_DIR, 'ghost', 'info.json');
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, '{"name":"Ghost"}');
    writeRating({ ...readRating('Ghost', true), rating: 1600 });

    rebuildRatings(LOG);

    expect(fs.existsSync(ratingPath('Ghost'))).toBe(false);
    expect(fs.readFileSync(infoPath, 'utf-8')).toBe('{"name":"Ghost"}');
  });

  test('returns the standings best first, with the totals the log implies', () => {
    const standings = rebuildRatings([game('g-1', '2026-08-01T10:00:00.000Z', 'Alice')]);

    // A first game is provisional, so an even matchup swings by half of K=40.
    expect(standings.map(r => r.name)).toEqual(['Alice', 'AI-MC']);
    expect(standings[0]).toMatchObject({
      rating: INITIAL_RATING + K_PROVISIONAL / 2, wins: 1, games: 1, provisional: true,
    });
  });

  test('writes nothing for an empty log', () => {
    expect(rebuildRatings([])).toEqual([]);
    expect(fs.readdirSync(PLAYERS_DIR)).toEqual([]);
  });
});
