/**
 * @module lobby/observer-target.test
 *
 * Which game an Ask AI observer attaches to
 * (`specs/2026-08-17-ask-ai-observer.md`). "The latest game launched" is
 * knowledge only the lobby has, and `--new` depends on it being able to say
 * "newer than this instant" — otherwise starting the observer first and then
 * clicking Play would attach it to the game already running.
 */

import type WebSocket from 'ws';
import { describe, test, expect, vi, beforeEach } from 'vitest';

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

import { newestObserverTarget, playerConnected } from './lobby.js';

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

function say(conn: ReturnType<typeof fakeWs>, msg: object): void {
  conn.emit('message', Buffer.from(JSON.stringify(msg)));
}

const settle = () => new Promise(resolve => setImmediate(resolve));

/** Start an AI game for `player`, returning its onEnd hook so it can be closed. */
async function startAiGame(
  player: ReturnType<typeof fakeWs>,
  port: number,
  gameId: string,
): Promise<() => void> {
  let end: (() => void) | undefined;
  launchGame.mockResolvedValueOnce({
    port,
    gameId,
    tokens: [`tok-${port}-a`, `tok-${port}-b`],
    onEnd: (cb: () => void) => { end = cb; },
  });
  say(player, { type: 'play-heuristic-ai', deckId: 'deck-1' });
  await settle();
  return end!;
}

describe('newestObserverTarget', () => {
  beforeEach(() => {
    launchGame.mockReset();
    killGame.mockReset();
  });

  test('is null while no game is running', () => {
    expect(newestObserverTarget('Observer')).toBeNull();
  });

  test('names the running game, its log id, and a token for the observer', async () => {
    const alice = fakeWs();
    playerConnected('Alice', alice.ws);
    const end = await startAiGame(alice, 9201, 'Alice-vs-AI-Heuristic-1');

    const target = newestObserverTarget('Observer');
    expect(target).toMatchObject({
      port: 9201,
      // The log id is what the observer opens: it reads positions from
      // ~/.meccg/logs/games/<gameId>.jsonl, not from the wire.
      gameId: 'Alice-vs-AI-Heuristic-1',
      player1: 'Alice',
    });
    // Mirrors the spectator token's `watch-<port>` shape.
    expect(target?.token).toBe('token-Observer-observe-9201');
    expect(Number.isNaN(Date.parse(target!.launchedAt))).toBe(false);

    end();
    await settle();
    alice.emit('close');
  });

  test('picks the most recently launched of several games', async () => {
    const alice = fakeWs();
    const bob = fakeWs();
    playerConnected('Alice', alice.ws);
    playerConnected('Bob', bob.ws);

    const endFirst = await startAiGame(alice, 9202, 'first-game');
    // `launchedAt` is a millisecond timestamp, so two launches inside the same
    // millisecond would tie; nudging the clock keeps the ordering meaningful.
    vi.setSystemTime(new Date(Date.now() + 1_000));
    const endSecond = await startAiGame(bob, 9203, 'second-game');

    expect(newestObserverTarget('Observer')?.gameId).toBe('second-game');

    endFirst();
    endSecond();
    await settle();
    vi.useRealTimers();
    alice.emit('close');
    bob.emit('close');
  });

  test('with `since`, skips the game that was already running', async () => {
    const alice = fakeWs();
    playerConnected('Alice', alice.ws);
    const end = await startAiGame(alice, 9204, 'already-running');

    // This is `bin/observe --new`: launched at startup, waiting for the *next*
    // game rather than attaching to this one.
    const startedObservingAt = new Date(Date.now() + 500).toISOString();
    expect(newestObserverTarget('Observer', startedObservingAt)).toBeNull();
    // Without the cutoff the same call finds it.
    expect(newestObserverTarget('Observer')?.gameId).toBe('already-running');

    end();
    await settle();
    alice.emit('close');
  });

  test('forgets a game once its server exits', async () => {
    const alice = fakeWs();
    playerConnected('Alice', alice.ws);
    const end = await startAiGame(alice, 9205, 'ending-game');
    expect(newestObserverTarget('Observer')).not.toBeNull();

    end();
    await settle();
    expect(newestObserverTarget('Observer')).toBeNull();

    alice.emit('close');
  });
});
