/**
 * @module replay-exit-returns-to-game.test
 *
 * Regression test for bug report "Exit replay button" (75fe44debbf00790):
 * "when i do a replay and the select exit replay the game closes and goes to
 * scoreboard and i cannot re enter the game". The report carried no game ID —
 * it describes a browser UI defect reproducible from code inspection.
 *
 * The in-game Replay button disconnects from the live game before opening the
 * replay viewer, and `exitReplay()` always went to the scoreboard. The only
 * way back was the lobby's "Resume Game" button — but the game server exits a
 * minute after its last human leaves, and once it has gone the lobby no
 * longer lists the game, so the button never appears and the player is
 * stranded. A replay opened from a live game now remembers the opponent and
 * exiting rejoins through the lobby (`rejoinGame` → `rejoin-game`), which
 * returns the running server or relaunches it from the autosave. A replay
 * opened from the Scores / My Games pages still exits to the scoreboard.
 *
 * Uses the hand-rolled DOM stub pattern of `replay-exit-clears-text-log.test.ts`.
 */

import './test-dom-bootstrap.js'; // must precede the replay import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet }));

const { rejoinGame, renderStateMessage, setLoadingCover, setReplayExit } = vi.hoisted(() => ({
  rejoinGame: vi.fn(),
  renderStateMessage: vi.fn(async () => { /* no-op: board rendering is out of scope for this test */ }),
  setLoadingCover: vi.fn(),
  setReplayExit: vi.fn(),
}));
vi.mock('./game-connection.js', () => ({ rejoinGame, renderStateMessage, setLoadingCover, setReplayExit }));

import { startReplay, exitReplay } from './replay.js';

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
  innerHTML = '';
  children: StubEl[] = [];
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  replaceChildren(): void { this.children = []; }
  remove(): void { /* no-op */ }
  addEventListener(): void { /* no-op */ }
  querySelector(): null { return null; }
  querySelectorAll(): StubEl[] { return []; }
}

const PANEL_IDS = ['game', 'log', 'state', 'draft', 'game-log-panel', 'game-log-header', 'game-log-entries'];

let elements: Record<string, StubEl>;
const showScreen = vi.fn();

function installFreshDom(): void {
  elements = {};
  for (const id of PANEL_IDS) {
    const el = new StubEl();
    el.id = id;
    elements[id] = el;
  }
  (globalThis as unknown as { document: unknown }).document = {
    body: new StubEl(),
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => new StubEl(),
    addEventListener: () => { /* no-op */ },
    removeEventListener: () => { /* no-op */ },
  };
}

const REPLAY_INDEX = {
  gameId: 'game-1',
  seats: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'AI-Modular' }],
  frames: [
    { index: 0, seq: 1, ts: null, turn: 1, phase: 'organization', step: null, activePlayer: 'p1', reason: 'new-game', action: null },
  ],
};

beforeEach(() => {
  installFreshDom();
  const ns = (globalThis as unknown as { window: { __meccg?: { showScreen?: unknown } } }).window.__meccg;
  if (ns) ns.showScreen = showScreen;
  showScreen.mockClear();
  rejoinGame.mockClear();
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url.includes('/frames/')) {
      return Promise.resolve({ ok: true, data: { view: { self: { id: 'p1' } } } });
    }
    return Promise.resolve({ ok: true, data: REPLAY_INDEX });
  });
});

describe('exiting the replay viewer', () => {
  test('a replay opened from a live game rejoins that game instead of going to the scoreboard', async () => {
    await startReplay('game-1', 'Alice', 'AI-Modular');

    exitReplay();

    expect(rejoinGame).toHaveBeenCalledWith('AI-Modular');
    expect(showScreen).not.toHaveBeenCalledWith('scoreboard-screen');
    expect(elements.game.classList.contains('hidden')).toBe(false);
  });

  test('a replay opened from a game list still exits to the scoreboard', async () => {
    await startReplay('game-1', 'Alice');

    exitReplay();

    expect(rejoinGame).not.toHaveBeenCalled();
    expect(showScreen).toHaveBeenCalledWith('scoreboard-screen');
    expect(elements.game.classList.contains('hidden')).toBe(true);
  });
});
