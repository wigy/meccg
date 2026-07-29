/**
 * @module game-session-spectators.test
 *
 * Tests the `spectators` broadcast. A spectator arriving or leaving does not
 * change the game state, so it never reaches the state broadcast — the session
 * has to announce the watcher list itself, or a player's watcher badge would
 * only refresh on the next move.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, vi } from 'vitest';
import { Alignment } from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { GameSession } from './game-session.js';

// GameSession and its loggers resolve SAVE_DIR / LOG_DIR / the home directory
// once at import time, so these must be redirected before the imports above
// run — which is exactly what vi.hoisted guarantees.
const { TMP_HOME } = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-session-spectators-test`;
  process.env.HOME = home;
  process.env.SAVE_DIR = `${home}/saves`;
  process.env.LOG_DIR = `${home}/logs`;
  delete process.env.JWT_SECRET;
  return { TMP_HOME: home };
});

// Wiped on the way in rather than torn down afterwards: the loggers open their
// streams asynchronously, so deleting the tree in afterAll races them.
fs.rmSync(TMP_HOME, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP_HOME, 'logs'), { recursive: true });
fs.mkdirSync(path.join(TMP_HOME, '.meccg', 'logs', 'games'), { recursive: true });

const BALIN = 'tw-123' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;
const THRAIN = 'tw-149' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;

/**
 * A stand-in for the `ws` WebSocket carrying only what GameSession touches:
 * `on('message'|'close')`, `send`, `close`, and the `readyState`/`OPEN` pair
 * its `send` guard reads. Sent frames are collected for assertions.
 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  join(name: string): void {
    this.emit('message', Buffer.from(JSON.stringify({
      type: 'join',
      name,
      alignment: Alignment.Wizard,
      draftPool: [BALIN, THRAIN],
      playDeck: [GANDALF],
      siteDeck: [RIVENDELL],
      sideboard: [],
    })));
  }

  /** Watcher names from the most recent `spectators` message, if any. */
  latestSpectators(): readonly string[] | undefined {
    const msg = [...this.sent].reverse().find(m => m.type === 'spectators');
    return msg?.names as readonly string[] | undefined;
  }
}

/** A session with Alice and Bob seated and their sockets returned. */
function seatedGame(): { alice: FakeSocket; bob: FakeSocket; session: GameSession } {
  const session = new GameSession({ dev: true, playerNames: ['Alice', 'Bob'] });
  const alice = new FakeSocket();
  const bob = new FakeSocket();
  session.addConnection(alice as never);
  session.addConnection(bob as never);
  alice.join('Alice');
  bob.join('Bob');
  return { alice, bob, session };
}

describe('spectator broadcast', () => {
  test('players start with an empty watcher list', () => {
    const { alice } = seatedGame();
    expect(alice.latestSpectators()).toEqual([]);
  });

  test('a joining spectator is announced to both players', () => {
    const { alice, bob, session } = seatedGame();

    const watcher = new FakeSocket();
    session.addConnection(watcher as never);
    watcher.join('Rodrigo');

    expect(alice.latestSpectators()).toEqual(['Rodrigo']);
    expect(bob.latestSpectators()).toEqual(['Rodrigo']);
  });

  test('watchers are listed sorted and without duplicates', () => {
    const { alice, session } = seatedGame();

    // Rodrigo watching from two tabs is one watcher.
    for (const name of ['Rodrigo', 'Bergil', 'Rodrigo']) {
      const watcher = new FakeSocket();
      session.addConnection(watcher as never);
      watcher.join(name);
    }

    expect(alice.latestSpectators()).toEqual(['Bergil', 'Rodrigo']);
  });

  test('a leaving spectator is announced', () => {
    const { alice, session } = seatedGame();

    const watcher = new FakeSocket();
    session.addConnection(watcher as never);
    watcher.join('Rodrigo');
    expect(alice.latestSpectators()).toEqual(['Rodrigo']);

    watcher.close();
    expect(alice.latestSpectators()).toEqual([]);
  });

  test('one tab closing leaves the watcher listed while the other stays open', () => {
    const { alice, session } = seatedGame();

    const firstTab = new FakeSocket();
    const secondTab = new FakeSocket();
    for (const [tab, name] of [[firstTab, 'Rodrigo'], [secondTab, 'Rodrigo']] as const) {
      session.addConnection(tab as never);
      tab.join(name);
    }

    firstTab.close();
    expect(alice.latestSpectators()).toEqual(['Rodrigo']);

    secondTab.close();
    expect(alice.latestSpectators()).toEqual([]);
  });

  test('a player reconnecting is told who is watching', () => {
    const { session } = seatedGame();

    const watcher = new FakeSocket();
    session.addConnection(watcher as never);
    watcher.join('Rodrigo');

    // Alice reopens the tab: a fresh socket joining under the same name.
    const aliceAgain = new FakeSocket();
    session.addConnection(aliceAgain as never);
    aliceAgain.join('Alice');

    expect(aliceAgain.latestSpectators()).toEqual(['Rodrigo']);
  });
});
