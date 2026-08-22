/**
 * @module atomic-write.test
 *
 * Tests for writeFileAtomic, the crash-safe writer behind the game-server's
 * durable persistence (game records, rating files, per-player games history,
 * saves). A write must land as a complete file via temp-then-rename, never
 * leaving a torn target that the "malformed = no data" readers would drop,
 * and never leaving a stray temp file that a `.json` directory lister would
 * try to parse.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { writeFileAtomic } from './atomic-write.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-atomic-write-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeFileAtomic', () => {
  test('writes the exact bytes and creates the parent directory', () => {
    const p = path.join(dir, 'nested', 'rec.json');
    writeFileAtomic(p, '{"a":1}\n');
    expect(fs.readFileSync(p, 'utf-8')).toBe('{"a":1}\n');
  });

  test('leaves no .tmp file behind, so .json listers see only the target', () => {
    const p = path.join(dir, 'game-1.json');
    writeFileAtomic(p, JSON.stringify({ gameId: 'game-1' }));
    const entries = fs.readdirSync(dir);
    expect(entries).toEqual(['game-1.json']);
    expect(entries.filter(f => f.endsWith('.json'))).toEqual(['game-1.json']);
  });

  test('overwrites an existing file atomically, leaving only the target', () => {
    const p = path.join(dir, 'rating.json');
    writeFileAtomic(p, JSON.stringify({ rating: 1500 }));
    writeFileAtomic(p, JSON.stringify({ rating: 1532 }));
    expect(JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown).toEqual({ rating: 1532 });
    expect(fs.readdirSync(dir)).toEqual(['rating.json']);
  });

  test('the on-disk file always parses as complete JSON (never torn)', () => {
    const p = path.join(dir, 'big.json');
    const value = { history: Array.from({ length: 400 }, (_, i) => ({ gameId: `g${i}`, delta: i })) };
    writeFileAtomic(p, JSON.stringify(value, null, 2) + '\n');
    const raw = fs.readFileSync(p, 'utf-8');
    expect(() => { JSON.parse(raw); }).not.toThrow();
    expect(JSON.parse(raw) as unknown).toEqual(value);
  });
});
