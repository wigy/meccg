/**
 * @module scoreboard-replay-button-disabled.test
 *
 * Regression test for bug report "After pressing replay, the screen should
 * dim since it takes some time until replay starts. At least disable the
 * button." (845041c969e8e998). The report carried no game ID or sequence
 * number — it describes a browser UI defect reproducible from code
 * inspection, not a specific game's recorded log.
 *
 * The scoreboard's per-player game list opens a replay by lazily loading the
 * game bundle (`loadGameBundle()`, a `<script>` fetch) before handing off to
 * `startReplay()`. That fetch can take a noticeable moment, and until it
 * resolves nothing on screen changes — the "Replay" button stayed enabled
 * and clickable with no loading feedback. The fix disables the clicked
 * button for the duration, re-enabling it only if starting the replay fails
 * (on success the scoreboard page is hidden behind the game screen anyway).
 *
 * Uses the hand-rolled DOM stub pattern of `replay-exit-clears-text-log.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the scoreboard-page import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet }));

const { loadGameBundle } = vi.hoisted(() => ({ loadGameBundle: vi.fn() }));
vi.mock('./lazy-load.js', () => ({ loadGameBundle }));

// Vitest hoists the vi.mock calls above the static import below, so
// scoreboard-page.ts picks up the mocked api.js / lazy-load.js.
import { openPlayerGamesPage } from './scoreboard-page.js';

/**
 * Minimal element stub: enough to hold the delegated click listener. Like
 * real DOM — and unlike an earlier Map-keyed version of this stub, which
 * masked a listener-stacking bug by deduplicating per event type —
 * `addEventListener` accumulates every registered listener and `dispatch`
 * fires them in registration order.
 */
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

/** Stand-in for the "Replay" `<button>` a click on the rendered list would target. */
class StubReplayButton {
  disabled = false;
  dataset: Record<string, string>;
  constructor(gameId: string) { this.dataset = { replayGame: gameId }; }
  closest(selector: string): this | null { return selector === '[data-replay-game]' ? this : null; }
}

let elements: Record<string, StubEl>;

function installFreshDom(): void {
  elements = { 'scoreboard-page-list': new StubEl() };
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
  };
}

const SIDE = {
  name: 'Alice',
  human: true,
  alignment: 'good',
  avatar: null,
  deckName: 'Deck',
  gameLength: '5 turns',
  startingPlayer: true,
  finalScore: 20,
  mp: null,
  tournamentMp: null,
  stagePoints: 10,
};

const GAMES_RESPONSE = {
  name: 'Alice',
  games: [{
    gameId: 'game-42',
    startedAt: '2026-08-14T23:00:00.000Z',
    endedAt: '2026-08-15T00:00:00.000Z',
    durationSeconds: 600,
    turns: 5,
    result: 'win',
    winner: 'Alice',
    winReason: 'agents',
    winCard: null,
    self: SIDE,
    opponent: { ...SIDE, name: 'Bob' },
    ratingBefore: 1000,
    ratingAfter: 1010,
    ratingDelta: 10,
  }],
};

beforeEach(() => {
  installFreshDom();
  apiGet.mockReset();
  apiGet.mockResolvedValue({ ok: true, data: GAMES_RESPONSE });
  loadGameBundle.mockReset();
  (globalThis as unknown as { window: { __meccg?: { startReplay?: (...args: unknown[]) => Promise<void> } } })
    .window = { __meccg: { startReplay: vi.fn(async () => { /* replay board render is out of scope */ }) } };
});

describe('clicking Replay on a player game card', () => {
  test('disables the button immediately, re-enabling once startReplay resolves', async () => {
    await openPlayerGamesPage('Alice');

    let resolveBundle!: () => void;
    loadGameBundle.mockReturnValue(new Promise<void>((resolve) => { resolveBundle = resolve; }));

    const btn = new StubReplayButton('game-42');
    elements['scoreboard-page-list'].dispatch('click', { target: btn });

    // Still awaiting the lazy bundle fetch — button must already be disabled.
    expect(btn.disabled).toBe(true);

    resolveBundle();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ns = (globalThis as unknown as { window: { __meccg: { startReplay: ReturnType<typeof vi.fn> } } }).window.__meccg;
    expect(ns.startReplay).toHaveBeenCalledWith('game-42', 'Alice');
    expect(btn.disabled).toBe(false);
  });

  test('ignores a second click while the first is still loading', async () => {
    await openPlayerGamesPage('Alice');
    loadGameBundle.mockReturnValue(new Promise<void>(() => { /* never resolves in this test */ }));

    const btn = new StubReplayButton('game-42');
    elements['scoreboard-page-list'].dispatch('click', { target: btn });
    elements['scoreboard-page-list'].dispatch('click', { target: btn });

    expect(loadGameBundle).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression test: `openPlayerGamesPage` used to add a fresh delegated
   * click listener to the persistent `#scoreboard-page-list` container on
   * every visit, each closing over that visit's player name. Real DOM does
   * not deduplicate listeners (the earlier Map-keyed stub did, masking
   * this), and the oldest handler fires first: it passes the `disabled`
   * guard, disables the button, and starts the replay seated as the FIRST
   * player ever viewed, while the newer, correct handler sees the disabled
   * button and returns. Scoreboard → Alice → back → Bob → Replay therefore
   * opened the replay seated as Alice — the wrong perspective's hand and
   * hidden information shown as "self".
   */
  test('opens the replay seated as the currently viewed player after visiting another player first', async () => {
    await openPlayerGamesPage('Alice');

    apiGet.mockResolvedValue({
      ok: true,
      data: { ...GAMES_RESPONSE, name: 'Bob', games: [{ ...GAMES_RESPONSE.games[0], gameId: 'game-77' }] },
    });
    await openPlayerGamesPage('Bob');

    loadGameBundle.mockResolvedValue(undefined);
    const btn = new StubReplayButton('game-77');
    elements['scoreboard-page-list'].dispatch('click', { target: btn });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ns = (globalThis as unknown as { window: { __meccg: { startReplay: ReturnType<typeof vi.fn> } } }).window.__meccg;
    expect(ns.startReplay).toHaveBeenCalledTimes(1);
    expect(ns.startReplay).toHaveBeenCalledWith('game-77', 'Bob');
  });
});
