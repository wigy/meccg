/**
 * @module lobby/stop-game-save-delete.test
 *
 * Regression test: 'stop-game' must delete the pair's save/autosave files,
 * not just clear in-memory lobby state. Without this, the opponent's client
 * auto-reconnects when the killed server closes their socket, sends
 * 'rejoin-game', and the relaunch silently restores the very save the
 * player just tried to stop (bug report: "we cancel game... we keep coming
 * back to existing game").
 *
 * SAVE_DIR is read once at module load by lobby.ts, so it must be set
 * before lobby.ts is imported — hence the dynamic import below.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type WebSocket from 'ws';
import { describe, test, expect, vi, beforeAll } from 'vitest';

const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meccg-stop-game-saves-'));
process.env.SAVE_DIR = saveDir;

const launchGame = vi.fn();
const killGame = vi.fn();

vi.mock('../games/launcher.js', () => ({
  launchGame: (...args: unknown[]) => launchGame(...args) as unknown,
  killGame: (...args: unknown[]) => killGame(...args) as unknown,
}));
vi.mock('../games/models.js', () => ({
  resolveModelFile: () => undefined,
}));
vi.mock('../auth/jwt.js', () => ({
  signGameToken: (name: string, gid: string) => `token-${name}-${gid}`,
}));
vi.mock('../lobby-log.js', () => ({
  lobbyLog: { log: () => undefined },
}));
vi.mock('../players/store.js', () => ({
  getDisplayName: (name: string) => name,
  getCredits: () => 0,
  toDirName: (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
}));
vi.mock('../mail/store.js', () => ({
  countUnread: () => 0,
}));

let playerConnected: typeof import('./lobby.js')['playerConnected'];
beforeAll(async () => {
  ({ playerConnected } = await import('./lobby.js'));
});

/** A fake lobby WebSocket that records sent messages and exposes its handlers. */
function fakeWs(): {
  ws: WebSocket;
  sent: { type: string; [key: string]: unknown }[];
  emit: (event: string, data?: unknown) => void;
} {
  const sent: { type: string; [key: string]: unknown }[] = [];
  const handlers = new Map<string, (data?: unknown) => void>();
  const ws = {
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => { sent.push(JSON.parse(raw) as { type: string }); },
    on: (event: string, cb: (data?: unknown) => void) => { handlers.set(event, cb); },
    close: () => undefined,
  } as unknown as WebSocket;
  return { ws, sent, emit: (event, data) => handlers.get(event)?.(data) };
}

/** Send a client message through a fake connection's message handler. */
function say(conn: ReturnType<typeof fakeWs>, msg: object): void {
  conn.emit('message', Buffer.from(JSON.stringify(msg)));
}

/** Wait for pending async work (mocked launchGame/killGame) to settle. */
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('stop-game save cleanup', () => {
  test('deletes the pair save and autosave so a relaunch starts fresh', async () => {
    // The key mirrors the sorted-lowercase-names convention shared by
    // game-session.ts (saveFilePath/autosaveFilePath) and the /api/saves
    // routes — anything a rejoin/relaunch would restore.
    const key = ['alice', 'ai-heuristic'].sort().join('_vs_');
    const savePath = path.join(saveDir, `${key}.json`);
    const autosavePath = path.join(saveDir, `${key}-autosave.json`);
    fs.writeFileSync(savePath, '{}');
    fs.writeFileSync(autosavePath, '{}');

    let resolveKill: (() => void) | undefined;
    killGame.mockImplementationOnce(() => new Promise<void>(resolve => { resolveKill = resolve; }));
    launchGame.mockResolvedValueOnce({
      port: 9201,
      tokens: ['tok-alice', 'tok-ai'],
      onEnd: () => undefined,
    });

    const alice = fakeWs();
    playerConnected('Alice', alice.ws);

    say(alice, { type: 'play-heuristic-ai', deckId: 'deck-1' });
    await settle();

    say(alice, { type: 'stop-game' });
    await settle();

    // The saves must still be there while the old server is still exiting
    // (it could still write a final autosave) — only deleted afterwards.
    expect(fs.existsSync(savePath)).toBe(true);
    expect(fs.existsSync(autosavePath)).toBe(true);

    resolveKill!();
    await settle();

    expect(fs.existsSync(savePath)).toBe(false);
    expect(fs.existsSync(autosavePath)).toBe(false);

    alice.emit('close');
  });
});
