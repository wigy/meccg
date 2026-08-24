/**
 * @module app-state.test
 *
 * Regression test for `sortDeckEntries`: the "favourites first" axis must treat
 * `favourite: false` and `favourite: undefined` as equal — both are
 * "not a favourite", exactly how the game (`game-session.ts`) and sim
 * (`sim/decks.ts`) read the flag as `favourite === true`. Comparing the raw
 * values with `!==` made the comparator inconsistent (antisymmetry-violating)
 * whenever a `favourite: false` entry — which enters via imported `.meccg-json`
 * decks, whose JSON is a raw copy of the deck data — met a `favourite: undefined`
 * one: it ordered them relative to each other and even disagreed with itself on
 * which came first, so the rendered deck-list order depended on input order.
 */

import './test-dom-bootstrap.js'; // must precede the app-state import (load-time window access)
import { describe, test, expect } from 'vitest';
import { sortDeckEntries, type DeckListEntry } from './app-state.js';

describe('sortDeckEntries favourite ordering', () => {
  test('treats favourite:false and favourite:undefined as equally non-favourite', () => {
    const entries: DeckListEntry[] = [
      { name: 'Aragorn II', card: null, qty: 1, favourite: false },
      { name: 'Beorn', card: null, qty: 1 }, // favourite undefined
    ];
    // Neither is a favourite, so the sort falls through to the alphabetical
    // name tie-break — it must not reorder them by the favourite flag.
    expect(sortDeckEntries(entries).map(e => e.name)).toEqual(['Aragorn II', 'Beorn']);
  });

  test('is a consistent comparator when false and undefined are mixed', () => {
    // A valid comparator yields the same order regardless of input order; the
    // pre-fix `!==` comparator returned +1 for both directions, so the two
    // sorts disagreed.
    const forward: DeckListEntry[] = [
      { name: 'Aragorn II', card: null, qty: 1, favourite: false },
      { name: 'Beorn', card: null, qty: 1 },
    ];
    const backward: DeckListEntry[] = [
      { name: 'Beorn', card: null, qty: 1 },
      { name: 'Aragorn II', card: null, qty: 1, favourite: false },
    ];
    expect(sortDeckEntries(forward).map(e => e.name))
      .toEqual(sortDeckEntries(backward).map(e => e.name));
  });

  test('a favourite sorts before a non-favourite regardless of name', () => {
    const entries: DeckListEntry[] = [
      { name: 'Zzz', card: null, qty: 1, favourite: true },
      { name: 'Aaa', card: null, qty: 1, favourite: false },
    ];
    expect(sortDeckEntries(entries).map(e => e.name)).toEqual(['Zzz', 'Aaa']);
  });
});
