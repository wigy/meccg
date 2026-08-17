/**
 * @module tutorial-complete-leave-button.test
 *
 * Regression test for bug report "End of tutorial" (a7b0bd218b957a38): once
 * the tutorial script is exhausted, `gateHumanActions` demotes every human
 * action to non-viable except `pass-chain-priority` (game
 * mswxdi8m-pxuvg8, stateSeq 227 — player p1 had zero viable actions in the
 * logged legalActions), yet the completion panel offered no way to leave.
 * The panel now renders a "Return to Lobby" button when `progress.done`,
 * wired to a callback the panel owner registers via `setLeaveTutorial` (the
 * same forward-reference pattern `setReplayExit` uses to avoid a circular
 * import with game-connection.ts, which both defines `disconnect()` and
 * calls `renderTutorialPanel`).
 *
 * Uses the hand-rolled DOM stub pattern of `replay-exit-clears-text-log.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */
import './test-dom-bootstrap.js'; // must precede the tutorial-panel import (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import type { PlayerView, TutorialProgress } from '@meccg/shared';
import { renderTutorialPanel, setLeaveTutorial } from './tutorial-panel.js';

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
  private listeners: Record<string, (() => void)[]> = {};
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  remove(): void { /* no-op */ }
  addEventListener(type: string, handler: () => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void { for (const h of this.listeners.click ?? []) h(); }
  querySelector(selector: string): StubEl | null {
    return this.children.find(c => `.${c.className}` === selector) ?? null;
  }
}

let elements: Record<string, StubEl>;
let body: StubEl;

function installFreshDom(): void {
  elements = { 'visual-board': (() => { const el = new StubEl(); el.id = 'visual-board'; return el; })() };
  body = new StubEl();
  (globalThis as unknown as { document: unknown }).document = {
    body,
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => new StubEl(),
    createTextNode: () => new StubEl(),
  };
}

const baseProgress: Omit<TutorialProgress, 'done'> = {
  stepId: 'tutorial-complete',
  title: 'Tutorial complete',
  body: 'You have played three full rounds.',
  stepIndex: 58,
  stepCount: 59,
  yourTurn: false,
};

function viewWith(progress: TutorialProgress): PlayerView {
  return { tutorial: progress } as unknown as PlayerView;
}

describe('tutorial completion panel', () => {
  beforeEach(() => {
    installFreshDom();
  });

  test('renders a Return to Lobby button once the script is done, wired to the registered handler', () => {
    let left = false;
    setLeaveTutorial(() => { left = true; });

    renderTutorialPanel(viewWith({ ...baseProgress, done: true }), {});

    const panel = body.children.find(c => c.id === 'tutorial-panel');
    expect(panel).toBeDefined();
    const leaveBtn = panel!.querySelector('.tutorial-leave-btn');
    expect(leaveBtn, 'completion panel is missing its exit button').toBeDefined();
    expect(leaveBtn!.textContent).toBe('Return to Lobby ➜');

    leaveBtn!.click();
    expect(left, 'clicking the button did not invoke the registered leave handler').toBe(true);
  });

  test('does not render the button while the tutorial is still in progress', () => {
    renderTutorialPanel(viewWith({ ...baseProgress, done: false }), {});

    const panel = body.children.find(c => c.id === 'tutorial-panel');
    expect(panel).toBeDefined();
    expect(panel!.querySelector('.tutorial-leave-btn')).toBeNull();
  });
});
