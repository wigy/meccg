/**
 * Reconnect handling for the spawned text clients.
 *
 * The regression under test is a reconnect storm: `ws` emits `error` and then
 * `close` for a refused connection, and handlers that each scheduled a retry
 * turned every failed attempt into two live sockets. When a finished game left
 * an AI client without a server, the doubling reached ~49,000 attempts per ten
 * seconds within two minutes and the client died on a 4 GB V8 heap.
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installReconnect, resetReconnectAttempts } from './client-common.js';

/** Stand-in for a `ws` socket: only the event surface matters here. */
function fakeSocket(): EventEmitter & WebSocket {
  return new EventEmitter() as EventEmitter & WebSocket;
}

/** Emit the event pair `ws` produces for a connection that never opened. */
function failToConnect(ws: EventEmitter): void {
  ws.emit('error', new Error('connect ECONNREFUSED'));
  ws.emit('close');
}

describe('installReconnect', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetReconnectAttempts();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules one reconnect for a failure that emits both error and close', () => {
    const reconnect = vi.fn();
    const ws = fakeSocket();
    installReconnect(ws, 'AI', reconnect);

    failToConnect(ws);
    vi.advanceTimersByTime(60_000);

    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('does not multiply sockets across successive failed attempts', () => {
    // Each reconnect stands up a fresh socket that fails the same way. With
    // two retry paths per socket this count doubles every round; with one it
    // stays flat.
    let live = 0;
    const reconnect = vi.fn(() => {
      live++;
      const next = fakeSocket();
      installReconnect(next, 'AI', reconnect);
      failToConnect(next);
    });

    const first = fakeSocket();
    installReconnect(first, 'AI', reconnect);
    failToConnect(first);

    // Five rounds of backoff (1s, 2s, 4s, 8s, 16s).
    vi.advanceTimersByTime(31_000);

    expect(live).toBe(5);
  });

  it('backs off exponentially up to a ceiling', () => {
    const delays: number[] = [];
    const reconnect = vi.fn(() => {
      const next = fakeSocket();
      installReconnect(next, 'AI', reconnect);
      failToConnect(next);
    });
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
      delays.push(ms);
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    const ws = fakeSocket();
    installReconnect(ws, 'AI', reconnect);
    failToConnect(ws);
    // setTimeout is stubbed out, so drive the chain by hand.
    for (let i = 0; i < 7; i++) reconnect();

    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('gives up rather than retrying a vanished server forever', () => {
    // An AI client orphaned by a finished game must exit, not spin: the spin
    // is what filled the heap and wrote 512 MB of retry lines to the lobby log.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exited');
    }) as never);
    const reconnect = vi.fn(() => {
      const next = fakeSocket();
      installReconnect(next, 'AI', reconnect);
      failToConnect(next);
    });

    const ws = fakeSocket();
    installReconnect(ws, 'AI', reconnect);
    failToConnect(ws);
    // 15 attempts fit inside the summed backoff; the 16th gives up.
    expect(() => vi.advanceTimersByTime(10 * 60_000)).toThrow('exited');

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('restarts the backoff once a socket opens', () => {
    const reconnect = vi.fn();
    const failing = fakeSocket();
    installReconnect(failing, 'AI', reconnect);
    failToConnect(failing);
    vi.advanceTimersByTime(1000);

    // The retry connects: the next outage starts from the short delay again.
    const opened = fakeSocket();
    installReconnect(opened, 'AI', reconnect);
    opened.emit('open');
    opened.emit('close');

    reconnect.mockClear();
    vi.advanceTimersByTime(1000);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('clears the shared socket reference before scheduling', () => {
    const onClose = vi.fn();
    const reconnect = vi.fn(() => expect(onClose).toHaveBeenCalled());
    const ws = fakeSocket();
    installReconnect(ws, 'Pseudo-AI', reconnect, onClose);

    failToConnect(ws);
    vi.advanceTimersByTime(1000);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});
