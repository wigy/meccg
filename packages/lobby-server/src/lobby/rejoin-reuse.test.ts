/**
 * @module lobby/rejoin-reuse.test
 *
 * Tests for the duplicate-game-server fix: a player whose lobby socket
 * dropped while their game server stayed alive must be reconnected to the
 * SAME server on 'rejoin-game' (not get a second one launched), a fresh
 * 'play-tutorial' must kill a lingering Mentor server instead of stacking
 * a new one next to it, and the old server's late exit callback must not
 * clobber the state of the game that replaced it.
 */

import { describe, test, expect, vi } from 'vitest';
import type WebSocket from 'ws';

const harness = vi.hoisted(() => ({
  launches: [] as { port: number; endCbs: (() => void)[] }[],
  killed: [] as number[],
}));

vi.mock('../games/launcher.js', () => ({
  launchGame: vi.fn(() => {
    const port = 4001 + harness.launches.length;
    const endCbs: (() => void)[] = [];
    harness.launches.push({ port, endCbs });
    return Promise.resolve({
      port,
      tokens: ['token-1', 'token-2'] as [string, string],
      onEnd: (cb: () => void) => { endCbs.push(cb); },
      pseudoAiRelay: null,
    });
  }),
  // Mirrors the real launcher: killing fires the game's exit callbacks
  // (registered at launch) before the kill promise resolves.
  killGame: vi.fn((port: number) => {
    harness.killed.push(port);
    const launch = harness.launches.find(l => l.port === port);
    if (launch) for (const cb of launch.endCbs) cb();
    return Promise.resolve();
  }),
}));
vi.mock('../games/models.js', () => ({ resolveModelFile: () => undefined }));
vi.mock('../auth/jwt.js', () => ({ signGameToken: () => 'signed-token' }));
vi.mock('../players/store.js', () => ({ getDisplayName: (n: string) => n, getCredits: () => 0 }));
vi.mock('../mail/store.js', () => ({ countUnread: () => 0 }));
vi.mock('../lobby-log.js', () => ({ lobbyLog: { log: () => {}, close: () => {} } }));

import { playerConnected } from './lobby.js';

/** A fake lobby WebSocket recording sent messages and exposing its handlers. */
function makeWs() {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    OPEN: 1,
    readyState: 1,
    sent: [] as { type: string; [key: string]: unknown }[],
    on(event: string, cb: (arg?: unknown) => void) { handlers[event] = cb; },
    close() {},
    send(data: string) { this.sent.push(JSON.parse(data) as { type: string }); },
    emit(event: string, arg?: unknown) { handlers[event]?.(arg); },
    message(msg: object) { handlers['message']?.(Buffer.from(JSON.stringify(msg))); },
  };
}

/** Let the lobby's fire-and-forget async launch chains settle. */
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('rejoin after a lobby reconnect', () => {
  test('reuses the live game server instead of launching a duplicate', async () => {
    const ws1 = makeWs();
    playerConnected('wigy', ws1 as unknown as WebSocket);
    ws1.message({ type: 'play-tutorial' });
    await settle();

    const started = ws1.sent.find(m => m.type === 'game-starting');
    expect(started?.port).toBe(harness.launches[0].port);
    const launchCount = harness.launches.length;

    // The lobby socket drops (e.g. proxy idle timeout); the game server lives on.
    ws1.emit('close');

    const ws2 = makeWs();
    playerConnected('wigy', ws2 as unknown as WebSocket);
    ws2.message({ type: 'rejoin-game', opponent: 'Mentor' });
    await settle();

    const rejoined = ws2.sent.find(m => m.type === 'game-starting');
    expect(rejoined?.port).toBe(started?.port);
    expect(harness.launches.length).toBe(launchCount);
    expect(harness.killed).toEqual([]);
  });
});

describe('fresh tutorial start with a lingering Mentor server', () => {
  test('kills the old server and lists only the new game', async () => {
    const ws1 = makeWs();
    playerConnected('frodo', ws1 as unknown as WebSocket);
    ws1.message({ type: 'play-tutorial' });
    await settle();
    const oldPort = (ws1.sent.find(m => m.type === 'game-starting'))?.port as number;

    ws1.emit('close');
    const ws2 = makeWs();
    playerConnected('frodo', ws2 as unknown as WebSocket);
    ws2.message({ type: 'play-tutorial' });
    await settle();

    expect(harness.killed).toContain(oldPort);
    const newPort = (ws2.sent.find(m => m.type === 'game-starting'))?.port as number;
    expect(newPort).not.toBe(oldPort);

    // The broadcast games list must show the replacement game and no
    // longer the killed one (games of OTHER players may also be listed).
    const broadcasts = ws2.sent.filter(m => m.type === 'online-players');
    const games = broadcasts[broadcasts.length - 1].games as { port: number }[];
    expect(games.map(g => g.port)).toContain(newPort);
    expect(games.map(g => g.port)).not.toContain(oldPort);
  });

  test('the old server\'s late exit does not clobber the new game', async () => {
    const ws = makeWs();
    playerConnected('sam', ws as unknown as WebSocket);
    ws.message({ type: 'play-tutorial' });
    await settle();
    const oldPort = (ws.sent.find(m => m.type === 'game-starting'))?.port as number;

    ws.message({ type: 'play-tutorial' });
    await settle();
    const starts = ws.sent.filter(m => m.type === 'game-starting');
    const newPort = starts[starts.length - 1].port as number;
    expect(newPort).not.toBe(oldPort);

    // Simulate the killed server's exit event arriving again after the
    // replacement launched: the port guard must leave the new game intact.
    const oldLaunch = harness.launches.find(l => l.port === oldPort);
    for (const cb of oldLaunch!.endCbs) cb();
    await settle();

    const broadcasts = ws.sent.filter(m => m.type === 'online-players');
    const last = broadcasts[broadcasts.length - 1];
    const games = last.games as { port: number }[];
    expect(games.map(g => g.port)).toContain(newPort);
    expect(games.map(g => g.port)).not.toContain(oldPort);
    const players = last.players as { name: string; inGame: boolean }[];
    expect(players.find(p => p.name === 'sam')?.inGame).toBe(true);
  });
});

describe('both players rejoining after a game-server crash', () => {
  // The per-player rejoin guards (from.rejoining / activeGame) all pass for
  // the SECOND of two symmetric rejoins: when a human-vs-human game server
  // crashes, both clients' sockets close at once and both send rejoin-game
  // within the same tick, while the first relaunch has not yet stored
  // anyone's activeGame. Without the opponent-rejoining guard the lobby
  // launched a server for each rejoin — two processes restoring the same
  // save and racing each other's autosaves.
  test('launches exactly one replacement server, answering both seats', async () => {
    const ws1 = makeWs();
    const ws2 = makeWs();
    playerConnected('aragorn', ws1 as unknown as WebSocket);
    playerConnected('boromir', ws2 as unknown as WebSocket);
    ws1.message({ type: 'challenge', opponentName: 'boromir' });
    ws2.message({ type: 'accept-challenge', from: 'aragorn' });
    await settle();
    const firstPort = (ws1.sent.find(m => m.type === 'game-starting'))?.port as number;
    expect(firstPort).toBeDefined();
    const launchCount = harness.launches.length;

    // The game server crashes: its exit callbacks fire, clearing both
    // players' active-game state...
    const crashed = harness.launches.find(l => l.port === firstPort)!;
    for (const cb of crashed.endCbs) cb();

    // ...and both clients react to their closed game sockets by sending a
    // symmetric rejoin, back to back.
    ws1.message({ type: 'rejoin-game', opponent: 'boromir' });
    ws2.message({ type: 'rejoin-game', opponent: 'aragorn' });
    await settle();

    expect(harness.launches.length).toBe(launchCount + 1);
    const newPort = harness.launches[harness.launches.length - 1].port;
    expect(ws1.sent.filter(m => m.type === 'game-starting').map(m => m.port)).toContain(newPort);
    expect(ws2.sent.filter(m => m.type === 'game-starting').map(m => m.port)).toContain(newPort);
  });
});
