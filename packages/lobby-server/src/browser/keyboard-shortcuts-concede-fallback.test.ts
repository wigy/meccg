/**
 * @module keyboard-shortcuts-concede-fallback.test
 *
 * Regression test for bug report 162fe192d90019b8 (games mtixbm0i-jwlilj,
 * mtixey00-7iug89, mtjg5wav-po0ojf): players were "automatically conceding"
 * a couple of actions into their first movement/hazard phase.
 *
 * Root cause: `withConcedeAction` (packages/shared) appends `concede` to
 * every player-facing legal-action set as always-viable, so on a player's
 * idle turns (already passed, waiting on the opponent) it is often the
 * *only* viable action. `render-actions.ts` renders it as a plain enabled
 * button in the `#actions` debug panel — which stays in the DOM even in
 * visual view. `getPrimaryButtons()`'s Enter/Backspace/Delete fallback
 * (`getActionButtons()`) auto-fires whenever that list has exactly
 * one/two/three buttons, with no confirmation — so a player hitting Enter
 * out of habit while waiting on their opponent silently conceded.
 *
 * Fix: `render-actions.ts` tags the concede button `.action-concede`, and
 * `getActionButtons()` excludes it, so it can never be the sole (or Nth)
 * button that a keyboard shortcut auto-fires.
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
  add(...cs: string[]): void { for (const c of cs) this.classes.add(c); }
  remove(...cs: string[]): void { for (const c of cs) this.classes.delete(c); }
  contains(c: string): boolean { return this.classes.has(c); }
}

class StubEl {
  classList = new StubClassList();
  style: Record<string, string> = {};
  disabled = false;
  clicks = 0;
  dispatchEvent(): void { this.clicks++; }
  addEventListener(): void { /* no-op */ }
  getBoundingClientRect() { return { left: 10, top: 10, width: 20, height: 20 }; }
}

type ShortcutKeyEvent = { key: string; repeat: boolean; code?: string; preventDefault: () => void; prevented?: boolean };

let keydownHandler: ((e: ShortcutKeyEvent) => void) | undefined;

let gameEl: StubEl;
let passBtnEl: StubEl;
let actionButtons: StubEl[];

function installFreshDom(): void {
  gameEl = new StubEl();
  passBtnEl = new StubEl();
  passBtnEl.classList.add('hidden'); // waiting on opponent — no pass action available
  actionButtons = [];

  const byId: Record<string, StubEl> = {
    game: gameEl,
    'pass-btn': passBtnEl,
  };
  (globalThis as unknown as { document: unknown }).document = {
    body: new StubEl(),
    activeElement: null,
    addEventListener: (type: string, handler: (e: ShortcutKeyEvent) => void) => {
      if (type === 'keydown') keydownHandler = handler;
    },
    getElementById: (id: string) => byId[id] ?? null,
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel === '.enter-site-btn') return [];
      if (sel.startsWith('#actions button')) {
        return actionButtons.filter(b => {
          if (sel.includes(':not([disabled])') && b.disabled) return false;
          if (sel.includes(':not(.action-concede)') && b.classList.contains('action-concede')) return false;
          return true;
        });
      }
      return [];
    },
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

describe('Enter shortcut ignores the always-present concede action', () => {
  test('does not fire when concede is the only viable action', () => {
    const concedeBtn = new StubEl();
    concedeBtn.classList.add('action-concede');
    actionButtons = [concedeBtn];

    const e = press('Enter');

    expect(concedeBtn.clicks).toBe(0);
    expect(e.prevented).toBeUndefined();
  });

  test('still fires for a genuine sole action alongside the always-present concede button', () => {
    const realBtn = new StubEl();
    const concedeBtn = new StubEl();
    concedeBtn.classList.add('action-concede');
    actionButtons = [realBtn, concedeBtn];

    const e = press('Enter');

    expect(realBtn.clicks).toBe(1);
    expect(concedeBtn.clicks).toBe(0);
    expect(e.prevented).toBe(true);
  });
});
