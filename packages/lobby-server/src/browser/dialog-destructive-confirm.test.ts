/**
 * @module dialog-destructive-confirm.test
 *
 * Regression coverage for bug report 974d2bb0d9d0fa9a (game mtifo38k-0s6g27):
 * a player's game ended in an unintended concession fired 98ms after their
 * last unrelated action — far too fast to be a deliberate click through the
 * concede confirmation dialog. Root cause: `showConfirm` always focused the
 * OK/destructive button and resolved Enter as confirm, so a single stray
 * Enter keypress (the same key players habitually use to advance through
 * the game) silently confirmed the dialog instead of dismissing it.
 * `ConfirmOptions.destructive` flips both: Cancel gets initial focus and
 * Enter cancels.
 *
 * Uses the hand-rolled DOM stub pattern of `tutorial-complete-exit-button.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */
import './test-dom-bootstrap.js'; // must precede the dialog import (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import { showConfirm } from './dialog.js';

class StubClassList {
  private classes = new Set<string>();
  add(...cs: string[]): void { for (const c of cs) this.classes.add(c); }
  remove(...cs: string[]): void { for (const c of cs) this.classes.delete(c); }
  contains(c: string): boolean { return this.classes.has(c); }
}

class StubEl {
  className = '';
  textContent = '';
  classList = new StubClassList();
  children: StubEl[] = [];
  focused = false;
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  remove(): void { /* no-op */ }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void { for (const h of this.listeners.click ?? []) h({}); }
  focus(): void { this.focused = true; }
}

let body: StubEl;
let documentListeners: Record<string, Array<(e: unknown) => void>>;

function installFreshDom(): void {
  body = new StubEl();
  documentListeners = {};
  (globalThis as unknown as { document: unknown }).document = {
    body,
    createElement: () => new StubEl(),
    appendChild: (child: StubEl) => body.appendChild(child),
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      (documentListeners[type] ??= []).push(handler);
    },
    removeEventListener: (type: string, handler: (e: unknown) => void) => {
      documentListeners[type] = (documentListeners[type] ?? []).filter(h => h !== handler);
    },
  };
}

/** Navigate the dialog structure `showDialog` builds to find [Cancel, OK]. */
function getButtons(): [StubEl, StubEl] {
  const modal = body.children[0];
  const dialogBox = modal.children[1];
  const actions = dialogBox.children[1];
  const [cancelBtn, okBtn] = actions.children;
  return [cancelBtn, okBtn];
}

function fireEnter(): void {
  for (const h of documentListeners.keydown ?? []) {
    h({ key: 'Enter', preventDefault() { /* no-op */ }, stopPropagation() { /* no-op */ } });
  }
}

describe('showConfirm destructive option', () => {
  beforeEach(() => {
    installFreshDom();
  });

  test('destructive: focuses Cancel and Enter cancels rather than confirms', async () => {
    const result = showConfirm('Concede this game?', { okLabel: 'Concede', cancelLabel: 'Cancel', destructive: true });
    const [cancelBtn, okBtn] = getButtons();
    expect(cancelBtn.focused).toBe(true);
    expect(okBtn.focused).toBe(false);

    fireEnter();
    await expect(result).resolves.toBe(false);
  });

  test('non-destructive (default): focuses OK and Enter confirms', async () => {
    const result = showConfirm('Delete this deck?', { okLabel: 'Delete' });
    const [cancelBtn, okBtn] = getButtons();
    expect(okBtn.focused).toBe(true);
    expect(cancelBtn.focused).toBe(false);

    fireEnter();
    await expect(result).resolves.toBe(true);
  });
});
