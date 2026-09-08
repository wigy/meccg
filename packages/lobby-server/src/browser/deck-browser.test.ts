/**
 * @module deck-browser.test
 *
 * Feature request: "When copying a standard deck, I usually modify it to
 * my needs. Renaming them helps me keeping better track of my vs standard
 * decks." Catalog copies used to silently keep the catalog deck's name
 * (`addDeckToCollection` only rewrote `id`), and renaming an owned deck
 * required opening the full deck editor. This adds a rename-on-copy control
 * to the catalog "Copy" button and a rename button to each "My Decks" row,
 * both using the inline edit-input pattern already used by the deck
 * editor's title (`deck-editor.ts`'s `renderTitle`).
 *
 * Uses the hand-rolled DOM stub + vi.mock pattern of
 * `inbox-sent-tab-delete.test.ts` (the package runs vitest in the default
 * node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the deck-browser import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { apiGet, apiSend } = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock('./api.js', () => ({ apiGet, apiSend }));

// Vitest hoists the vi.mock call above the static imports below, so
// deck-browser.ts picks up the mocked api.js.
import { loadDecks } from './deck-browser.js';
import { appState, type FullDeck } from './app-state.js';

class StubEl {
  tagName: string;
  id = '';
  className = '';
  textContent = '';
  value = '';
  title = '';
  disabled = false;
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {};
  children: StubEl[] = [];
  private listeners: { type: string; cb: (event: unknown) => void }[] = [];
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    toggle: () => { /* no-op */ },
    contains: (c: string) => this.classList.classes.has(c),
  };

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (event: unknown) => void): void { this.listeners.push({ type, cb }); }
  dispatch(type: string, event: unknown = {}): void {
    for (const l of this.listeners) { if (l.type === type) l.cb(event); }
  }
  click(): void { this.dispatch('click'); }
  setAttribute(): void { /* no-op */ }
  focus(): void { /* no-op */ }
  select(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let myContainer: StubEl;
let catContainer: StubEl;
let docListeners: Record<string, Array<(e: unknown) => void>>;

function installFreshDom(): void {
  myContainer = new StubEl('div');
  catContainer = new StubEl('div');
  const byId: Record<string, StubEl> = { 'my-decks': myContainer, 'deck-catalog': catContainer };
  docListeners = {};
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? null,
    addEventListener: (type: string, cb: (e: unknown) => void) => { (docListeners[type] ??= []).push(cb); },
    removeEventListener: (type: string, cb: (e: unknown) => void) => {
      docListeners[type] = (docListeners[type] ?? []).filter(l => l !== cb);
    },
  };
}

const catalogDeck: FullDeck = {
  id: 'standard-gondor',
  name: 'Standard Gondor',
  alignment: 'hero',
  pool: [],
  deck: { characters: [], hazards: [], resources: [] },
  sites: [],
  sideboard: [],
};

const myDeck: FullDeck = {
  id: 'alice-my-deck',
  name: 'My Deck',
  alignment: 'hero',
  pool: [],
  deck: { characters: [], hazards: [], resources: [] },
  sites: [],
  sideboard: [],
};

const renameBtnOf = (): StubEl | undefined =>
  myContainer.all().find(el => el.className === 'deck-editor-title-edit-btn');

const copyBtnOf = (): StubEl | undefined =>
  catContainer.all().find(el => el.tagName === 'button' && el.textContent === 'Copy');

const inputOf = (container: StubEl): StubEl | undefined =>
  container.all().find(el => el.className === 'deck-editor-title-input');

const actionBtn = (container: StubEl, label: string): StubEl | undefined =>
  container.all().find(el => el.tagName === 'button' && el.textContent === label);

beforeEach(() => {
  installFreshDom();
  apiGet.mockReset();
  apiSend.mockReset();
  appState.lobbyPlayerName = 'alice';
  appState.ownedDeckIds = new Set([myDeck.id]);
});

describe('renaming a deck when copying it from the catalog', () => {
  test('POSTs the copy under the custom name, not the catalog deck\'s name', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/decks') return Promise.resolve({ ok: true, data: [catalogDeck] });
      return Promise.resolve({ ok: true, data: { decks: [], currentDeck: null, currentFullDeck: null } });
    });
    apiSend.mockResolvedValue({ ok: true, data: {} });

    await loadDecks();
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/decks') return Promise.resolve({ ok: true, data: [catalogDeck] });
      return Promise.resolve({ ok: true, data: { decks: [myDeck], currentDeck: null, currentFullDeck: null } });
    });

    copyBtnOf()!.click();
    const input = inputOf(catContainer)!;
    expect(input).toBeDefined();
    input.value = 'My Custom Copy';
    actionBtn(catContainer, 'Copy')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiSend).toHaveBeenCalledWith('/api/my-decks', 'POST', expect.objectContaining({
      id: 'alice-standard-gondor',
      name: 'My Custom Copy',
    }));
  });
});

describe('renaming an owned deck from the "My Decks" list', () => {
  test('POSTs the deck with its updated name and unchanged id', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/decks') return Promise.resolve({ ok: true, data: [] });
      return Promise.resolve({ ok: true, data: { decks: [myDeck], currentDeck: null, currentFullDeck: null } });
    });
    apiSend.mockResolvedValue({ ok: true, data: {} });

    await loadDecks();

    renameBtnOf()!.click();
    const input = inputOf(myContainer)!;
    expect(input).toBeDefined();
    input.value = 'Renamed Deck';
    actionBtn(myContainer, 'Save')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiSend).toHaveBeenCalledWith('/api/my-decks', 'POST', expect.objectContaining({
      id: myDeck.id,
      name: 'Renamed Deck',
    }));
  });

  test('does nothing when the rename input is left unchanged', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/decks') return Promise.resolve({ ok: true, data: [] });
      return Promise.resolve({ ok: true, data: { decks: [myDeck], currentDeck: null, currentFullDeck: null } });
    });

    await loadDecks();

    renameBtnOf()!.click();
    expect(inputOf(myContainer)).toBeDefined();
    actionBtn(myContainer, 'Save')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiSend).not.toHaveBeenCalled();
  });
});
