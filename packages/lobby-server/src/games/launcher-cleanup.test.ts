/**
 * @module games/launcher-cleanup.test
 *
 * Regression test for the game-child lifecycle invariant: a spawned game
 * server must be removed from the active-games registry whenever it exits —
 * including a crash BEFORE it finished starting up. The original launchGame
 * wired the exit-cleanup handler only after a successful start, so a child
 * that died (or was killed on the 15s startup timeout) before printing
 * "listening" left a permanent stale entry, and isActiveGamePort kept
 * reporting that dead port as a live game for the rest of the lobby's life.
 */

import { EventEmitter } from 'node:events';
import { describe, test, expect } from 'vitest';
import { registerGameChild, activeGameCount, isActiveGamePort, type ManagedChild } from './launcher.js';

/** A fake child process: an EventEmitter with a no-op kill(). */
function fakeChild(): ManagedChild & EventEmitter {
  const em = new EventEmitter() as EventEmitter & { kill: () => void };
  em.kill = () => {};
  return em as ManagedChild & EventEmitter;
}

describe('registerGameChild lifecycle', () => {
  test('a registered child is reported as an active port', () => {
    const port = 49001;
    const child = fakeChild();
    const before = activeGameCount();
    registerGameChild(port, child, []);
    expect(isActiveGamePort(port)).toBe(true);
    expect(activeGameCount()).toBe(before + 1);
    child.emit('exit', 0); // cleanup
  });

  test('an exit BEFORE startup completes still removes the port (the leak)', () => {
    const port = 49002;
    const child = fakeChild();
    registerGameChild(port, child, []);
    expect(isActiveGamePort(port)).toBe(true);

    // Child dies before ever becoming ready.
    child.emit('exit', 1);

    expect(isActiveGamePort(port)).toBe(false);
  });

  test('exit fires the end callbacks', () => {
    const port = 49003;
    const child = fakeChild();
    let called = 0;
    registerGameChild(port, child, [() => { called++; }]);
    child.emit('exit', 0);
    expect(called).toBe(1);
    expect(isActiveGamePort(port)).toBe(false);
  });
});
