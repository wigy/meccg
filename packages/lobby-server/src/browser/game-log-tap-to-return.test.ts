/**
 * @module game-log-tap-to-return.test
 *
 * Regression test for improvement request "text box control"
 * (93bea4fa1b725342, game mw6rsio6-y1dtx5): once the in-game text log was
 * scrolled back into history, the only way back to the current line was the
 * End key (or wheeling all the way down), which touch-screen players do not
 * have. The history header now doubles as a "tap here to return to latest"
 * control: clicking it drops the panel back to live-tail mode.
 *
 * Uses the hand-rolled DOM stub pattern of `ephemeral-system-toast.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede browser-module imports (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import { showNotification, scrollHistory, gameMessageLog } from './render-log.js';

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
  title = '';
  innerHTML = '';
  onclick: ((e: unknown) => void) | null = null;
  children: StubEl[] = [];
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  replaceChildren(): void { this.children = []; }
  addEventListener(): void { /* no-op */ }
  querySelector(): null { return null; }
  querySelectorAll(): StubEl[] { return []; }
}

const PANEL_IDS = ['game-log-panel', 'game-log-header', 'game-log-entries', 'game-log-system'];

let elements: Record<string, StubEl>;

beforeEach(() => {
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
  gameMessageLog.messages = [];
  gameMessageLog.nextId = 1;
  gameMessageLog.anchor = null;
});

describe('game log history header', () => {
  test('tapping the header while scrolled back returns to the latest line', () => {
    for (let i = 0; i < 5; i++) showNotification(`message ${i}`);
    scrollHistory(2);

    const header = elements['game-log-header'];
    expect(gameMessageLog.anchor).toBe(3);
    expect(header.classList.contains('hidden')).toBe(false);
    expect(header.textContent).toContain('tap here');
    expect(header.onclick).not.toBeNull();

    header.onclick?.({ preventDefault: () => {}, stopPropagation: () => {} });

    expect(gameMessageLog.anchor).toBeNull();
    expect(header.classList.contains('hidden')).toBe(true);
    expect(header.onclick).toBeNull();
    expect(elements['game-log-entries'].children).toHaveLength(5);
  });
});
