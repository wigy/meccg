/**
 * @module keyboard-shortcuts-pile-browser-empty.test
 *
 * Regression test for the pile-browser modal leaking keystrokes to the game
 * behind it. `handlePileBrowserKey`'s empty-selectables branch (any
 * browse-only open: viewing a discard pile / site deck / sideboard renders
 * plain imgs with no `site-selectable` class) consumed only Enter and the
 * arrow keys, returning false for everything else — despite its own comment
 * saying keys are swallowed so no underlying shortcut fires. The main
 * handler then kept processing: digits clicked hand cards, and Backspace /
 * Delete / Home clicked action buttons hidden behind the modal — an unseen
 * game action while the player was just browsing a pile. The branch now
 * swallows every key (Escape, handled before it, still closes the browser),
 * matching the selectable-cards path.
 *
 * Uses the hand-rolled DOM stub pattern of
 * `keyboard-shortcuts-spectator-hints.test.ts` (the package runs vitest in
 * the default node environment, with no jsdom).
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
  clicks = 0;
  click(): void { this.clicks++; }
  dispatchEvent(): void { this.clicks++; }
  addEventListener(): void { /* no-op */ }
  getBoundingClientRect() { return { left: 10, top: 10, width: 20, height: 20 }; }
  querySelectorAll(): StubEl[] { return []; }
}

type ShortcutKeyEvent = { key: string; repeat: boolean; code?: string; preventDefault: () => void; prevented?: boolean };

let keydownHandler: ((e: ShortcutKeyEvent) => void) | undefined;

let gameEl: StubEl;
let modalEl: StubEl;
let gridEl: StubEl;
let backdropEl: StubEl;
let toggleEl: StubEl;

function installFreshDom(): void {
  gameEl = new StubEl();
  modalEl = new StubEl();
  gridEl = new StubEl();
  backdropEl = new StubEl();
  toggleEl = new StubEl();

  const byId: Record<string, StubEl> = {
    game: gameEl,
    'pile-browser-modal': modalEl,
    'pile-browser-grid': gridEl,
    'pile-browser-backdrop': backdropEl,
  };
  (globalThis as unknown as { document: unknown }).document = {
    body: new StubEl(),
    activeElement: null,
    addEventListener: (type: string, handler: (e: ShortcutKeyEvent) => void) => {
      if (type === 'keydown') keydownHandler = handler;
    },
    getElementById: (id: string) => byId[id] ?? null,
    querySelector: (sel: string) => (sel === '.company-view-toggle' ? toggleEl : null),
    querySelectorAll: () => [],
    createElement: () => new StubEl(),
  };
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: () => { /* no-op */ },
  };
  (globalThis as unknown as { HTMLElement: unknown }).HTMLElement = class {};
  (globalThis as unknown as { MouseEvent: unknown }).MouseEvent = class {};
  (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
    observe(): void { /* no-op */ }
  };
}

const press = (key: string): ShortcutKeyEvent => {
  const e: ShortcutKeyEvent = { key, repeat: false, preventDefault: () => { e.prevented = true; } };
  keydownHandler?.(e);
  return e;
};

beforeAll(() => {
  installFreshDom();
  installKeyboardShortcuts(); // registers once; handlers read globalThis.document live
});

beforeEach(() => {
  installFreshDom();
});

describe('open pile browser with no selectable cards', () => {
  test('swallows Home instead of toggling the company view behind the modal', () => {
    const e = press('Home');

    expect(toggleEl.clicks).toBe(0);
    expect(e.prevented).toBe(true);
  });

  test('swallows a digit instead of letting hand-card shortcuts fire', () => {
    const e = press('1');

    expect(e.prevented).toBe(true);
  });

  test('Escape still closes the browser via the backdrop', () => {
    const e = press('Escape');

    expect(backdropEl.clicks).toBe(1);
    expect(e.prevented).toBe(true);
  });
});

describe('closed pile browser', () => {
  test('Home reaches the company view toggle as usual', () => {
    modalEl.classList.add('hidden');

    press('Home');

    expect(toggleEl.clicks).toBe(1);
  });
});
