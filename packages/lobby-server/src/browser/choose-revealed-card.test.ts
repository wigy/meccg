/**
 * @module choose-revealed-card.test
 *
 * Regression test for bug report a351d6df04d1bd7c (game mua0e0xx-9en7b6, seq
 * 919): playing *Eyes of Mandos* (dm-126) correctly enqueues a
 * `reveal-choose-to-hand` pending resolution with one `choose-revealed-card`
 * legal action per revealed top-of-deck card — confirmed by the engine's
 * `revealChooseToHandActions` — but the browser client never wired those
 * actions to anything clickable. Same class of bug as
 * `reveal-remove-from-discard.test.ts` (Aware of their Ways) and
 * `arrange-deck-top.test.ts` (Revealed to all Watchers): every pile-picking
 * sub-flow needs a `prepare*` function that highlights a pile and lets
 * `populateBrowserGrid`'s `siteSelectionMatcher` make individual cards
 * clickable; this one had none, so the play deck pile never lit up and the
 * player had no way to choose a card — exactly what the reporter saw ("did
 * not allow me to select a card to add to my hand").
 *
 * Fixed by adding `prepareChooseRevealedCard`, wired into
 * `game-connection.ts`'s per-view selection dispatch alongside the existing
 * `fetch-from-pile`, `remove-revealed-card`, and `arrange-deck-top-card`
 * branches.
 *
 * Uses the hand-rolled DOM stub pattern of `arrange-deck-top.test.ts` (the
 * package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, ViewCard, CardInstanceId, PlayerId } from '@meccg/shared';
import { renderDeckPiles, prepareChooseRevealedCard } from './render-piles.js';

const pool = loadCardPool();

// Real definition IDs (any suffice — only their presence in the pool matters).
const DEF_IDS = ['le-268', 'le-288', 'wh-74', 'wh-106', 'wh-75', 'td-67', 'dm-126', 'tw-175'];

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

// Top 8 revealed cards plus 2 still-hidden cards beneath them, mirroring the
// reported game's 10-card play deck.
const selfPlayDeck: ViewCard[] = ['p1-70', 'p1-56', 'p1-21', 'p1-37', 'p1-14', 'p1-29', 'p1-2', 'p1-55', 'p1-9', 'p1-10']
  .map((id, i) => deckCard(i, id));

const chooseAction = (cardInstanceId: string): EvaluatedAction => ({
  action: { type: 'choose-revealed-card', player: SELF_ID, cardInstanceId: cardInstanceId as CardInstanceId },
  viable: true,
} as EvaluatedAction);

const revealedIds = ['p1-70', 'p1-56', 'p1-21', 'p1-37', 'p1-14', 'p1-29', 'p1-2', 'p1-55'];
const legalActions: EvaluatedAction[] = revealedIds.map(chooseAction);

const view = {
  self: { id: SELF_ID, playDeck: selfPlayDeck, siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  opponent: { id: 'p2', playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  legalActions,
} as unknown as PlayerView;

describe('reveal-choose-to-hand sub-flow (Eyes of Mandos, dm-126)', () => {
  // Both assertions share one `renderDeckPiles` call: the pile-browser click
  // listener is wired to a DOM element only the first time it runs (a
  // module-level "already installed" guard), so a second call in a later
  // test — against a fresh stub element from a new `beforeEach` — would
  // silently wire nothing and the simulated click below would be a no-op.
  test('highlights the play deck pile and makes the revealed cards clickable to choose one', () => {
    renderDeckPiles(view, pool);
    const sent: unknown[] = [];
    prepareChooseRevealedCard(view, pool, action => { sent.push(action); });

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
      expect.arrayContaining(revealedIds.map(id => `browser:${id}`)),
    );
    // The two still-hidden cards beneath the reveal are not selectable.
    expect(selectable.map(img => img.dataset.instanceId)).not.toEqual(
      expect.arrayContaining(['browser:p1-9', 'browser:p1-10']),
    );

    const chosen = selectable.find(img => img.dataset.instanceId === 'browser:p1-37')!;
    chosen.click();

    expect(sent).toEqual([
      { type: 'choose-revealed-card', player: SELF_ID, cardInstanceId: 'p1-37' },
    ]);
  });

  test('does nothing when no choose-revealed-card action is offered', () => {
    const viewWithoutOffer = { ...view, legalActions: [] } as unknown as PlayerView;
    renderDeckPiles(viewWithoutOffer, pool);
    prepareChooseRevealedCard(viewWithoutOffer, pool, () => { /* no-op */ });

    expect(byId['self-deck-pile'].classList.contains('pile--fetch-active')).toBe(false);
  });
});
