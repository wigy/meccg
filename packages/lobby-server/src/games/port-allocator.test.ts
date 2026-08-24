/**
 * @module games/port-allocator.test
 *
 * Regression tests for the game-server port allocator's behavior under
 * concurrent launches. The old shape — probe `nextPort` in a loop, then
 * claim with `nextPort++` — read the shared cursor across the probe's
 * await: two overlapping launches both probed the same value, the first
 * claimed it, and the second claimed the NEXT port without ever probing
 * it. If that port was held by an orphaned game server from a previous
 * lobby instance (the very state the probe loop exists for), the spawned
 * server failed to bind and the launch died on the 15 s startup timeout.
 * The allocator now claims a candidate synchronously BEFORE probing, so
 * every returned port is one its own caller probed free.
 */

import { describe, test, expect, vi } from 'vitest';

vi.mock('../lobby-log.js', () => ({ lobbyLog: { log: () => { /* silent */ }, close: () => { /* no-op */ } } }));

import { createPortAllocator } from './launcher.js';

/** A probe that yields the event loop once, like a real socket check. */
const probeWithBusy = (busy: Set<number>, probed: number[]) =>
  async (port: number): Promise<boolean> => {
    probed.push(port);
    await Promise.resolve();
    return !busy.has(port);
  };

describe('createPortAllocator', () => {
  test('skips a busy port and returns the next free one', async () => {
    const probed: number[] = [];
    const alloc = createPortAllocator(4000, probeWithBusy(new Set([4000]), probed));

    expect(await alloc()).toBe(4001);
    expect(probed).toEqual([4000, 4001]);
  });

  test('never returns a port its caller did not probe free, even under concurrency', async () => {
    // 4001 is an orphan's port. Two launches overlap: with claim-after-probe,
    // both probed 4000, the first took it and the second took 4001 UNPROBED —
    // exactly the orphan. With claim-before-probe the second caller claims
    // 4001, probes it busy, and moves on to 4002.
    const probed: number[] = [];
    const alloc = createPortAllocator(4000, probeWithBusy(new Set([4001]), probed));

    const ports = await Promise.all([alloc(), alloc()]);

    expect(ports).not.toContain(4001);
    expect(new Set(ports).size).toBe(2);
    for (const port of ports) expect(probed).toContain(port);
  });

  test('concurrent callers receive distinct ports', async () => {
    const alloc = createPortAllocator(4000, probeWithBusy(new Set(), []));
    const ports = await Promise.all([alloc(), alloc(), alloc(), alloc()]);
    expect(new Set(ports).size).toBe(4);
  });
});
