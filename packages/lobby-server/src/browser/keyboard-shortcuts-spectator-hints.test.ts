/**
 * @module keyboard-shortcuts-spectator-hints.test
 *
 * Regression test for bug report "Shortcuts" (bd4821d5324d778c, reported
 * against game ms7zrew8-h6uhu5): the Shift-held key-hint overlay labelled
 * every clickable target regardless of whether the current connection was a
 * spectator. Spectators never get an interactive hand (rendered as face-down
 * static backs — see render-hand.ts) and can't submit actions at all, so the
 * hints just labelled targets nobody was allowed to click.
 *
 * `showShortcutLabels` / `showPileLabelsOnly` now bail out early while
 * `document.body` carries the `spectating` class (set in game-connection.ts
 * on every connect).
 *
 * Uses a tiny hand-rolled DOM stub (the package runs vitest in the default
 * node environment, with no jsdom) — just enough for the keydown dispatch
 * path through `installKeyboardShortcuts` to reach the Shift-key branch.
 */

import './test-dom-bootstrap.js'; // must precede the keyboard-shortcuts import (load-time window access)
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { installKeyboardShortcuts } from './keyboard-shortcuts.js';

class StubClassList {
  private classes = new Set<string>();
  add(c: string): void { this.classes.add(c); }
  remove(c: string): void { this.classes.delete(c); }
  contains(c: string): boolean { return this.classes.has(c); }
}

class StubEl {
  classList = new StubClassList();
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  addEventListener(): void { /* no-op */ }
  getBoundingClientRect() { return { left: 10, top: 10, width: 20, height: 20 }; }
  appendChild(child: StubEl): StubEl {
    appendedLabels.push(child);
    return child;
  }
}

type ShortcutKeyEvent = { key: string; repeat: boolean; code?: string };

let keydownHandler: ((e: ShortcutKeyEvent) => void) | undefined;
let keyupHandler: ((e: ShortcutKeyEvent) => void) | undefined;

let bodyEl: StubEl;
let gameEl: StubEl;
let toggleEl: StubEl;
let appendedLabels: StubEl[];

function installFreshDom(): void {
  bodyEl = new StubEl();
  gameEl = new StubEl();
  toggleEl = new StubEl();
  appendedLabels = [];

  (globalThis as unknown as { document: unknown }).document = {
    body: bodyEl,
    activeElement: null,
    addEventListener: (type: string, handler: (e: ShortcutKeyEvent) => void) => {
      if (type === 'keydown') keydownHandler = handler;
      if (type === 'keyup') keyupHandler = handler;
    },
    getElementById: (id: string) => (id === 'game' ? gameEl : null),
    querySelector: (sel: string) => (sel === '.company-view-toggle' ? toggleEl : null),
    querySelectorAll: () => [],
    createElement: () => new StubEl(),
  };
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: () => { /* no-op */ },
  };
  // Real HTMLElement isn't defined under the node test environment; the popup-menu
  // key handler does `focused instanceof HTMLElement`, which only needs *some*
  // constructor to compare against (our stubbed `activeElement` is always null).
  (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = class {};
  // installKeyboardShortcuts wires a MutationObserver for popup auto-focus at
  // install time — never triggered in this test, but it must exist to construct.
  (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
    observe(): void { /* no-op */ }
  };
}

beforeAll(() => {
  installFreshDom();
  installKeyboardShortcuts(); // registers once; handlers read globalThis.document live
});

beforeEach(() => {
  installFreshDom();
  keyupHandler?.({ key: 'Shift', repeat: false }); // reset shiftLabelsShown from any prior test
});

describe('Shift key-hint overlay honors spectator mode', () => {
  test('labels the company-view toggle for an active player', () => {
    keydownHandler!({ key: 'Shift', repeat: false });

    expect(appendedLabels.some(l => l.textContent === 'Home')).toBe(true);
  });

  test('shows no hints while spectating', () => {
    bodyEl.classList.add('spectating');

    keydownHandler!({ key: 'Shift', repeat: false });

    expect(appendedLabels).toHaveLength(0);
  });
});
