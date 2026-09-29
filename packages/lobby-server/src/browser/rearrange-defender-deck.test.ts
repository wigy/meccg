/**
 * @module rearrange-defender-deck.test
 *
 * Regression test for bug report bd6dc3429c9bba80 (game mum9fb5u-stfcyn, seq
 * 934): after a Goblin-faces (wh-13) attack with a successful strike the
 * engine correctly enqueued a `rearrange-defender-deck` resolution and offered
 * `rearrange-defender-deck-card` actions for the attacker, and the looked-at
 * card was already unmasked in the attacker's view of the opponent's play
 * deck — but the browser client had no sub-flow for it. The opponent's play
 * deck never lit up, clicking it showed the whole face-down deck, and there
 * was no way to see the looked-at card and choose top or bottom ("Cant look in
 * the opponents deck").
 *
 * Fixed by adding `prepareRearrangeDefenderDeck`, which highlights the
 * opponent's play deck, filters its browser down to the looked-at cards, and
 * offers a top/bottom choice per card.
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, ViewCard, CardInstanceId, PlayerId } from '@meccg/shared';
import type { TooltipMenuItem } from './tooltip-menu.js';
import { renderDeckPiles, prepareRearrangeDefenderDeck, clearSelectionState } from './render-piles.js';

const { menus } = vi.hoisted(() => ({ menus: [] as TooltipMenuItem[][] }));
vi.mock('./tooltip-menu.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tooltip-menu.js')>()),
  showTooltipMenu: (_anchor: unknown, items: readonly TooltipMenuItem[]) => { menus.push([...items]); },
}));

const pool = loadCardPool();

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
  menus.length = 0;
  byId = {
    'opponent-deck-pile': new StubEl('div'),
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
  clearSelectionState();
  delete (globalThis as unknown as { document?: unknown }).document;
});

const SELF_ID = 'p1' as PlayerId;

// As in the reported game: the looked-at card (p2-85, The White Tree tw-348)
// is unmasked, the rest of the defender's deck stays face down.
const oppPlayDeck = [
  { instanceId: 'p2-85', definitionId: 'tw-348' },
  { instanceId: 'p2-deck-1', definitionId: 'unknown-card' },
  { instanceId: 'p2-deck-2', definitionId: 'unknown-card' },
] as unknown as ViewCard[];

const rearrangeAction = (destination: 'top' | 'bottom'): EvaluatedAction => ({
  action: { type: 'rearrange-defender-deck-card', player: SELF_ID, cardInstanceId: 'p2-85' as CardInstanceId, destination },
  viable: true,
} as EvaluatedAction);

const view = {
  self: { id: SELF_ID, playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  opponent: { id: 'p2', playDeck: oppPlayDeck, siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  legalActions: [rearrangeAction('top'), rearrangeAction('bottom')],
} as unknown as PlayerView;

describe('rearrange-defender-deck sub-flow (Goblin-faces, wh-13)', () => {
  test('shows the looked-at opponent deck card and lets the attacker place it on top or bottom', () => {
    renderDeckPiles(view, pool);
    const sent: unknown[] = [];
    prepareRearrangeDefenderDeck(view, pool, action => { sent.push(action); });

    expect(byId['opponent-deck-pile'].classList.contains('pile--fetch-active')).toBe(true);
    expect(byId['opponent-deck-box'].classList.contains('deck-box--compact')).toBe(false);

    byId['opponent-deck-pile'].click();

    // Only the looked-at card is shown, face up and selectable.
    const gridImgs = byId['pile-browser-grid'].children;
    expect(gridImgs.map(img => img.dataset.instanceId)).toEqual(['browser:p2-85']);
    expect(gridImgs[0].dataset.cardId).toBe('tw-348');
    expect(gridImgs[0].classList.contains('site-selectable')).toBe(true);

    gridImgs[0].click();
    expect(menus).toHaveLength(1);
    expect(menus[0].map(item => item.label)).toEqual(['Place on top of the deck', 'Place on the bottom of the deck']);

    menus[0][1].onClick!();
    expect(sent).toEqual([
      { type: 'rearrange-defender-deck-card', player: SELF_ID, cardInstanceId: 'p2-85', destination: 'bottom' },
    ]);
    expect(byId['pile-browser-modal'].classList.contains('hidden')).toBe(false);
  });
});
