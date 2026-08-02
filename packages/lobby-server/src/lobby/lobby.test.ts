/**
 * @module lobby/lobby.test
 *
 * Tests for lobby presence and the watchable-games broadcast: a player who
 * enters an AI game must show up as a "player vs. AI-*" game row (watchable
 * by others) rather than as a challengeable individual entry.
 */

import type WebSocket from 'ws';
import { describe, test, expect, vi } from 'vitest';

const launchGame = vi.fn();

vi.mock('../games/launcher.js', () => ({
  launchGame: (...args: unknown[]) => launchGame(...args) as unknown,
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

/** Wait for the async game-start path (mocked launchGame) to settle. */
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('lobby AI games in the watchable list', () => {
  test('an AI game is broadcast as a watchable "player vs. AI" row for its whole lifetime', async () => {
    let endGame: (() => void) | undefined;
    launchGame.mockResolvedValueOnce({
      port: 9001,
      tokens: ['tok-alice', 'tok-ai'],
      onEnd: (cb: () => void) => { endGame = cb; },
    });

    const alice = fakeWs();
    const bob = fakeWs();
    playerConnected('Alice', alice.ws);
    playerConnected('Bob', bob.ws);

    say(alice, { type: 'play-heuristic-ai', deckId: 'deck-1' });
    await settle();

    // Everyone is told Alice is busy, and the game row names the AI opponent.
    const online = bob.sent.filter(m => m.type === 'online-players').pop()!;
    expect(online.games).toEqual([{
      port: 9001,
      player1: 'Alice',
      player1DisplayName: 'Alice',
      player2: 'AI-Heuristic',
      player2DisplayName: 'AI-Heuristic',
    }]);
    const aliceEntry = (online.players as { name: string; inGame: boolean }[]).find(p => p.name === 'Alice')!;
    expect(aliceEntry.inGame).toBe(true);

    // A non-participant can watch it...
    say(bob, { type: 'watch-game', port: 9001 });
    const watching = bob.sent.filter(m => m.type === 'game-watching').pop()!;
    expect(watching.port).toBe(9001);
    expect(watching.player2DisplayName).toBe('AI-Heuristic');

    // ...but the player in the game cannot.
    say(alice, { type: 'watch-game', port: 9001 });
    const err = alice.sent.filter(m => m.type === 'error').pop()!;
    expect(err.message).toBe('You are a player in that game');

    // When the game ends the row disappears and Alice is challengeable again.
    endGame!();
    const after = bob.sent.filter(m => m.type === 'online-players').pop()!;
    expect(after.games).toEqual([]);
    const aliceAfter = (after.players as { name: string; inGame: boolean }[]).find(p => p.name === 'Alice')!;
    expect(aliceAfter.inGame).toBe(false);

    say(bob, { type: 'watch-game', port: 9001 });
    const gone = bob.sent.filter(m => m.type === 'error').pop()!;
    expect(gone.message).toBe('That game is no longer in progress');

    alice.emit('close');
    bob.emit('close');
  });

  test('a pseudo-AI game is broadcast as a watchable row too', async () => {
    let endGame: (() => void) | undefined;
    launchGame.mockResolvedValueOnce({
      port: 9002,
      tokens: ['tok-carol', 'tok-pseudo'],
      onEnd: (cb: () => void) => { endGame = cb; },
    });

    const carol = fakeWs();
    const dave = fakeWs();
    playerConnected('Carol', carol.ws);
    playerConnected('Dave', dave.ws);

    say(carol, { type: 'play-pseudo-ai', deckId: 'deck-2' });
    await settle();

    const online = dave.sent.filter(m => m.type === 'online-players').pop()!;
    expect(online.games).toEqual([{
      port: 9002,
      player1: 'Carol',
      player1DisplayName: 'Carol',
      player2: 'AI-Pseudo',
      player2DisplayName: 'AI-Pseudo',
    }]);

    endGame!();
    const after = dave.sent.filter(m => m.type === 'online-players').pop()!;
    expect(after.games).toEqual([]);

    carol.emit('close');
    dave.emit('close');
  });
});

describe('rejoin-game deduplication', () => {
  test('a second rejoin-game arriving before the first launch finishes is dropped', async () => {
    launchGame.mockClear();
    let resolveLaunch: ((result: unknown) => void) | undefined;
    launchGame.mockImplementationOnce(() => new Promise(resolve => { resolveLaunch = resolve; }));

    const alice = fakeWs();
    const bob = fakeWs();
    playerConnected('Alice', alice.ws);
    playerConnected('Bob', bob.ws);

    // Two rejoin-game messages for the same opponent arrive back-to-back —
    // e.g. the client's rejoin-retry timer firing again before the first
    // game-server has finished spawning. Only the first should launch a
    // server; a second live process restoring the same save would race the
    // first one's actions (reported as the AI seat endlessly re-transferring
    // an item between characters).
    say(alice, { type: 'rejoin-game', opponent: 'Bob' });
    say(alice, { type: 'rejoin-game', opponent: 'Bob' });
    await settle();

    expect(launchGame).toHaveBeenCalledTimes(1);

    resolveLaunch!({
      port: 9003,
      tokens: ['tok-alice', 'tok-bob'],
      onEnd: () => undefined,
    });
    await settle();

    expect(alice.sent.filter(m => m.type === 'game-starting')).toHaveLength(1);

    alice.emit('close');
    bob.emit('close');
  });
});
