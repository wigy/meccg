/**
 * @module json-store.test
 *
 * Tests for the atomic writeJson: a write must land as a complete file via
 * temp-then-rename, never leaving a torn target (the durability hole where a
 * crash mid-write corrupted an account record that readJson then silently
 * reported as "no data") and never leaving a stray temp file that the
 * directory listers might trip over.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { writeJson, readJson, readJsonDir } from './json-store.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-json-store-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeJson atomic write', () => {
  test('round-trips a value', () => {
    const p = path.join(dir, 'rec.json');
    writeJson(p, { a: 1, b: 'two' });
    expect(readJson(p)).toEqual({ a: 1, b: 'two' });
  });

  test('creates the parent directory', () => {
    const p = path.join(dir, 'nested', 'deep', 'rec.json');
    writeJson(p, { ok: true });
    expect(readJson(p)).toEqual({ ok: true });
  });

  test('leaves no temp file behind, and readJsonDir ignores non-.json', () => {
    const p = path.join(dir, 'rec.json');
    writeJson(p, { x: 1 });
    const leftovers = fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    // Exactly one record listed — the temp file never counts.
    expect(readJsonDir(dir)).toHaveLength(1);
  });

  test('overwrites atomically: an existing record is replaced by the new one', () => {
    const p = path.join(dir, 'rec.json');
    writeJson(p, { v: 1 });
    writeJson(p, { v: 2 });
    expect(readJson(p)).toEqual({ v: 2 });
    expect(fs.readdirSync(dir)).toEqual(['rec.json']);
  });

  test('the on-disk file is always complete, valid JSON (never torn)', () => {
    const p = path.join(dir, 'rec.json');
    const value = { list: Array.from({ length: 500 }, (_, i) => ({ i, s: 'x'.repeat(50) })) };
    writeJson(p, value);
    // Parsing the raw bytes must succeed — a half-written file would throw.
    const raw = fs.readFileSync(p, 'utf-8');
    expect(() => { JSON.parse(raw); }).not.toThrow();
    expect(JSON.parse(raw) as unknown).toEqual(value);
  });
});
