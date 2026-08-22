/**
 * @module players/name-validation.test
 *
 * Regression tests for isValidPlayerName, the guard that keeps a
 * request-controlled name out of a filesystem path. The /api/saves/check
 * and /api/saves/delete routes build a save-file path
 * (`<a>_vs_<b>.json`) from the caller's `opponent` string; before this
 * guard, an opponent like "../../../../tmp/evil" escaped SAVE_DIR through
 * path.join normalization, letting an authenticated user probe or delete
 * .json files outside the saves directory.
 */

import path from 'node:path';
import { describe, test, expect } from 'vitest';
import { isValidPlayerName } from './store.js';

describe('isValidPlayerName', () => {
  test('accepts the registration charset (letters, digits, space, hyphen, underscore)', () => {
    expect(isValidPlayerName('Alice')).toBe(true);
    expect(isValidPlayerName('bob smith')).toBe(true);
    expect(isValidPlayerName('player-1_2')).toBe(true);
  });

  test('rejects path-traversal and separator characters', () => {
    expect(isValidPlayerName('../../../../tmp/evil')).toBe(false);
    expect(isValidPlayerName('a/b')).toBe(false);
    expect(isValidPlayerName('a\\b')).toBe(false);
    expect(isValidPlayerName('a.b')).toBe(false);
    expect(isValidPlayerName('..')).toBe(false);
    expect(isValidPlayerName('')).toBe(false);
  });

  test('a rejected opponent name cannot escape the saves directory (the vuln)', () => {
    // Demonstrates why the guard is needed: joining an unfiltered traversal
    // name resolves outside SAVE_DIR, whereas every name the guard admits
    // stays inside it.
    const SAVE_DIR = '/srv/meccg/saves';
    const malicious = '../../../../tmp/evil';
    expect(isValidPlayerName(malicious)).toBe(false);
    const key = [malicious, 'zzz'].sort().join('_vs_');
    const resolved = path.resolve(path.join(SAVE_DIR, `${key}.json`));
    expect(resolved.startsWith(SAVE_DIR + path.sep)).toBe(false);

    // A valid name always resolves to a direct child of SAVE_DIR.
    const safeKey = ['bob smith', 'zzz'].sort().join('_vs_');
    const safeResolved = path.resolve(path.join(SAVE_DIR, `${safeKey}.json`));
    expect(path.dirname(safeResolved)).toBe(SAVE_DIR);
  });
});
