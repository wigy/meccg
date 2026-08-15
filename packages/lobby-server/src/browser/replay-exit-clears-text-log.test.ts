/**
 * @module replay-exit-clears-text-log.test
 *
 * Regression test for bug report "After replay, text log stays on screen"
 * (164759a6f6fad153). The report carried no game ID or sequence number — it
 * describes a browser UI defect reproducible from code inspection, not a
 * specific game's recorded log.
 *
 * `#game-log-panel` (the "text log" — see the `'text-log': 'game-log-panel'`
 * mapping in tutorial-panel.ts) is a `position: fixed` overlay declared as a
 * sibling of `#game` in index.html, not a child of it. `exitReplay()` hides
 * `#game` and clears the debug `#log`/`#state`/`#draft` panels but never
 * cleared the persistent per-game message log (`gameMessageLog`, driven by
 * `showNotification()`) that backs `#game-log-panel`. Because the panel sits
 * outside `#game`, hiding `#game` did not hide it, so messages toasted during
 * replay playback kept floating on screen after the viewer was closed.
 *
 * `disconnect()` in game-connection.ts already calls `clearGameMessageLog()`
 * when leaving a live game; `exitReplay()` now does the same when leaving a
 * replay.
 *
 * Uses the hand-rolled DOM stub pattern of `keyboard-shortcuts-spectator-hints.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom),
 * plus `vi.mock` for `./api.js` and `./game-connection.js` so the test does
 * not need a real network fetch or a full board render.
 */

import './test-dom-bootstrap.js'; // must precede the replay import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet }));

const { renderStateMessage, setLoadingCover, setReplayExit } = vi.hoisted(() => ({
  renderStateMessage: vi.fn(async () => { /* no-op: board rendering is out of scope for this test */ }),
  setLoadingCover: vi.fn(),
  setReplayExit: vi.fn(),
}));
vi.mock('./game-connection.js', () => ({ renderStateMessage, setLoadingCover, setReplayExit }));

// Vitest hoists the vi.mock calls above the static imports below, so
// replay.ts picks up the mocked api.js / game-connection.js.
import { startReplay, exitReplay } from './replay.js';
import { showNotification, gameMessageLog } from './render-log.js';

class StubClassList {
  private classes = new Set<string>();
  add(...cs: string[]): void { for (const c of cs) this.classes.add(c); }
  remove(...cs: string[]): void { for (const c of cs) this.classes.delete(c); }
  contains(c: string): boolean { return this.classes.has(c); }
}

class StubEl {
  id = '';
  classList = new StubClassList();
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  children: StubEl[] = [];
  scrollTop = 0;
  scrollHeight = 0;
  private _innerHTML = '';
  set innerHTML(v: string) { this._innerHTML = v; if (v === '') this.children = []; }
  get innerHTML(): string { return this._innerHTML; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  replaceChildren(): void { this.children = []; }
  remove(): void { /* no-op */ }
  addEventListener(): void { /* no-op */ }
  querySelector(): null { return null; }
  querySelectorAll(): StubEl[] { return []; }
}

const PANEL_IDS = ['game', 'log', 'state', 'draft', 'game-log-panel', 'game-log-header', 'game-log-entries'];

let elements: Record<string, StubEl>;

function installFreshDom(): void {
  elements = {};
  for (const id of PANEL_IDS) {
    const el = new StubEl();
    el.id = id;
    elements[id] = el;
  }
  const bodyEl = new StubEl();
  (globalThis as unknown as { document: unknown }).document = {
    body: bodyEl,
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => new StubEl(),
    addEventListener: () => { /* no-op */ },
    removeEventListener: () => { /* no-op */ },
  };
}

const REPLAY_INDEX = {
  gameId: 'game-1',
  seats: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }],
  frames: [
    { index: 0, seq: 1, ts: null, turn: 1, phase: 'organization', step: null, activePlayer: 'p1', reason: 'new-game', action: null },
  ],
};

beforeEach(() => {
  installFreshDom();
  gameMessageLog.messages = [];
  gameMessageLog.nextId = 1;
  gameMessageLog.anchor = null;
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url.includes('/frames/')) {
      return Promise.resolve({ ok: true, data: { view: { self: { id: 'p1' } } } });
    }
    return Promise.resolve({ ok: true, data: REPLAY_INDEX });
  });
  renderStateMessage.mockClear();
  setLoadingCover.mockClear();
  setReplayExit.mockClear();
});

describe('exiting the replay viewer', () => {
  test('clears the text-log panel populated during playback', async () => {
    await startReplay('game-1', null);

    // Simulate what a real renderStateMessage call does during playback:
    // toast an opponent action into the persistent per-game message log.
    showNotification('draws a card', { opponent: 'Bob' });
    expect(gameMessageLog.messages).toHaveLength(1);
    expect(elements['game-log-entries'].children).toHaveLength(1);

    exitReplay();

    expect(gameMessageLog.messages).toHaveLength(0);
    expect(elements['game-log-entries'].children).toHaveLength(0);
  });
});
