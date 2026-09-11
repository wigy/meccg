/**
 * @module fetch-from-pile-targeting-hint.test
 *
 * Regression test for bug report b60263050d7c9e34 (game mtveit7u-vu6eno, seq
 * 774): "I dont get in a stae where I can draw a card. I play malady's so
 * tmagic spells should be there." Akhôrahil Unleashed (le-162) queues a
 * fetch-to-deck pending effect sourced from both the play deck and the
 * discard pile ("take a magic card from your play deck or discard pile to
 * your hand"). The engine correctly offered `fetch-from-pile` legal actions
 * for the matching cards (two malady copies in the deck, one in the discard
 * pile) and `prepareFetchFromPile` correctly lit up both piles — but nothing
 * on screen told the player an optional pick was available, unlike the
 * Hidden Haven pairing and arrange-deck-top sub-flows, which both show a
 * targeting-instruction hint. With no explanatory text, the player didn't
 * notice the pulsing pile highlight and passed instead.
 *
 * Uses the hand-rolled DOM stub pattern of
 * fetch-from-pile-all-companies-visibility.test.ts (the package runs vitest
 * in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { PlayerView, EvaluatedAction, CardDefinition } from '@meccg/shared';
import { prepareFetchFromPile, clearSelectionState, FETCH_FROM_PILE_HINT } from './render-piles.js';
import { getTargetingInstruction } from './render-selection-state.js';

class StubClassList {
  classes = new Set<string>();
  add(...cs: string[]): void { for (const c of cs) this.classes.add(c); }
  remove(...cs: string[]): void { for (const c of cs) this.classes.delete(c); }
  contains(c: string): boolean { return this.classes.has(c); }
}

class StubEl {
  classList = new StubClassList();
  textContent = '';
}

let deckPile: StubEl;
let discardPile: StubEl;
let sideboardPile: StubEl;
let hintEl: StubEl;
let body: StubEl;

beforeEach(() => {
  deckPile = new StubEl();
  discardPile = new StubEl();
  sideboardPile = new StubEl();
  hintEl = new StubEl();
  body = new StubEl();

  const byId: Record<string, StubEl | null> = {
    'self-deck-box': new StubEl(),
    'self-deck-pile': deckPile,
    'self-sideboard-pile': sideboardPile,
    'self-discard-pile': discardPile,
    'phase-target-hint': hintEl,
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

// Akhôrahil Unleashed (le-162): "take a magic card from your play deck or
// discard pile" — one fetch-from-pile action per matching card, spanning
// both sources at once.
const deckFetch: EvaluatedAction = {
  action: { type: 'fetch-from-pile', player: 'p1', cardInstanceId: 'p1-16', source: 'deck', to: 'hand' },
  viable: true,
} as unknown as EvaluatedAction;
const discardFetch: EvaluatedAction = {
  action: { type: 'fetch-from-pile', player: 'p1', cardInstanceId: 'p1-18', source: 'discard-pile', to: 'hand' },
  viable: true,
} as unknown as EvaluatedAction;

const viewWithFetchPending: PlayerView = {
  legalActions: [deckFetch, discardFetch, { action: { type: 'pass', player: 'p1' }, viable: true }],
} as unknown as PlayerView;

describe('prepareFetchFromPile — discoverability hint', () => {
  test('sets a targeting instruction so the fetch offer is not silently missable', () => {
    prepareFetchFromPile(viewWithFetchPending, cardPool, () => { /* no-op */ });

    expect(getTargetingInstruction()).toBe(FETCH_FROM_PILE_HINT);
    expect(hintEl.textContent).toContain(FETCH_FROM_PILE_HINT);
    expect(deckPile.classList.contains('pile--fetch-active')).toBe(true);
    expect(discardPile.classList.contains('pile--fetch-active')).toBe(true);
  });

  test('clearSelectionState clears the hint once the fetch sub-flow ends', () => {
    prepareFetchFromPile(viewWithFetchPending, cardPool, () => { /* no-op */ });
    expect(getTargetingInstruction()).toBe(FETCH_FROM_PILE_HINT);

    clearSelectionState();

    expect(getTargetingInstruction()).toBeNull();
    expect(hintEl.textContent).toBe('');
  });
});
