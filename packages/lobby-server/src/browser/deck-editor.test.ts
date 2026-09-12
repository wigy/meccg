/**
 * @module deck-editor.test
 *
 * Feature request: "When adding a card, don't close the card list window
 * automatically. It's hard to add a bunch of cards the way it's currently
 * working." The deck editor's "Add a card" browser used to call `close()`
 * from inside the per-card click handler, so every single add forced the
 * player to re-open the browser and re-type their search. Same class of bug
 * already fixed once in the in-game pile browser (bug dae1df37414d35d9, see
 * `arrange-deck-top.test.ts`) — the fix here mirrors that: the modal stays
 * open across repeated clicks on the same or different cards, and only an
 * explicit close (X, backdrop, Escape, or "Add All") removes it.
 *
 * Uses the hand-rolled DOM stub pattern of `arrange-deck-top.test.ts` (the
 * package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the deck-editor import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { openCardBrowser, renderCardList } from './deck-editor.js';

// Real pool card id (any suffices — only its presence in the pool matters).
const CARD_ID = 'le-268';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  textContent = '';
  value = '';
  title = '';
  removed = false;
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {};
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !this.classList.classes.has(c);
      if (on) this.classList.classes.add(c); else this.classList.classes.delete(c);
    },
    contains: (c: string) => this.classList.classes.has(c),
  };

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  setAttribute(): void { /* no-op */ }
  remove(): void { this.removed = true; }
  focus(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let body: StubEl;
let sectionListEl: StubEl;
let sectionTitleEl: StubEl;
let charSectionListEl: StubEl;
let charSectionTitleEl: StubEl;
let docListeners: Record<string, Array<(e: unknown) => void>>;

beforeEach(() => {
  body = new StubEl('body');
  sectionListEl = new StubEl('div');
  sectionTitleEl = new StubEl('div');
  charSectionListEl = new StubEl('div');
  charSectionTitleEl = new StubEl('div');
  docListeners = {};
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => {
      if (id === 'deck-editor-pool') return sectionListEl;
      if (id === 'deck-editor-pool-title') return sectionTitleEl;
      if (id === 'deck-editor-characters') return charSectionListEl;
      if (id === 'deck-editor-characters-title') return charSectionTitleEl;
      return null;
    },
    body,
    addEventListener: (type: string, cb: (e: unknown) => void) => { (docListeners[type] ??= []).push(cb); },
    removeEventListener: (type: string, cb: (e: unknown) => void) => {
      docListeners[type] = (docListeners[type] ?? []).filter(l => l !== cb);
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

type StubEntry = { name: string; card: string | null; qty: number; favourite?: boolean };
const section = () => ({ id: 'pool', label: 'Pool', entries: [] as StubEntry[] });
const charactersSection = () => ({ id: 'characters', label: 'Characters', entries: [] as StubEntry[] });
const toggles = () => [{ icon: '★', title: 'All', match: () => true, active: true, group: 'type' as const }];
const flush = () => new Promise(r => setTimeout(r, 0));

// A minion-character (le-4, Calendal) and a non-character resource (le-268),
// both real pool cards — only their type matters for the favourite gating.
const CHARACTER_CARD_ID = 'le-4';

describe('deck editor card browser', () => {
  test('stays open and increments quantity across repeated clicks on the same card', () => {
    const deckSection = section();
    openCardBrowser(deckSection, 'deck-1', 'Add a card to Pool', def => def.id === CARD_ID, toggles());

    const modal = body.all().find(el => el.className === 'app-dialog')!;
    expect(modal).toBeDefined();

    const cardItem = modal.all().find(el => el.className === 'card-browser-item')!;
    expect(cardItem).toBeDefined();

    cardItem.dispatch('click');
    cardItem.dispatch('click');

    expect(deckSection.entries.find(e => e.card === CARD_ID)?.qty).toBe(2);
    // The modal must never have been removed by these clicks.
    expect(modal.removed).toBe(false);
  });

  test('"Add All" still closes the browser', () => {
    const deckSection = section();
    openCardBrowser(deckSection, 'deck-1', 'Add a card to Pool', def => def.id === CARD_ID, toggles());

    const modal = body.all().find(el => el.className === 'app-dialog')!;
    const addAllBtn = modal.all().find(el => el.className === 'card-browser-add-all')!;
    expect(addAllBtn).toBeDefined();

    addAllBtn.dispatch('click');

    expect(deckSection.entries.find(e => e.card === CARD_ID)?.qty).toBe(1);
    expect(modal.removed).toBe(true);
  });
});

const favouriteBtnOf = (el: StubEl): StubEl | undefined =>
  el.all().find(e => e.className.startsWith('deck-editor-favourite-btn'));

describe('deck editor pool favourite toggle', () => {
  test('renders an unfilled star toggle for a character entry in the Pool section', () => {
    const deckSection = section();
    deckSection.entries.push({ name: 'Calendal', card: CHARACTER_CARD_ID, qty: 1 });
    renderCardList(sectionListEl as unknown as HTMLElement, deckSection, 'deck-1');

    const favBtn = favouriteBtnOf(sectionListEl);
    expect(favBtn).toBeDefined();
    expect(favBtn!.textContent).toBe('☆');
  });

  test('clicking the star toggle flips favourite optimistically, then reverts once the (no-op) save resolves', async () => {
    const deckSection = section();
    deckSection.entries.push({ name: 'Calendal', card: CHARACTER_CARD_ID, qty: 1 });
    renderCardList(sectionListEl as unknown as HTMLElement, deckSection, 'deck-1');
    const entry = deckSection.entries[0];

    favouriteBtnOf(sectionListEl)!.dispatch('click', { stopPropagation: () => { /* no-op */ } });

    expect(entry.favourite).toBe(true);
    let favBtn = favouriteBtnOf(sectionListEl)!;
    expect(favBtn.className).toContain('deck-editor-favourite-btn--active');
    expect(favBtn.textContent).toBe('★');

    // No deck is open for editing in this test, so saveEditingDeck() resolves
    // false without a network call — the toggle reverts once that settles.
    await flush();

    expect(entry.favourite).toBeFalsy();
    favBtn = favouriteBtnOf(sectionListEl)!;
    expect(favBtn.className).not.toContain('deck-editor-favourite-btn--active');
    expect(favBtn.textContent).toBe('☆');
  });

  test('does not render a star toggle for a non-character Pool entry', () => {
    const deckSection = section();
    deckSection.entries.push({ name: 'A Resource', card: CARD_ID, qty: 1 });
    renderCardList(sectionListEl as unknown as HTMLElement, deckSection, 'deck-1');

    expect(favouriteBtnOf(sectionListEl)).toBeUndefined();
  });

  test('does not render a star toggle for a character entry outside the Pool section', () => {
    const deckSection = charactersSection();
    deckSection.entries.push({ name: 'Calendal', card: CHARACTER_CARD_ID, qty: 1 });
    renderCardList(charSectionListEl as unknown as HTMLElement, deckSection, 'deck-1');

    expect(favouriteBtnOf(charSectionListEl)).toBeUndefined();
  });
});
