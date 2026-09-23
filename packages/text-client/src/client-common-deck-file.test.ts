/**
 * @module client-common-deck-file.test
 *
 * Regression coverage for the `--deck-file` argument: how a spawned AI
 * client (headless AI or pseudo-AI relay) plays a player-owned deck instead
 * of a shared-catalog one. The lobby resolves the deck server-side
 * (`resolveAiDeckId` in `lobby.ts`) and writes it to a temp file
 * (`launcher.ts`'s `buildAiClientArgs`); this client reads it straight from
 * disk via `loadDeckJoinFromFile` rather than looking it up by id.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadDeckJoinFromFile, parseSpawnedClientArgs, spawnedJoinPayload } from './client-common.js';

const deckFile = {
  id: 'alices-custom-deck',
  name: "Alice's Custom Deck",
  alignment: 'hero',
  pool: [],
  deck: {
    characters: [{ name: 'Frodo', card: 'tw-1', qty: 1 }],
    hazards: [],
    resources: [],
  },
  sites: [],
  sideboard: [],
};

describe('loadDeckJoinFromFile', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-client-deck-file-'));
    filePath = path.join(tmpDir, 'custom.json');
    fs.writeFileSync(filePath, JSON.stringify(deckFile));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('builds a join message from the file, not the catalog', () => {
    const join = loadDeckJoinFromFile(filePath, 'AI-Heuristic');

    expect(join.type).toBe('join');
    expect(join.name).toBe('AI-Heuristic');
    expect(join.playDeck).toEqual(['tw-1']);
    expect((join.deckList as unknown as { id: string }).id).toBe('alices-custom-deck');
  });
});

describe('parseSpawnedClientArgs with --deck-file', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  test('parses --deck-file alongside the positional args', () => {
    process.argv = ['node', 'ai-client.ts', '9001', 'AI-Heuristic', 'tok-123', '--deck-file', '/tmp/custom.json'];

    const args = parseSpawnedClientArgs('ai-client');

    expect(args).toMatchObject({
      port: 9001,
      playerName: 'AI-Heuristic',
      token: 'tok-123',
      deckId: undefined,
      deckFilePath: '/tmp/custom.json',
    });
  });

  test('--deck and --deck-file can both be parsed, with --deck-file taking priority at join time', () => {
    process.argv = ['node', 'ai-client.ts', '9001', 'AI-Heuristic', 'tok-123', '--deck', 'stock-deck', '--deck-file', '/tmp/custom.json'];

    const args = parseSpawnedClientArgs('ai-client');

    expect(args.deckId).toBe('stock-deck');
    expect(args.deckFilePath).toBe('/tmp/custom.json');
  });
});

describe('spawnedJoinPayload deck-file precedence', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-client-deck-file-'));
    filePath = path.join(tmpDir, 'custom.json');
    fs.writeFileSync(filePath, JSON.stringify(deckFile));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('a deckFilePath is read directly, even when a catalog deckId is also present', () => {
    const raw = spawnedJoinPayload({
      port: 9001, playerName: 'AI-Heuristic', token: 'tok-123',
      deckId: 'a-catalog-deck-that-does-not-exist-on-disk',
      deckFilePath: filePath,
    }, 'AI');
    const msg = JSON.parse(raw) as { deckList: { id: string } };

    expect(msg.deckList.id).toBe('alices-custom-deck');
  });
});
