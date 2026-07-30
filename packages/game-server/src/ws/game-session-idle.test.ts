/**
 * @module game-session-idle.test
 *
 * Tests the no-humans idle exit. A game-server process is the lobby's only
 * signal that a game ended (busy status and the watchable-game row are
 * cleared on child exit), so a session whose human players are gone must
 * report itself idle after the grace period — an AI seat or spectators
 * alone must not keep it alive.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Alignment } from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { GameSession, IDLE_EXIT_GRACE_MS } from './game-session.js';

// GameSession and its loggers resolve SAVE_DIR / LOG_DIR / the home directory
// once at import time, so these must be redirected before the imports above
// run — which is exactly what vi.hoisted guarantees.
const { TMP_HOME } = vi.hoisted(() => {
  const home = `${process.env.TMPDIR ?? '/tmp'}/meccg-session-idle-test`;
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
 * its `send` guard reads.
 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;

  send(): void { /* frames are irrelevant to these tests */ }

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
}

/** Connect a fresh socket to the session and join it under `name`. */
function joinAs(session: GameSession, name: string): FakeSocket {
  const ws = new FakeSocket();
  session.addConnection(ws as never);
  ws.join(name);
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers();
  // Disconnects write autosaves keyed by the player pair; wipe them so one
  // test's save cannot silently restore into the next test's session.
  fs.rmSync(path.join(TMP_HOME, 'saves'), { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('idle exit when no human is connected', () => {
  test('fires after the grace period when the only human quits a game vs an AI seat', () => {
    const onIdle = vi.fn();
    const session = new GameSession({ playerNames: ['Alice', 'AI-Heuristic'], onIdle });
    const alice = joinAs(session, 'Alice');
    joinAs(session, 'AI-Heuristic');

    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();

    alice.close();
    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test('a spectator does not keep the session alive', () => {
    const onIdle = vi.fn();
    const session = new GameSession({ playerNames: ['Alice', 'AI-Heuristic'], onIdle });
    const alice = joinAs(session, 'Alice');
    joinAs(session, 'AI-Heuristic');
    joinAs(session, 'Rodrigo'); // not a designated player → spectator

    alice.close();
    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test('a human reconnecting within the grace period disarms the timer', () => {
    const onIdle = vi.fn();
    const session = new GameSession({ playerNames: ['Alice', 'AI-Heuristic'], onIdle });
    const alice = joinAs(session, 'Alice');
    joinAs(session, 'AI-Heuristic');

    alice.close();
    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS / 2);
    joinAs(session, 'Alice'); // page reload: rejoins the running game

    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();
  });

  test('fires when nobody ever joins', () => {
    const onIdle = vi.fn();
    new GameSession({ playerNames: ['Alice', 'Bob'], onIdle });

    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  test('a human waiting alone for the opponent counts as connected', () => {
    const onIdle = vi.fn();
    const session = new GameSession({ playerNames: ['Alice', 'Bob'], onIdle });
    joinAs(session, 'Alice'); // pending: the game has not started

    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();
  });

  test('in a human-vs-human game, one player quitting does not end the session', () => {
    const onIdle = vi.fn();
    const session = new GameSession({ playerNames: ['Alice', 'Bob'], onIdle });
    const alice = joinAs(session, 'Alice');
    joinAs(session, 'Bob');

    alice.close();
    vi.advanceTimersByTime(IDLE_EXIT_GRACE_MS * 2);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
