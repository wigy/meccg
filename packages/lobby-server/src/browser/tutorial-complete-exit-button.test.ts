/**
 * @module tutorial-complete-exit-button.test
 *
 * The end of a tutorial chapter: once the script is exhausted,
 * `gateHumanActions` demotes every human action to non-viable except
 * `pass-chain-priority`, so the board offers nothing to click. The panel
 * must therefore hand the player the way out itself — a centered card
 * recapping the chapter with a single "Exit Tutorial" button, wired to a
 * callback the panel owner registers via `setExitTutorial` (the forward-
 * reference pattern `setReplayExit` uses to avoid a circular import with
 * game-connection.ts, which both defines `disconnect()` and calls
 * `renderTutorialPanel`).
 *
 * Uses the hand-rolled DOM stub pattern of `replay-exit-clears-text-log.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */
import './test-dom-bootstrap.js'; // must precede the tutorial-panel import (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import type { PlayerView, TutorialProgress } from '@meccg/shared';
import { renderTutorialPanel, setExitTutorial } from './tutorial-panel.js';

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
  stepId: 'chapter-one-complete',
  title: 'Chapter one complete',
  body: 'You have played a full turn of MECCG.',
  stepIndex: 33,
  stepCount: 34,
  yourTurn: false,
};

function viewWith(progress: TutorialProgress): PlayerView {
  return { tutorial: progress } as unknown as PlayerView;
}

describe('tutorial completion card', () => {
  beforeEach(() => {
    installFreshDom();
  });

  test('replaces the instruction panel with a centered recap and an exit button', () => {
    let left = false;
    setExitTutorial(() => { left = true; });

    renderTutorialPanel(viewWith({
      ...baseProgress,
      done: true,
      learned: ['Drafting a company.', 'Entering a ruin.'],
      footer: 'Chapter two is still to come.',
    }), {});

    expect(body.children.find(c => c.id === 'tutorial-panel'), 'the docked step panel should be gone').toBeUndefined();
    expect(body.children.find(c => c.id === 'tutorial-dim'), 'the board should be dimmed behind the card').toBeDefined();

    const card = body.children.find(c => c.id === 'tutorial-complete');
    expect(card, 'no completion card rendered').toBeDefined();
    expect(card!.querySelector('.tutorial-complete-title')?.textContent).toBe('Chapter one complete');

    const learned = card!.querySelector('.tutorial-complete-learned');
    expect(learned, 'the recap lists nothing the chapter taught').toBeDefined();
    expect(learned!.children).toHaveLength(2);
    expect(card!.querySelector('.tutorial-panel-footer')?.textContent).toBe('Chapter two is still to come.');

    const exitBtn = card!.querySelector('.tutorial-exit-btn');
    expect(exitBtn, 'completion card is missing its exit button').toBeDefined();
    expect(exitBtn!.textContent).toBe('Exit Tutorial');

    exitBtn!.click();
    expect(left, 'clicking the button did not invoke the registered exit handler').toBe(true);
  });

  test('renders the ordinary step panel while the chapter is still running', () => {
    renderTutorialPanel(viewWith({ ...baseProgress, stepId: 'untap-1', title: 'The untap phase', done: false }), {});

    expect(body.children.find(c => c.id === 'tutorial-complete')).toBeUndefined();
    const panel = body.children.find(c => c.id === 'tutorial-panel');
    expect(panel).toBeDefined();
    expect(panel!.querySelector('.tutorial-exit-btn')).toBeNull();
  });
});
