/**
 * @module ephemeral-system-toast.test
 *
 * Regression test for feature request "Can we have the full roll in the
 * developpers tools" (388d788bbb24b92f): filing a bug report mid-game made
 * the roll notification that had just appeared vanish from `#game-log-panel`.
 *
 * `#game-log-panel` is a fixed-height, clipped, live-tail view of
 * `gameMessageLog.messages` (see `render-log.ts`). The "Bug report sent!" /
 * "Request sent!" confirmations used to go through `showNotification()` like
 * any other message, so filing a report appended one more line at the bottom
 * of the clipped viewport and pushed whatever had just been shown — including
 * a roll notification — up past the clipped top edge, out of view (though
 * still reachable via PgUp).
 *
 * `showSystemNotification()` now renders these confirmations into their own
 * `#game-log-system` container instead: it never touches `gameMessageLog` or
 * `#game-log-entries`, so it cannot evict anything from the toast view, and it
 * fades itself out on a timer rather than lingering until scrolled off.
 *
 * Uses the hand-rolled DOM stub pattern of `replay-exit-clears-text-log.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom),
 * extended with a working `remove()` so the auto-fade timer can be observed.
 */

import './test-dom-bootstrap.js'; // must precede browser-module imports (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { showNotification, showSystemNotification, gameMessageLog } from './render-log.js';

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
  className = '';
  textContent = '';
  children: StubEl[] = [];
  parent: StubEl | null = null;
  scrollTop = 0;
  scrollHeight = 0;
  private clickHandlers: (() => void)[] = [];
  private _innerHTML = '';
  set innerHTML(v: string) { this._innerHTML = v; if (v === '') this.children = []; }
  get innerHTML(): string { return this._innerHTML; }
  appendChild(child: StubEl): StubEl { child.parent = this; this.children.push(child); return child; }
  replaceChildren(): void { this.children = []; }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
  addEventListener(event: string, cb: () => void): void { if (event === 'click') this.clickHandlers.push(cb); }
  dispatchClick(): void { for (const cb of this.clickHandlers) cb(); }
  querySelector(): null { return null; }
  querySelectorAll(): StubEl[] { return []; }
}

const PANEL_IDS = ['game-log-panel', 'game-log-header', 'game-log-entries', 'game-log-system'];

let elements: Record<string, StubEl>;

function installFreshDom(): void {
  elements = {};
  for (const id of PANEL_IDS) {
    const el = new StubEl();
    el.id = id;
    elements[id] = el;
  }
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => new StubEl(),
    addEventListener: () => { /* no-op */ },
    removeEventListener: () => { /* no-op */ },
  };
}

beforeEach(() => {
  installFreshDom();
  gameMessageLog.messages = [];
  gameMessageLog.nextId = 1;
  gameMessageLog.anchor = null;
});

describe('ephemeral system notification', () => {
  test('does not write into gameMessageLog or the persistent entries view', () => {
    showSystemNotification('Bug report sent!');

    expect(gameMessageLog.messages).toHaveLength(0);
    expect(elements['game-log-entries'].children).toHaveLength(0);
    expect(elements['game-log-system'].children).toHaveLength(1);
  });

  test('a roll notification stays visible in #game-log-entries after a system toast fires', () => {
    // The reported bug: a roll notification just landed in the toast view...
    showNotification('rolled 4 + 5 = 9 (Corruption: Glorfindel II)', { opponent: 'AI-Real' });
    expect(elements['game-log-entries'].children).toHaveLength(1);
    const rollEntry = elements['game-log-entries'].children[0];

    // ...then a bug report is filed mid-game.
    showSystemNotification('Bug report sent!');

    // The roll notification is untouched: same element, still in #game-log-entries.
    expect(elements['game-log-entries'].children).toEqual([rollEntry]);
    expect(gameMessageLog.messages).toHaveLength(1);
  });

  test('does not disturb an anchored (scrolled-back) history view', () => {
    showNotification('opponent draws a card', { opponent: 'AI-Real' });
    gameMessageLog.anchor = 1;

    showSystemNotification('Request sent!');

    expect(gameMessageLog.anchor).toBe(1);
    expect(elements['game-log-system'].children).toHaveLength(1);
  });

  test('fades itself out on a timer without needing a scroll to be dismissed', () => {
    vi.useFakeTimers();
    try {
      showSystemNotification('Improvement suggestion sent!');
      expect(elements['game-log-system'].children).toHaveLength(1);

      vi.advanceTimersByTime(10_000);

      expect(elements['game-log-system'].children).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a close click dismisses the toast immediately', () => {
    showSystemNotification('Bug report sent!');
    const toast = elements['game-log-system'].children[0];
    const closeBtn = toast.children[0];

    closeBtn.dispatchClick();

    expect(elements['game-log-system'].children).toHaveLength(0);
  });
});
