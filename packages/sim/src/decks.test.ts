/**
 * @module decks.test
 *
 * Regression coverage for `loadDeckFromFile`, the `--deck-file` counterpart
 * to `loadDeck`'s catalog-by-id lookup. It exists so a player-owned AI deck
 * (not in `DECK_CATALOG_DIR`) can be resolved server-side (`resolveAiDeckId`
 * in the lobby), written to a temp file, and read by the spawned AI client —
 * see `client-common.ts`'s `loadDeckJoinFromFile`. Both loaders must expand a
 * deck file identically; only where the bytes come from differs.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { loadDeckFromFile } from './decks.js';

describe('loadDeckFromFile', () => {
  let tmpDir: string;
  let filePath: string;

  const deckFile = {
    id: 'alices-custom-deck',
    name: "Alice's Custom Deck",
    alignment: 'hero',
    pool: [{ name: 'Frodo', card: 'tw-1', qty: 1 }],
    deck: {
      characters: [{ name: 'Frodo', card: 'tw-1', qty: 1 }],
      hazards: [{ name: 'Old Man Willow', card: 'tw-200', qty: 1 }],
      resources: [{ name: 'Ring of Barahir', card: 'tw-100', qty: 1 }],
    },
    sites: [{ name: 'Rivendell', card: 'tw-300', qty: 4 }],
    sideboard: [],
  };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-decks-test-'));
    filePath = path.join(tmpDir, 'custom.json');
    fs.writeFileSync(filePath, JSON.stringify(deckFile));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('expands a deck file the same way loadDeck expands a catalog file', () => {
    const fromFile = loadDeckFromFile(filePath);

    expect(fromFile.id).toBe('alices-custom-deck');
    expect(fromFile.name).toBe("Alice's Custom Deck");
    expect(fromFile.approved).toBe(false);
    expect(fromFile.draftPool).toEqual(['tw-1']);
    expect(fromFile.playDeck).toEqual(['tw-1', 'tw-100', 'tw-200']);
    expect(fromFile.siteDeck).toEqual(['tw-300', 'tw-300', 'tw-300', 'tw-300']);
    expect(fromFile.sideboard).toEqual([]);
    expect(fromFile.file).toEqual(deckFile);
  });

  test('reads an approved flag when present, unlike an absent one defaulting to false', () => {
    const approvedPath = path.join(tmpDir, 'approved.json');
    fs.writeFileSync(approvedPath, JSON.stringify({ ...deckFile, id: 'approved-copy', approved: true }));

    expect(loadDeckFromFile(approvedPath).approved).toBe(true);
  });
});
