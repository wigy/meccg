/**
 * @module fetch-from-pile-all-companies-visibility.test
 *
 * Regression test for bug report 4f1f18d769ccee95 (game msbu4uvh-d0jcus, seq
 * 328): "Playing Smoke Rings on an attack — the discard/sideboard never
 * lights up for retrieval." Smoke Rings (dm-159) queues a fetch-to-deck
 * pending effect whose `fetch-from-pile` legal actions are surfaced by
 * highlighting the sideboard/discard piles inside `#self-deck-box`
 * (`prepareFetchFromPile` in render-piles.ts).
 *
 * Root cause: `.all-companies-mode #self-deck-box { display: none }` (see
 * public/style.css) hides the whole deck box — piles included — whenever the
 * all-companies overview is showing. That overview is forced on automatically
 * on the opponent's turn (or left on by an earlier manual toggle), and
 * `prepareFetchFromPile` never accounted for it: it un-collapsed the deck box
 * and added the highlight classes, but if `all-companies-mode` was still set
 * on `document.body`, the whole box — highlight included — stayed invisible
 * and unclickable.
 *
 * Uses the hand-rolled DOM stub pattern of `render-chain.test.ts` (the
 * package runs vitest in the default node environment, with no jsdom).
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
let sideboardPile: StubEl;
let discardPile: StubEl;
let body: StubEl;

beforeEach(() => {
  deckBox = new StubEl();
  deckBox.classList.add('deck-box--compact');
  sideboardPile = new StubEl();
  discardPile = new StubEl();
  body = new StubEl();
  body.classList.add('all-companies-mode');

  const byId: Record<string, StubEl | null> = {
    'self-deck-box': deckBox,
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
  action: { type: 'fetch-from-pile', player: 'p1', cardInstanceId: 'p1-72', source: 'sideboard', to: 'deck' },
  viable: true,
} as unknown as EvaluatedAction;

const viewWithFetchPending: PlayerView = {
  legalActions: [fetchAction, { action: { type: 'pass', player: 'p1' }, viable: true }],
} as unknown as PlayerView;

describe('prepareFetchFromPile — visibility while the all-companies overview is showing', () => {
  test('clears all-companies-mode so the highlighted deck box is not display:none', () => {
    prepareFetchFromPile(viewWithFetchPending, cardPool, () => { /* no-op */ });

    expect(body.classList.contains('all-companies-mode')).toBe(false);
    expect(deckBox.classList.contains('deck-box--compact')).toBe(false);
    expect(sideboardPile.classList.contains('pile--fetch-active')).toBe(true);
  });
});
