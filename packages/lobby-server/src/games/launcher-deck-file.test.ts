/**
 * @module games/launcher-deck-file.test
 *
 * Regression coverage for the `--deck-file` plumbing that lets an AI
 * opponent play a player-owned deck: `@meccg/sim`'s catalog-only `loadDeck`
 * cannot see a deck outside `DECK_CATALOG_DIR`, so a resolved player-owned
 * deck (`resolveAiDeckId` in `lobby.ts`) is written to a temp file and
 * forwarded to the spawned AI client as `--deck-file <path>` instead of
 * `--deck <id>`. `buildAiClientArgs` and `cleanupAiDeckFile` are split out of
 * `launchGame` precisely so this is testable without spawning a real process.
 */

import * as fs from 'fs';
import { describe, test, expect, vi } from 'vitest';

vi.mock('../lobby-log.js', () => ({ lobbyLog: { log: () => { /* silent */ } } }));

import { buildAiClientArgs, cleanupAiDeckFile } from './launcher.js';
import type { LaunchOptions } from './launcher.js';

describe('buildAiClientArgs', () => {
  test('a catalog deck id is forwarded as --deck, with no temp file written', () => {
    const options: LaunchOptions = { ai: true, aiDeckId: 'stock-deck' };
    const { args, deckFilePath } = buildAiClientArgs('ai-client.ts', 12345, 'AI-Heuristic', 'tok', options);

    expect(args).toEqual(['tsx', 'ai-client.ts', '12345', 'AI-Heuristic', 'tok', '--deck', 'stock-deck']);
    expect(deckFilePath).toBeUndefined();
  });

  test('a player-owned deck is serialized to a temp file and forwarded as --deck-file', () => {
    const deck = { id: 'alices-custom-deck', name: 'Custom', alignment: 'hero' };
    const options: LaunchOptions = { ai: true, aiDeckContent: deck as never };

    const { args, deckFilePath } = buildAiClientArgs('ai-client.ts', 54321, 'AI-Heuristic', 'tok', options);

    expect(deckFilePath).toBeDefined();
    expect(args).toContain('--deck-file');
    expect(args[args.indexOf('--deck-file') + 1]).toBe(deckFilePath);
    expect(args).not.toContain('--deck');

    const written = JSON.parse(fs.readFileSync(deckFilePath!, 'utf-8')) as { id: string };
    expect(written.id).toBe('alices-custom-deck');

    cleanupAiDeckFile(deckFilePath);
  });

  test('an agent spec is appended after the deck arguments', () => {
    const options: LaunchOptions = { ai: true, aiDeckId: 'stock-deck', aiAgentSpec: 'mc:ms=2000' };
    const { args } = buildAiClientArgs('ai-client.ts', 1, 'AI-MC', 'tok', options);

    expect(args.slice(-2)).toEqual(['--agent', 'mc:ms=2000']);
  });

  test('a model path is forwarded when no agent spec is given', () => {
    const options: LaunchOptions = { ai: true, aiDeckId: 'stock-deck', aiModelPath: '/models/gen2.json' };
    const { args } = buildAiClientArgs('ai-client.ts', 1, 'AI-Real', 'tok', options);

    expect(args.slice(-2)).toEqual(['--model', '/models/gen2.json']);
  });

  test('throws when neither a deck id nor deck content is given', () => {
    expect(() => buildAiClientArgs('ai-client.ts', 1, 'AI-Heuristic', 'tok', { ai: true }))
      .toThrow(/aiDeckId or aiDeckContent/);
  });
});

describe('cleanupAiDeckFile', () => {
  test('removes the file written by buildAiClientArgs', () => {
    const deck = { id: 'temp-deck' };
    const { deckFilePath } = buildAiClientArgs('ai-client.ts', 99, 'AI-Heuristic', 'tok', { ai: true, aiDeckContent: deck as never });
    expect(fs.existsSync(deckFilePath!)).toBe(true);

    cleanupAiDeckFile(deckFilePath);

    expect(fs.existsSync(deckFilePath!)).toBe(false);
  });

  test('does nothing (and does not throw) when given undefined', () => {
    expect(() => cleanupAiDeckFile(undefined)).not.toThrow();
  });

  test('does not throw when the file is already gone', () => {
    const deck = { id: 'already-gone' };
    const { deckFilePath } = buildAiClientArgs('ai-client.ts', 100, 'AI-Heuristic', 'tok', { ai: true, aiDeckContent: deck as never });
    fs.rmSync(deckFilePath!, { force: true });

    expect(() => cleanupAiDeckFile(deckFilePath)).not.toThrow();
  });
});
