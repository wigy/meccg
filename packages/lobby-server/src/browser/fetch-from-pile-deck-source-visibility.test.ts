/**
 * @module fetch-from-pile-deck-source-visibility.test
 *
 * Regression test for bug report f402e405a82c40f0 (game mthqgvky-5610le, seq
 * 455): "I do not have the ability to search my deck after playing
 * far-sight." Far-sight (tw-238) queues a fetch-to-deck pending effect whose
 * source is the player's own play deck (not sideboard/discard). The engine
 * correctly offered `fetch-from-pile` legal actions for the matching cards,
 * but `prepareFetchFromPile` (render-piles.ts) only ever highlighted the
 * sideboard and discard pile cells — it never lit up `#self-deck-pile` for a
 * `source: 'deck'` fetch, so the player had no visual cue that a search was
 * available and passed instead.
 *
 * Uses the hand-rolled DOM stub pattern of
 * fetch-from-pile-all-companies-visibility.test.ts (the package runs vitest
 * in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { PlayerView, EvaluatedAction, CardDefinition } from '@meccg/shared';
import { prepareFetchFromPile, clearSelectionState } from './render-piles.js';

class StubClassList {
  classes = new Set<string>();
  add(...cs: string[]): void { for (const c of cs) this.classes.add(c); }
  remove(...cs: string[]): void { for (const c of cs) this.classes.delete(c); }
  contains(c: string): boolean { return this.classes.has(c); }
}

class StubEl {
  classList = new StubClassList();
}

let deckBox: StubEl;
let deckPile: StubEl;
let sideboardPile: StubEl;
let discardPile: StubEl;
let body: StubEl;

beforeEach(() => {
  deckBox = new StubEl();
  deckPile = new StubEl();
  sideboardPile = new StubEl();
  discardPile = new StubEl();
  body = new StubEl();

  const byId: Record<string, StubEl | null> = {
    'self-deck-box': deckBox,
    'self-deck-pile': deckPile,
    'self-sideboard-pile': sideboardPile,
    'self-discard-pile': discardPile,
  };
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => (id in byId ? byId[id] : null),
    body,
  };
});

afterEach(() => {
  clearSelectionState();
  delete (globalThis as unknown as { document?: unknown }).document;
});

const cardPool = {} as Readonly<Record<string, CardDefinition>>;

const fetchAction: EvaluatedAction = {
  action: { type: 'fetch-from-pile', player: 'p1', cardInstanceId: 'p1-3', source: 'deck', to: 'hand' },
  viable: true,
} as unknown as EvaluatedAction;

const viewWithFetchPending: PlayerView = {
  legalActions: [fetchAction, { action: { type: 'pass', player: 'p1' }, viable: true }],
} as unknown as PlayerView;

describe('prepareFetchFromPile — deck-source fetch (Far-sight)', () => {
  test('highlights the play deck pile so a deck search is discoverable', () => {
    prepareFetchFromPile(viewWithFetchPending, cardPool, () => { /* no-op */ });

    expect(deckPile.classList.contains('pile--fetch-active')).toBe(true);
    expect(sideboardPile.classList.contains('pile--fetch-active')).toBe(false);
    expect(discardPile.classList.contains('pile--fetch-active')).toBe(false);
  });
});
