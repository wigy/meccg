/**
 * @module discard-ally-play-click.test
 *
 * Regression test for bug report 790d908c788aced0 (game mt0f23bd-p91gyj, seq
 * 564): with Glove of Radagast (wh-111) attached to Fallen-Radagast, the
 * engine correctly offers `play-hero-resource` actions with `fromDiscard:
 * true` for eligible non-unique 1-mind allies sitting in the discard pile
 * (see `wh-111.test.ts`), but the browser client never wired those cards to
 * anything clickable. `populateBrowserGrid` in `render-piles.ts` only ever
 * attached click handlers while an interactive site-selection sub-flow
 * (`siteSelectionActions.length > 0`) was active; browsing a pile outside
 * that mode — which is how the discard pile is normally opened — rendered
 * every card as a static image. The player could see the allies but nothing
 * happened when clicking them, exactly as reported.
 *
 * Fixed by making `openPileBrowser`/`wirePile` track whether the self
 * discard pile is being browsed, and giving `populateBrowserGrid` a new
 * branch that, for that pile, wires any card with a viable `fromDiscard`
 * `play-hero-resource` action into the same two-step ally-play targeting
 * flow (`setSelectedAllyForPlay`) already used for hand-sourced allies —
 * `company-block.ts`'s existing character-click matching is agnostic to the
 * card's source, so no changes were needed there.
 *
 * Uses the hand-rolled DOM stub pattern of `reveal-remove-from-discard.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, ViewCard, CardInstanceId, PlayerId } from '@meccg/shared';
import { renderDeckPiles } from './render-piles.js';
import { getSelectedAllyForPlay, clearAllyPlaySelection } from './render-selection-state.js';

const pool = loadCardPool();

// Noble Steed (wh-33): non-unique, 1 mind — a real eligible grant target.
const NOBLE_STEED = 'wh-33';
// Padded out with a non-eligible discard card so the fix is proven to be
// selective, not "every discard card became clickable."
const OTHER_CARD = 'td-19';

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
    'self-discard-pile': new StubEl('div'),
    'self-deck-box': new StubEl('div'),
    'pile-browser-modal': new StubEl('div'),
    'pile-browser-title': new StubEl('div'),
    'pile-browser-grid': new StubEl('div'),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? null,
    addEventListener: () => { /* no-op: document-level Escape handler */ },
  };
  clearAllyPlaySelection();
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const PLAYER_1 = 'p1' as PlayerId;

const discardCard = (defId: string, instanceId: string): ViewCard =>
  ({ instanceId: instanceId as CardInstanceId, definitionId: defId } as unknown as ViewCard);

const NOBLE_STEED_INSTANCE = 'p1-80';
const selfDiscard: ViewCard[] = [
  discardCard(OTHER_CARD, 'p1-42'),
  discardCard(NOBLE_STEED, NOBLE_STEED_INSTANCE),
];

const playFromDiscardAction: EvaluatedAction = {
  action: {
    type: 'play-hero-resource', player: PLAYER_1,
    cardInstanceId: NOBLE_STEED_INSTANCE as CardInstanceId,
    attachToCharacterId: 'p1-0' as CardInstanceId,
    fromDiscard: true,
  },
  viable: true,
} as EvaluatedAction;

const passAction: EvaluatedAction = { action: { type: 'pass', player: PLAYER_1 }, viable: true } as EvaluatedAction;

const view = {
  self: { id: 'p1', playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: selfDiscard },
  opponent: { id: 'p2', playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  legalActions: [playFromDiscardAction, passAction],
} as unknown as PlayerView;

describe('discard-pile ally play click (Glove of Radagast wh-111)', () => {
  test('a discard card with a viable fromDiscard grant is clickable and selects it for play', () => {
    renderDeckPiles(view, pool);

    // Open the pile browser the same way a player click on the discard pile would.
    byId['self-discard-pile'].click();

    const gridImgs = byId['pile-browser-grid'].children;
    expect(gridImgs.length).toBe(selfDiscard.length);

    const selectable = gridImgs.filter(img => img.classList.contains('site-selectable'));
    expect(selectable.map(img => img.dataset.instanceId)).toEqual([`browser:${NOBLE_STEED_INSTANCE}`]);

    expect(getSelectedAllyForPlay()).toBeNull();
    selectable[0].click();

    expect(getSelectedAllyForPlay()).toBe(NOBLE_STEED_INSTANCE);
    // The browser closes so the player can click the target character on the board.
    expect(byId['pile-browser-modal'].classList.contains('hidden')).toBe(true);
  });

  test('no fromDiscard grant offered — no discard card is selectable', () => {
    const viewWithoutGrant = { ...view, legalActions: [passAction] } as unknown as PlayerView;
    renderDeckPiles(viewWithoutGrant, pool);

    byId['self-discard-pile'].click();

    const gridImgs = byId['pile-browser-grid'].children;
    const selectable = gridImgs.filter(img => img.classList.contains('site-selectable'));
    expect(selectable).toHaveLength(0);
  });
});
