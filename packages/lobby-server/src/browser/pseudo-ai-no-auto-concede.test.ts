/**
 * @module pseudo-ai-no-auto-concede.test
 *
 * Regression test for bug report 3549a8d20fff94a6 (game mucfnod6-eroa8a, seq
 * 4): "Pseudo AI doesnt seem to work for me" — a Pseudo-AI game ended in
 * `game-over` via a `concede` from the AI seat one action after the human
 * had only just started the character draft.
 *
 * The server appends the always-viable `concede` meta-action to every seat's
 * legal-action set (`withConcedeAction`, applied per connection in
 * `game-session.ts`). During the character draft, a player who has just made
 * their face-down pick has no other legal action while waiting for the
 * opponent to reveal (`draftActions` returns `[]` — see
 * `packages/shared/src/engine/legal-actions/draft.ts`), so the AI seat's
 * legal-action set collapses to exactly `[concede]`. `renderPseudoAiActions`
 * previously auto-picked whenever there was exactly one viable action,
 * without excluding `concede` — silently ending the game on the human's
 * behalf. `concede` must always be an explicit click.
 */

import './test-dom-bootstrap.js'; // must precede pseudo-ai.js import (load-time window access)
import { describe, test, expect, beforeEach } from 'vitest';
import type { PlayerId, CardInstanceId, GameAction } from '@meccg/shared';

import { renderPseudoAiActions, type DescribedAction } from './pseudo-ai.js';
import { appState } from './app-state.js';

const AI_PLAYER = 'p2' as PlayerId;

class StubEl {
  tagName: string;
  id = '';
  textContent = '';
  className = '';
  title = '';
  disabled = false;
  children: StubEl[] = [];
  parent: StubEl | null = null;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      const want = force === undefined ? !this.classList.classes.has(c) : force;
      if (want) this.classList.classes.add(c); else this.classList.classes.delete(c);
      return want;
    },
  };

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); child.parent = this; return child; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
  cloneNode(): StubEl {
    const clone = new StubEl(this.tagName);
    clone.textContent = this.textContent;
    return clone;
  }
  replaceWith(other: StubEl): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx >= 0) this.parent.children[idx] = other;
    other.parent = this.parent;
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

class StubWebSocket {
  static OPEN = 1;
  readyState = StubWebSocket.OPEN;
  sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
}

let elementsById: Map<string, StubEl>;

function elById(id: string, tag = 'div'): StubEl {
  const el = new StubEl(tag);
  el.id = id;
  elementsById.set(id, el);
  return el;
}

beforeEach(() => {
  elementsById = new Map();
  elById('pseudo-ai-panel');
  elById('pseudo-ai-actions');
  elById('pseudo-ai-nonviable-toggle', 'button');
  elById('pseudo-ai-instruction', 'span');

  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => elementsById.get(id) ?? null,
  };

  appState.pseudoAiWs = new StubWebSocket() as unknown as typeof appState.pseudoAiWs;
});

const concedeAction = { type: 'concede', player: AI_PLAYER } as const satisfies GameAction;
const draftPickAction = {
  type: 'draft-pick',
  player: AI_PLAYER,
  characterInstanceId: 'p2-98' as CardInstanceId,
} as const satisfies GameAction;

describe('pseudo-AI panel never auto-concedes', () => {
  test('does not send concede when it is the only viable action (waiting on opponent mid-draft)', () => {
    const actions: DescribedAction[] = [
      { text: 'Concede', action: concedeAction, viable: true },
    ];

    renderPseudoAiActions(actions);

    const ws = appState.pseudoAiWs as unknown as StubWebSocket;
    expect(ws.sent).toHaveLength(0);
  });

  test('still auto-picks a lone real action alongside the always-present concede option', () => {
    const actions: DescribedAction[] = [
      { text: 'Draft a character', action: draftPickAction, viable: true },
      { text: 'Concede', action: concedeAction, viable: true },
    ];

    renderPseudoAiActions(actions);

    const ws = appState.pseudoAiWs as unknown as StubWebSocket;
    expect(ws.sent).toHaveLength(1);
    const sent = JSON.parse(ws.sent[0]) as { action: GameAction };
    expect(sent.action.type).toBe('draft-pick');
  });
});
