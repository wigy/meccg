/**
 * @module discard-confirmation.test
 *
 * Feature request: clicking a hand card at not exactly the right time (during
 * the end-of-turn discard steps, `end-of-turn.ts:76-127,133-169`, or the
 * movement-hazard hand-reduction step, `movement-hazard.ts:3967-3997`) caused
 * an immediate, unconfirmed discard whenever `discard-card` was the card's
 * only legal action. Every other place the hand renderer must disambiguate
 * between legal actions for a clicked card (short-event discard/on-guard,
 * hazard keying, agent plays) opens a cursor-anchored `showCursorTooltipMenu`
 * popup instead of dispatching straight away.
 *
 * `discardOnlyChoices` now builds the same kind of choice list for the bare
 * discard fallback, and the fallback branch in `render-hand.ts` routes the
 * click through `showCursorTooltipMenu` rather than calling `onAction`
 * directly, so a misclick opens a confirmation box (dismissed by clicking
 * elsewhere, per the existing backdrop-click-outside behavior) instead of
 * instantly discarding the card.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { discardOnlyChoices, renderHand } from './render-hand.js';

const pool = loadCardPool();

const LESSER_RING = 'tw-266' as CardDefinitionId; // hero-resource-item, no hazard/short-event action
const RING_INSTANCE = 'p1-16' as CardInstanceId;

const discardAction: GameAction = {
  type: 'discard-card',
  player: 'p1',
  cardInstanceId: RING_INSTANCE,
} as GameAction;

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: 'p1',
  cardInstanceId: RING_INSTANCE,
} as GameAction;

describe('discardOnlyChoices', () => {
  test('only a discard action supplied yields a single Discard choice', () => {
    const choices = discardOnlyChoices(discardAction, undefined);

    expect(choices).toHaveLength(1);
    expect(choices[0]).toEqual({ label: 'Discard', action: discardAction });
  });

  test('both actions supplied yields Discard then Place on-guard, in that order', () => {
    const choices = discardOnlyChoices(discardAction, onGuardAction);

    expect(choices.map(c => c.label)).toEqual(['Discard', 'Place on-guard']);
    expect(choices[1].action).toBe(onGuardAction);
  });
});

// ---- DOM click-through, mirroring on-guard-only-card-visibility.test.ts's
// hand-rolled DOM stub pattern (the package runs vitest in the default node
// environment, with no jsdom). ----

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  title = '';
  dataset: Record<string, string> = {};
  style = { setProperty: () => { /* no-op */ }, cursor: '' };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  remove(): void { /* no-op */ }
  dispatch(type: string, event: unknown = { clientX: 0, clientY: 0, stopPropagation() { /* no-op */ } }): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let handArc: StubEl;
let body: StubEl;

beforeEach(() => {
  handArc = new StubEl('div');
  body = new StubEl('body');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id === 'hand-arc' ? handArc : null),
    querySelector: () => null,
    body,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

/** A view where the only legal action for the hand's single card is discard-card. */
function discardOnlyView(): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  return {
    self: {
      ...emptySide,
      id: 'p1',
      hand: [{ instanceId: RING_INSTANCE, definitionId: LESSER_RING }],
    },
    opponent: { ...emptySide, id: 'p2' },
    activePlayer: 'p1',
    phaseState: { phase: Phase.EndOfTurn, step: 'reset-hand' },
    legalActions: [
      { action: discardAction, viable: true },
    ],
  } as unknown as PlayerView;
}

describe('a hand card whose only legal action is discard-card', () => {
  test('clicking it does not immediately dispatch the discard', () => {
    let sent: GameAction | null = null;
    renderHand(discardOnlyView(), pool, action => { sent = action; });

    const img = handArc.children[0];
    img.dispatch('click');

    expect(sent).toBeNull();
  });

  test('clicking it opens a confirmation menu; clicking Discard dispatches discard-card', () => {
    let sent: GameAction | null = null;
    renderHand(discardOnlyView(), pool, action => { sent = action; });

    const img = handArc.children[0];
    img.dispatch('click');

    // The tooltip menu (backdrop > tooltip > button) is appended to document.body.
    const button = body.all().find(el => el.tagName === 'button');
    expect(button).toBeDefined();
    button!.dispatch('click');

    expect(sent).toEqual(discardAction);
  });
});
