/**
 * @module deck-browser-export.test
 *
 * Feature request: "Add Export option on decks" (implementation plan
 * f8e2c94d3f2de2f9). A `.meccg-json` download already existed inside the
 * deck editor, but the deck list ("My Decks" + Catalog) — which already has
 * an Import button — had no per-deck export action, forcing a player to
 * open a deck in the editor just to save a copy of it. This adds an Export
 * button to each row in both lists, reusing the editor's `downloadDeck`
 * helper so the download logic isn't duplicated.
 *
 * Uses the hand-rolled DOM stub pattern of `deck-editor.test.ts` (the
 * package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the deck-browser import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';

const { downloadDeck } = vi.hoisted(() => ({ downloadDeck: vi.fn() }));
vi.mock('./deck-editor.js', () => ({ downloadDeck }));

// Vitest hoists the vi.mock call above this static import, so deck-browser.ts
// picks up the mocked deck-editor.js.
import { renderMyDeckItem } from './deck-browser.js';
import type { FullDeck } from './app-state.js';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  textContent = '';
  title = '';
  disabled = false;
  style: Record<string, unknown> = {};
  listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  dispatch(type: string, event: unknown = {}): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

const DECK: FullDeck = {
  id: 'alice-fellowship', name: 'Fellowship', alignment: 'hero',
  pool: [], sites: [], sideboard: [],
  deck: { characters: [], hazards: [], resources: [] },
};

beforeEach(() => {
  downloadDeck.mockReset();
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
  };
});

describe('deck list Export button', () => {
  test('renders an Export button alongside Select and Delete', () => {
    const item = renderMyDeckItem(DECK, false) as unknown as StubEl;
    const buttons = item.all().filter(el => el.tagName === 'button');
    expect(buttons.map(b => b.textContent)).toEqual(['Select', 'Export', 'Delete']);
  });

  test('clicking Export downloads the exact FullDeck object shown in the row', () => {
    const item = renderMyDeckItem(DECK, true) as unknown as StubEl;
    const exportBtn = item.all().find(el => el.textContent === 'Export')!;

    exportBtn.dispatch('click');

    expect(downloadDeck).toHaveBeenCalledTimes(1);
    expect(downloadDeck).toHaveBeenCalledWith(DECK);
  });
});
