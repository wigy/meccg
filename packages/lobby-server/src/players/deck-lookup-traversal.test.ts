/**
 * @module players/deck-lookup-traversal.test
 *
 * Regression test for path traversal in findDeckById. The deck id reaches
 * this function from a caller-controlled current-deck selection
 * (setCurrentDeck stores it verbatim; GET /api/my-decks reads it back and
 * returns the resolved deck). The catalog fallback previously interpolated
 * the RAW id into a path — `path.join(DECK_CATALOG_DIR, `${deckId}.json`)`
 * — so a deckId like "../../<victim>/info" walked out of the catalog and
 * read any .json on disk (an account's info.json holds its password hash).
 * Both directory lookups must use the sanitized filename.
 *
 * Env dirs are read at module-eval time, so this file sets them before the
 * dynamic import of the store.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test, expect, beforeAll } from 'vitest';

let root: string;
let store: typeof import('./store.js');

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-deck-traversal-'));
  process.env.PLAYERS_DIR = path.join(root, 'players');
  process.env.DECK_CATALOG_DIR = path.join(root, 'catalog');
  fs.mkdirSync(process.env.PLAYERS_DIR, { recursive: true });
  fs.mkdirSync(process.env.DECK_CATALOG_DIR, { recursive: true });

  // A legit catalog deck, addressed by its own id.
  fs.writeFileSync(
    path.join(process.env.DECK_CATALOG_DIR, 'stock-1.json'),
    JSON.stringify({ id: 'stock-1', name: 'Stock Deck' }),
  );

  // A secret file OUTSIDE both deck directories, reachable only by traversal.
  fs.writeFileSync(path.join(root, 'secret.json'), JSON.stringify({ passwordHash: 'TOP-SECRET' }));

  store = await import('./store.js');
});

describe('findDeckById path traversal', () => {
  test('resolves a real catalog deck by id', () => {
    const deck = store.findDeckById('attacker', 'stock-1') as { name?: string } | null;
    expect(deck?.name).toBe('Stock Deck');
  });

  test('a traversal id cannot read a .json outside the deck directories', () => {
    // From DECK_CATALOG_DIR (<root>/catalog), "../secret" would resolve to
    // <root>/secret.json — the pre-fix catalog fallback would have returned
    // its contents. Sanitized, the id can only ever name a file inside the
    // deck dirs, so this must be null.
    const leaked = store.findDeckById('attacker', '../secret') as { passwordHash?: string } | null;
    expect(leaked).toBeNull();
  });

  test('a deep traversal id also returns null and does not throw', () => {
    expect(() => store.findDeckById('attacker', '../../../../etc/hosts')).not.toThrow();
    expect(store.findDeckById('attacker', '../../../../etc/hosts')).toBeNull();
  });
});
