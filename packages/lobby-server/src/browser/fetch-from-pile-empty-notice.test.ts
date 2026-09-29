/**
 * @module fetch-from-pile-empty-notice.test
 *
 * Regression test for bug report 47c7d707a2046636: "In the event that a card
 * search type ability like Mistress Lobelia fails because there is no
 * eligible card to be found, there should be a message indicating this
 * result to the player." Mistress Lobelia (dm-178) queues a fetch-to-deck
 * pending effect; when nothing in the discard pile or play deck qualifies,
 * the engine offers only Pass, so the fetch sub-flow never started and the
 * player saw no explanation at all.
 *
 * Uses the hand-rolled DOM stub pattern of
 * fetch-from-pile-targeting-hint.test.ts (no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { PlayerView } from '@meccg/shared';
import { prepareEmptyFetchNotice, clearSelectionState, FETCH_FROM_PILE_EMPTY_HINT } from './render-piles.js';
import { getTargetingInstruction } from './render-selection-state.js';

class StubEl {
  classList = { add(): void { /* no-op */ }, remove(): void { /* no-op */ } };
  textContent = '';
}

let hintEl: StubEl;

beforeEach(() => {
  hintEl = new StubEl();
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => (id === 'phase-target-hint' ? hintEl : new StubEl()),
    body: new StubEl(),
  };
});

afterEach(() => {
  clearSelectionState();
  delete (globalThis as unknown as { document?: unknown }).document;
});

/** Mistress Lobelia's fetch, pending on p1, with only Pass legal. */
function lobeliaFetchView(selfId: string, legalActions: unknown[]): PlayerView {
  return {
    self: { id: selfId },
    activePlayer: 'p1',
    pendingEffects: [{
      type: 'card-effect',
      cardInstanceId: 'p1-7',
      actor: 'p1',
      effect: { type: 'fetch-to-deck', source: ['discard-pile', 'deck'], filter: {}, count: 1, shuffle: true, to: 'hand' },
    }],
    legalActions,
  } as unknown as PlayerView;
}

const pass = { action: { type: 'pass', player: 'p1' }, viable: true };

describe('prepareEmptyFetchNotice — fruitless search message', () => {
  test('tells the searching player no eligible card was found', () => {
    expect(prepareEmptyFetchNotice(lobeliaFetchView('p1', [pass]))).toBe(true);
    expect(getTargetingInstruction()).toBe(FETCH_FROM_PILE_EMPTY_HINT);
    expect(hintEl.textContent).toContain(FETCH_FROM_PILE_EMPTY_HINT);

    clearSelectionState();
    expect(getTargetingInstruction()).toBeNull();
  });

  test('not shown when a card can be fetched', () => {
    const fetch = { action: { type: 'fetch-from-pile', player: 'p1', cardInstanceId: 'p1-20', source: 'deck', to: 'hand' }, viable: true };
    expect(prepareEmptyFetchNotice(lobeliaFetchView('p1', [fetch, pass]))).toBe(false);
    expect(getTargetingInstruction()).toBeNull();
  });

  test('not shown to the opponent', () => {
    expect(prepareEmptyFetchNotice(lobeliaFetchView('p2', []))).toBe(false);
    expect(getTargetingInstruction()).toBeNull();
  });
});
