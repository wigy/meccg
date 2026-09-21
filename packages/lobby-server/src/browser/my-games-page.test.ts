/**
 * @module my-games-page.test
 *
 * Tests for the "My Games" page's Replay buttons: every row (in progress,
 * unfinished, finished) shares the same delegated click handler, which must
 * disable the clicked button for the duration of the (lazy) game-bundle
 * load and always replay seated as the calling player — unlike the Scores
 * page's per-player game list, every row here is the caller's own game.
 *
 * Uses the hand-rolled DOM stub pattern of `scoreboard-replay-button-disabled.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the my-games-page import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet }));

const { loadGameBundle } = vi.hoisted(() => ({ loadGameBundle: vi.fn() }));
vi.mock('./lazy-load.js', () => ({ loadGameBundle }));

// Vitest hoists the vi.mock calls above the static import below, so
// my-games-page.ts picks up the mocked api.js / lazy-load.js.
import { openMyGamesPage } from './my-games-page.js';
import { appState } from './app-state.js';

/** Minimal element stub: enough to hold the delegated click listener (see scoreboard's version). */
class StubEl {
  id = '';
  dataset: Record<string, string> = {};
  private _innerHTML = '';
  set innerHTML(v: string) { this._innerHTML = v; }
  get innerHTML(): string { return this._innerHTML; }
  private listeners: { type: string; cb: (event: unknown) => void }[] = [];
  addEventListener(type: string, cb: (event: unknown) => void): void { this.listeners.push({ type, cb }); }
  removeEventListener(): void { /* no-op */ }
  dispatch(type: string, event: unknown): void {
    for (const l of this.listeners) { if (l.type === type) l.cb(event); }
  }
  querySelector(): null { return null; }
}

/** Stand-in for a "Replay" `<button>` a click on a rendered row would target. */
class StubReplayButton {
  disabled = false;
  dataset: Record<string, string>;
  constructor(gameId: string) { this.dataset = { replayGame: gameId }; }
  closest(selector: string): this | null { return selector === '[data-replay-game]' ? this : null; }
}

let elements: Record<string, StubEl>;

function installFreshDom(): void {
  elements = { 'my-games-list': new StubEl() };
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
  };
}

const RESPONSE = {
  inProgress: null,
  unfinished: [{ gameId: 'game-unfinished', opponent: 'Bob', savedAt: '2026-08-14T23:00:00.000Z' }],
  finished: [],
};

beforeEach(() => {
  installFreshDom();
  appState.lobbyPlayerName = 'Alice';
  apiGet.mockReset();
  apiGet.mockResolvedValue({ ok: true, data: RESPONSE });
  loadGameBundle.mockReset();
  (globalThis as unknown as { window: { __meccg?: { startReplay?: (...args: unknown[]) => Promise<void> } } })
    .window = { __meccg: { startReplay: vi.fn(async () => { /* replay board render is out of scope */ }) } };
});

describe('clicking Replay on a My Games row', () => {
  test('disables the button immediately, re-enabling once startReplay resolves', async () => {
    await openMyGamesPage();

    let resolveBundle!: () => void;
    loadGameBundle.mockReturnValue(new Promise<void>((resolve) => { resolveBundle = resolve; }));

    const btn = new StubReplayButton('game-unfinished');
    elements['my-games-list'].dispatch('click', { target: btn });

    expect(btn.disabled).toBe(true);

    resolveBundle();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ns = (globalThis as unknown as { window: { __meccg: { startReplay: ReturnType<typeof vi.fn> } } }).window.__meccg;
    expect(ns.startReplay).toHaveBeenCalledWith('game-unfinished', 'Alice');
    expect(btn.disabled).toBe(false);
  });

  test('ignores a second click while the first is still loading', async () => {
    await openMyGamesPage();
    loadGameBundle.mockReturnValue(new Promise<void>(() => { /* never resolves in this test */ }));

    const btn = new StubReplayButton('game-unfinished');
    elements['my-games-list'].dispatch('click', { target: btn });
    elements['my-games-list'].dispatch('click', { target: btn });

    expect(loadGameBundle).toHaveBeenCalledTimes(1);
  });

  test('always replays seated as the calling player, not any opponent', async () => {
    appState.lobbyPlayerName = 'Carol';
    loadGameBundle.mockResolvedValue(undefined);
    await openMyGamesPage();

    const btn = new StubReplayButton('game-unfinished');
    elements['my-games-list'].dispatch('click', { target: btn });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ns = (globalThis as unknown as { window: { __meccg: { startReplay: ReturnType<typeof vi.fn> } } }).window.__meccg;
    expect(ns.startReplay).toHaveBeenCalledWith('game-unfinished', 'Carol');
  });
});

describe('openMyGamesPage empty state', () => {
  test('shows an empty-state message when the player has no games at all', async () => {
    apiGet.mockResolvedValue({ ok: true, data: { inProgress: null, unfinished: [], finished: [] } });
    await openMyGamesPage();
    expect(elements['my-games-list'].innerHTML).toContain('No games yet');
  });
});
