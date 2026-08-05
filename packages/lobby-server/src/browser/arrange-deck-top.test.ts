/**
 * @module arrange-deck-top.test
 *
 * Regression test for bug report f3abf16a0ca9baf4 (game msbyme1n-63ygzx, seq
 * 671): playing *Revealed to all Watchers* (dm-85) correctly enqueues an
 * `arrange-deck-top` pending resolution with one `arrange-deck-top-card` legal
 * action per set-aside card — confirmed by the engine's `arrangeDeckTopActions`
 * — but the browser client never wired those actions to anything clickable.
 * Same class of bug as `reveal-remove-from-discard.test.ts` (Aware of their
 * Ways): every pile-picking sub-flow needs a `prepare*` function that
 * highlights a pile and lets `populateBrowserGrid`'s `siteSelectionMatcher`
 * make individual cards clickable; this one had none, so the play deck pile
 * never lit up and the player had no way to choose the deck-top order —
 * exactly what the reporter saw ("there I had no choice at all").
 *
 * Fixed by adding `prepareArrangeDeckTop`, wired into `game-connection.ts`'s
 * per-view selection dispatch alongside the existing `fetch-from-pile` and
 * `remove-revealed-card` branches.
 *
 * Uses the hand-rolled DOM stub pattern of `reveal-remove-from-discard.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, ViewCard, CardInstanceId, PlayerId } from '@meccg/shared';
import { renderDeckPiles, prepareArrangeDeckTop } from './render-piles.js';

const pool = loadCardPool();

// Real definition IDs (any suffice — only their presence in the pool matters).
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
    'self-deck-pile': new StubEl('div'),
    'self-deck-box': new StubEl('div'),
    'pile-browser-modal': new StubEl('div'),
    'pile-browser-title': new StubEl('div'),
    'pile-browser-grid': new StubEl('div'),
  };
  byId['self-deck-box'].classList.add('deck-box--compact');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? null,
    addEventListener: () => { /* no-op: document-level Escape handler */ },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const SELF_ID = 'p1' as PlayerId;

const deckCard = (idx: number, instanceId: string): ViewCard =>
  ({ instanceId: instanceId as CardInstanceId, definitionId: DEF_IDS[idx % DEF_IDS.length] } as unknown as ViewCard);

const selfPlayDeck: ViewCard[] = ['p1-181', 'p1-58', 'p1-175', 'p1-188', 'p1-187', 'p1-170', 'p1-198'].map((id, i) => deckCard(i, id));

const arrangeAction = (cardInstanceId: string): EvaluatedAction => ({
  action: { type: 'arrange-deck-top-card', player: SELF_ID, cardInstanceId: cardInstanceId as CardInstanceId },
  viable: true,
} as EvaluatedAction);

const legalActions: EvaluatedAction[] = selfPlayDeck.map(c => arrangeAction(c.instanceId as string));

const view = {
  self: { id: SELF_ID, playDeck: selfPlayDeck, siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  opponent: { id: 'p2', playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  legalActions,
} as unknown as PlayerView;

describe('arrange-deck-top sub-flow (Revealed to all Watchers, dm-85)', () => {
  // Both assertions share one `renderDeckPiles` call: the pile-browser click
  // listener is wired to a DOM element only the first time it runs (a
  // module-level "already installed" guard), so a second call in a later
  // test — against a fresh stub element from a new `beforeEach` — would
  // silently wire nothing and the simulated click below would be a no-op.
  test('highlights the play deck pile and makes the set-aside cards clickable to order them', () => {
    renderDeckPiles(view, pool);
    const sent: unknown[] = [];
    prepareArrangeDeckTop(view, pool, action => { sent.push(action); });

    // The highlight is what makes the offer visible on screen at all —
    // this is precisely what the reporter said was missing.
    expect(byId['self-deck-pile'].classList.contains('pile--fetch-active')).toBe(true);
    expect(byId['self-deck-box'].classList.contains('deck-box--compact')).toBe(false);

    // Open the pile browser the same way a player click on the highlighted pile would.
    byId['self-deck-pile'].click();

    const gridImgs = byId['pile-browser-grid'].children;
    expect(gridImgs.length).toBe(selfPlayDeck.length);

    const selectable = gridImgs.filter(img => img.classList.contains('site-selectable'));
    expect(selectable.map(img => img.dataset.instanceId)).toEqual(
      expect.arrayContaining(selfPlayDeck.map(c => `browser:${c.instanceId as string}`)),
    );

    const chosen = selectable.find(img => img.dataset.instanceId === 'browser:p1-58')!;
    chosen.click();

    expect(sent).toEqual([
      { type: 'arrange-deck-top-card', player: SELF_ID, cardInstanceId: 'p1-58' },
    ]);
  });

  test('does nothing when no arrange-deck-top-card action is offered', () => {
    const viewWithoutOffer = { ...view, legalActions: [] } as unknown as PlayerView;
    renderDeckPiles(viewWithoutOffer, pool);
    prepareArrangeDeckTop(viewWithoutOffer, pool, () => { /* no-op */ });

    expect(byId['self-deck-pile'].classList.contains('pile--fetch-active')).toBe(false);
  });

  // Regression test for bug report dae1df37414d35d9 (game msd9dixh-m9voxl,
  // seq 1060): picking a card closed the pile browser every time, forcing the
  // player to re-click the deck pile before every single pick in this
  // mandatory, no-pass, multi-step ordering flow -- "totally tedious", per
  // the reporter.
  test('keeps the browser open across successive picks instead of closing it every click', () => {
    renderDeckPiles(view, pool);
    const sent: unknown[] = [];
    prepareArrangeDeckTop(view, pool, action => { sent.push(action); });

    // Player opens the browser once, then picks the first card.
    byId['self-deck-pile'].click();
    const firstPick = byId['pile-browser-grid'].children.find(
      img => img.dataset.instanceId === 'browser:p1-58',
    )!;
    firstPick.click();

    expect(sent).toEqual([
      { type: 'arrange-deck-top-card', player: SELF_ID, cardInstanceId: 'p1-58' },
    ]);
    // The modal must stay open, not close after the pick.
    expect(byId['pile-browser-modal'].classList.contains('hidden')).toBe(false);

    // The next server state arrives with the picked card no longer offered.
    const remainingLegalActions = legalActions.filter(
      ea => (ea.action as { cardInstanceId: string }).cardInstanceId !== 'p1-58',
    );
    const nextView = { ...view, legalActions: remainingLegalActions } as unknown as PlayerView;
    prepareArrangeDeckTop(nextView, pool, action => { sent.push(action); });

    // The browser auto-refreshes/reopens without another pile click.
    expect(byId['pile-browser-modal'].classList.contains('hidden')).toBe(false);
    const selectable = byId['pile-browser-grid'].children.filter(img => img.classList.contains('site-selectable'));
    expect(selectable.map(img => img.dataset.instanceId)).not.toContain('browser:p1-58');
    expect(selectable.length).toBe(selfPlayDeck.length - 1);
  });
});
