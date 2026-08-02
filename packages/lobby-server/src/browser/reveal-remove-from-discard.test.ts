/**
 * @module reveal-remove-from-discard.test
 *
 * Regression test for bug report 3da4ff915bcdb80f (follow-up to
 * daa2be3a5a17bd7b, game msbonr8h-4h3go6, seq 188): playing *Aware of their
 * Ways* (dm-46) correctly enqueues a `reveal-remove-from-discard` pending
 * resolution with four `remove-revealed-card` legal actions plus a `pass` —
 * confirmed by the engine's `revealRemoveFromDiscardActions` — but the
 * browser client never wired those actions to anything clickable. Every
 * other pile-picking sub-flow (`fetch-from-pile`, site selection) has a
 * `prepare*` function that highlights a pile and lets `populateBrowserGrid`'s
 * `siteSelectionMatcher` make individual cards clickable; this one had none,
 * so the opponent's discard pile never lit up and the only visible action
 * was Pass — exactly what the reporter saw ("they didn't appear on screen
 * and I could only pass").
 *
 * Fixed by adding `prepareRevealRemoveFromDiscard`, wired into
 * `game-connection.ts`'s per-view selection dispatch alongside the existing
 * `fetch-from-pile` and site-selection branches.
 *
 * Uses the hand-rolled DOM stub pattern of `company-attachments-render.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, ViewCard, CardInstanceId, PlayerId } from '@meccg/shared';
import { renderDeckPiles, prepareRevealRemoveFromDiscard } from './render-piles.js';

const pool = loadCardPool();

// Real definition IDs (any four suffice — only their presence in the pool matters).
const DEF_IDS = ['le-268', 'le-288', 'wh-74', 'wh-106', 'wh-75', 'td-67'];

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  title = '';
  alt = '';
  src = '';
  textContent = '';
  listeners: Record<string, Array<() => void>> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(event: string, handler: () => void): void {
    (this.listeners[event] ??= []).push(handler);
  }
  click(): void { for (const h of this.listeners.click ?? []) h(); }
  querySelectorAll(selector: string): StubEl[] {
    return this.children.filter(c => c.tagName === selector);
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
}

let byId: Record<string, StubEl>;

beforeEach(() => {
  byId = {
    'opponent-discard-pile': new StubEl('div'),
    'opponent-deck-box': new StubEl('div'),
    'pile-browser-modal': new StubEl('div'),
    'pile-browser-title': new StubEl('div'),
    'pile-browser-grid': new StubEl('div'),
  };
  byId['opponent-deck-box'].classList.add('deck-box--compact');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? null,
    addEventListener: () => { /* no-op: document-level Escape handler */ },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const OPPONENT_ID = 'p2' as PlayerId;

const discardCard = (idx: number, instanceId: string): ViewCard =>
  ({ instanceId: instanceId as CardInstanceId, definitionId: DEF_IDS[idx % DEF_IDS.length] } as unknown as ViewCard);

const oppDiscard: ViewCard[] = ['p2-29', 'p2-56', 'p2-4', 'p2-18', 'p2-99', 'p2-100'].map((id, i) => discardCard(i, id));

const removeAction = (cardInstanceId: string): EvaluatedAction => ({
  action: { type: 'remove-revealed-card', player: 'p1' as PlayerId, cardInstanceId: cardInstanceId as CardInstanceId },
  viable: true,
} as EvaluatedAction);

const passAction: EvaluatedAction = { action: { type: 'pass', player: 'p1' as PlayerId }, viable: true } as EvaluatedAction;

const legalActions: EvaluatedAction[] = [
  removeAction('p2-29'), removeAction('p2-56'), removeAction('p2-4'), removeAction('p2-18'), passAction,
];

const view = {
  self: { id: 'p1', playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  opponent: { id: OPPONENT_ID, playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: oppDiscard },
  legalActions,
} as unknown as PlayerView;

describe('reveal-remove-from-discard sub-flow (Aware of their Ways, dm-46)', () => {
  // Both assertions share one `renderDeckPiles` call: the pile-browser click
  // listener is wired to a DOM element only the first time it runs (a
  // module-level "already installed" guard), so a second call in a later
  // test — against a fresh stub element from a new `beforeEach` — would
  // silently wire nothing and the simulated click below would be a no-op.
  test('highlights the pile and makes the four revealed cards clickable to remove them', () => {
    renderDeckPiles(view, pool);
    const sent: unknown[] = [];
    prepareRevealRemoveFromDiscard(view, pool, action => { sent.push(action); });

    // The highlight is what makes the offer visible on screen at all —
    // this is precisely what the reporter said was missing.
    expect(byId['opponent-discard-pile'].classList.contains('pile--fetch-active')).toBe(true);
    expect(byId['opponent-deck-box'].classList.contains('deck-box--compact')).toBe(false);

    // Open the pile browser the same way a player click on the highlighted pile would.
    byId['opponent-discard-pile'].click();

    const gridImgs = byId['pile-browser-grid'].children;
    expect(gridImgs.length).toBe(oppDiscard.length);

    const selectable = gridImgs.filter(img => img.classList.contains('site-selectable'));
    expect(selectable.map(img => img.dataset.instanceId)).toEqual(
      expect.arrayContaining(['browser:p2-29', 'browser:p2-56', 'browser:p2-4', 'browser:p2-18']),
    );

    const chosen = selectable.find(img => img.dataset.instanceId === 'browser:p2-56')!;
    chosen.click();

    expect(sent).toEqual([
      { type: 'remove-revealed-card', player: 'p1', cardInstanceId: 'p2-56' },
    ]);
  });

  test('does nothing when no remove-revealed-card action is offered', () => {
    const viewWithoutOffer = { ...view, legalActions: [passAction] } as unknown as PlayerView;
    renderDeckPiles(viewWithoutOffer, pool);
    prepareRevealRemoveFromDiscard(viewWithoutOffer, pool, () => { /* no-op */ });

    expect(byId['opponent-discard-pile'].classList.contains('pile--fetch-active')).toBe(false);
  });
});
