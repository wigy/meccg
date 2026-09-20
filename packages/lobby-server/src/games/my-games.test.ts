/**
 * @module games/my-games.test
 *
 * Tests for scanning SAVE_DIR into a player's unfinished/left-off games.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { listMySavedGames } from './my-games.js';

let dir: string;
let originalSaveDir: string | undefined;

function writeSave(
  fileName: string,
  opts: { gameId?: string; players?: { name: string }[]; tutorialCursor?: number } = {},
  mtime?: Date,
): void {
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify({
    state: { gameId: opts.gameId ?? 'game-1', players: opts.players ?? [{ name: 'Alice' }, { name: 'Bob' }] },
    ...(opts.tutorialCursor !== undefined ? { tutorialCursor: opts.tutorialCursor } : {}),
  }));
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-my-games-'));
  originalSaveDir = process.env.SAVE_DIR;
  process.env.SAVE_DIR = dir;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalSaveDir === undefined) delete process.env.SAVE_DIR;
  else process.env.SAVE_DIR = originalSaveDir;
});

describe('listMySavedGames', () => {
  test('returns an empty list for a missing SAVE_DIR', () => {
    process.env.SAVE_DIR = path.join(dir, 'does-not-exist');
    expect(listMySavedGames('alice')).toEqual([]);
  });

  test('returns an empty list when there are no matching saves', () => {
    expect(listMySavedGames('alice')).toEqual([]);
  });

  test('finds a save for the named player, matched case-insensitively', () => {
    writeSave('alice_vs_bob.json', { players: [{ name: 'Alice' }, { name: 'Bob' }] });
    const games = listMySavedGames('ALICE');
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ gameId: 'game-1', opponent: 'Bob' });
  });

  test('dedupes a save/autosave pair for the same opponent, keeping the newer mtime', () => {
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-01-02T00:00:00.000Z');
    writeSave('alice_vs_bob.json', { gameId: 'old-game' }, older);
    writeSave('alice_vs_bob-autosave.json', { gameId: 'new-game' }, newer);

    const games = listMySavedGames('alice');
    expect(games).toHaveLength(1);
    expect(games[0].gameId).toBe('new-game');
    expect(games[0].savedAt).toBe(newer.toISOString());
  });

  test('excludes tutorial saves', () => {
    writeSave('alice_vs_mentor.json', { tutorialCursor: 3, players: [{ name: 'Alice' }, { name: 'Mentor' }] });
    expect(listMySavedGames('alice')).toEqual([]);
  });

  test('lists one entry per opponent, newest first', () => {
    writeSave('alice_vs_bob.json', { gameId: 'g-bob' }, new Date('2026-01-01T00:00:00.000Z'));
    writeSave('alice_vs_carol.json', { gameId: 'g-carol', players: [{ name: 'Alice' }, { name: 'Carol' }] },
      new Date('2026-01-03T00:00:00.000Z'));
    const games = listMySavedGames('alice');
    expect(games.map(g => g.opponent)).toEqual(['Carol', 'Bob']);
  });

  test('ignores saves that do not involve the named player', () => {
    writeSave('bob_vs_carol.json', { players: [{ name: 'Bob' }, { name: 'Carol' }] });
    expect(listMySavedGames('alice')).toEqual([]);
  });
});
