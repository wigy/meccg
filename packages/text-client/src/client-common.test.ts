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
import type { CardDefinition, PlayerView } from '@meccg/shared';
import { stripCardMarkers } from '@meccg/shared';
import { formatDraftLines, installReconnect, resetReconnectAttempts } from './client-common.js';

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

// ---- formatDraftLines ----

// The character-draft display used to guess which `draftState` entry is the
// viewing player's by probing which pool still held non-redacted cards
// (opponent pools arrive as 'unknown-instance' placeholders), defaulting to
// entry 0 when neither probe matched. A player seated at index 1 whose own
// pool has run empty — the engine auto-stops a player on an exhausted pool
// while the opponent keeps drafting — failed both probes, so the display
// swapped sides: the opponent's redacted pool printed as "Your pool" and the
// opponent's drafted list as "Your drafted". `view.selfIndex` exists
// precisely to index these player-ordered phase-state arrays.
describe('formatDraftLines', () => {
  /** Card pool where each fixture instance ID doubles as its definition ID. */
  const draftCardPool: Record<string, CardDefinition> = {
    'own-hero': { id: 'own-hero', name: 'Own Hero' } as CardDefinition,
    'opp-hero': { id: 'opp-hero', name: 'Opp Hero' } as CardDefinition,
  };

  /** A card reference as it appears in a draft pool or drafted list. */
  const card = (instanceId: string): { instanceId: string; definitionId: string } =>
    ({ instanceId, definitionId: instanceId });

  /** Empty per-player piles, enough for buildInstanceLookup to walk. */
  const emptySide = (name: string): Record<string, unknown> => ({
    name,
    hand: [], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [],
    characters: {}, companies: [], agents: [],
  });

  function draftView(selfIndex: number, draftState: readonly unknown[]): PlayerView {
    return {
      selfIndex,
      self: emptySide('Alice'),
      opponent: emptySide('Bob'),
      chain: null,
      phaseState: {
        phase: 'setup',
        setupStep: {
          step: 'character-draft',
          round: 2,
          draftState,
          setAside: [[], []],
        },
      },
    } as unknown as PlayerView;
  }

  it('labels the seats by selfIndex when the own pool is exhausted', () => {
    // Viewer is player index 1 with an empty pool; entry 0 is the opponent,
    // whose pool is redacted and whose drafted characters are public.
    const view = draftView(1, [
      { pool: [card('unknown-instance')], drafted: [card('opp-hero')], draftedStageResources: [], currentPick: null },
      { pool: [], drafted: [card('own-hero')], draftedStageResources: [], currentPick: null },
    ]);

    const lines = formatDraftLines(view, false, draftCardPool).map(stripCardMarkers);

    expect(lines).toContain('Your drafted: Own Hero');
    expect(lines).toContain('Opponent drafted: Opp Hero');
    expect(lines).toContain('Your pool: (empty)');
  });

  it('labels the seats by selfIndex for a player at index 0', () => {
    const view = draftView(0, [
      { pool: [card('own-hero')], drafted: [], draftedStageResources: [], currentPick: null },
      { pool: [card('unknown-instance')], drafted: [card('opp-hero')], draftedStageResources: [], currentPick: null },
    ]);

    const lines = formatDraftLines(view, false, draftCardPool).map(stripCardMarkers);

    expect(lines).toContain('Your pool: Own Hero');
    expect(lines).toContain('Opponent drafted: Opp Hero');
  });

  it('shows both players by name for a spectator', () => {
    const view = draftView(0, [
      { pool: [card('own-hero')], drafted: [], draftedStageResources: [], currentPick: null },
      { pool: [card('opp-hero')], drafted: [], draftedStageResources: [], currentPick: null },
    ]);

    const lines = formatDraftLines(view, true, draftCardPool).map(stripCardMarkers);

    expect(lines).toContain('Alice pool: Own Hero');
    expect(lines).toContain('Bob pool: Opp Hero');
  });

  it('returns no lines outside the character draft', () => {
    const view = {
      selfIndex: 0,
      self: emptySide('Alice'),
      opponent: emptySide('Bob'),
      chain: null,
      phaseState: { phase: 'organization' },
    } as unknown as PlayerView;

    expect(formatDraftLines(view, false, draftCardPool)).toEqual([]);
  });
});
