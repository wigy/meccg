/**
 * @module lobby/stop-game.test
 *
 * Tests for the 'stop-game' message: lets a player kill their own lingering
 * game server on demand, clearing the "You are already in a game" block
 * without waiting out the idle-exit grace period.
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

import { playerConnected } from './lobby.js';

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

describe('stop-game', () => {
  beforeEach(() => {
    launchGame.mockReset();
    killGame.mockReset();
  });

  test('with no active game returns an error and does not throw', async () => {
    const alice = fakeWs();
    playerConnected('Alice', alice.ws);

    say(alice, { type: 'stop-game' });
    await settle();

    const err = alice.sent.filter(m => m.type === 'error').pop()!;
    expect(err.message).toBe('You are not in a game');
    expect(killGame).not.toHaveBeenCalled();

    alice.emit('close');
  });

  test('with an active AI game kills the server, clears inGame, and removes the watchable row', async () => {
    let resolveKill: (() => void) | undefined;
    killGame.mockImplementationOnce(() => new Promise<void>(resolve => { resolveKill = resolve; }));
    let endGame: (() => void) | undefined;
    launchGame.mockResolvedValueOnce({
      port: 9101,
      tokens: ['tok-alice', 'tok-ai'],
      onEnd: (cb: () => void) => { endGame = cb; },
    });

    const alice = fakeWs();
    const bob = fakeWs();
    playerConnected('Alice', alice.ws);
    playerConnected('Bob', bob.ws);

    say(alice, { type: 'play-heuristic-ai', deckId: 'deck-1' });
    await settle();

    say(alice, { type: 'stop-game' });
    await settle();

    // The lobby-wide broadcast reflects "not in game" immediately, before the
    // process has actually exited.
    const afterStop = bob.sent.filter(m => m.type === 'online-players').pop()!;
    const aliceEntry = (afterStop.players as { name: string; inGame: boolean }[]).find(p => p.name === 'Alice')!;
    expect(aliceEntry.inGame).toBe(false);
    expect(killGame).toHaveBeenCalledWith(9101);

    // Once the killed process actually exits, its registered onEnd callback
    // removes the watchable game row too.
    resolveKill!();
    endGame!();
    await settle();
    const afterExit = bob.sent.filter(m => m.type === 'online-players').pop()!;
    expect(afterExit.games).toEqual([]);

    // A fresh "Play vs X" now succeeds immediately instead of hitting the
    // "You are already in a game" guard — this is the bug being fixed.
    let endGame2: (() => void) | undefined;
    launchGame.mockResolvedValueOnce({
      port: 9102,
      tokens: ['tok-alice-2', 'tok-ai-2'],
      onEnd: (cb: () => void) => { endGame2 = cb; },
    });
    say(alice, { type: 'play-heuristic-ai', deckId: 'deck-1' });
    await settle();
    const started = alice.sent.filter(m => m.type === 'game-starting').pop()!;
    expect(started.port).toBe(9102);

    // End this game too, so later tests reconnecting as "Alice" start clean
    // instead of inheriting a still-"in game" state via activeGamesByName
    // (which is deliberately kept across socket disconnects for rejoin).
    endGame2!();
    await settle();

    alice.emit('close');
    bob.emit('close');
  });

  test('sent twice in quick succession does not kill the process twice', async () => {
    let resolveKill: (() => void) | undefined;
    killGame.mockImplementation(() => new Promise<void>(resolve => { resolveKill = resolve; }));
    let endGame: (() => void) | undefined;
    launchGame.mockResolvedValueOnce({
      port: 9103,
      tokens: ['tok-alice', 'tok-ai'],
      onEnd: (cb: () => void) => { endGame = cb; },
    });

    const alice = fakeWs();
    playerConnected('Alice', alice.ws);

    say(alice, { type: 'play-heuristic-ai', deckId: 'deck-1' });
    await settle();

    say(alice, { type: 'stop-game' });
    say(alice, { type: 'stop-game' });
    await settle();

    expect(killGame).toHaveBeenCalledTimes(1);
    const err = alice.sent.filter(m => m.type === 'error').pop()!;
    expect(err.message).toBe('You are not in a game');

    // Let the kill finish so the watchable row is cleaned up too, leaving no
    // state behind for other tests.
    resolveKill!();
    endGame!();
    await settle();

    alice.emit('close');
  });

  test('while a rejoin-game relaunch is in flight is rejected cleanly', async () => {
    let resolveLaunch: ((result: unknown) => void) | undefined;
    // No active game is known yet (fresh connect), so 'rejoin-game' goes
    // straight to relaunching rather than the "already known" short-circuit.
    // A human opponent needs no deckId, so the relaunch reaches launchGame
    // (left pending here) rather than bailing out on a missing deck first.
    launchGame.mockImplementationOnce(() => new Promise(resolve => { resolveLaunch = resolve; }));

    const alice = fakeWs();
    const bob = fakeWs();
    playerConnected('Alice', alice.ws);
    playerConnected('Bob', bob.ws);

    say(alice, { type: 'rejoin-game', opponent: 'Bob' });
    await settle();

    say(alice, { type: 'stop-game' });
    await settle();

    const err = alice.sent.filter(m => m.type === 'error').pop()!;
    expect(err.message).toBe('A game is already restarting');
    expect(killGame).not.toHaveBeenCalled();

    let endGame: (() => void) | undefined;
    resolveLaunch!({ port: 9105, tokens: ['tok-alice', 'tok-bob'], onEnd: (cb: () => void) => { endGame = cb; } });
    await settle();

    // Clean up the relaunched game too, leaving no state behind for other tests.
    endGame!();
    await settle();

    alice.emit('close');
    bob.emit('close');
  });
});
