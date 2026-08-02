/**
 * @module discard-confirmation.test
 *
 * Feature request d890e2b75da8f736: "Clicking cards at not exactly the right
 * time, causes them to be immediately discarded." During the end-of-turn
 * discard step, the reset-hand step, and the movement-hazard hand-reduction
 * step, a hand card's only legal action can be a bare `discard-card`. The
 * hand renderer's fallback branch used to dispatch that action straight from
 * the click, so a misclick irrevocably discarded the card.
 *
 * The fix routes the click through the same cursor tooltip menu used for
 * every other hand-card disambiguation (short-event targets, hazard keying,
 * on-guard placement): the first click opens a "Discard" popup, a second
 * click on the button confirms, and clicking anywhere else dismisses it.
 *
 * Uses the hand-rolled DOM stub pattern of
 * `on-guard-only-card-visibility.test.ts` (the package runs vitest in the
 * default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { renderHand, discardOnlyChoices } from './render-hand.js';

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

const passAction: GameAction = { type: 'pass', player: 'p1' } as GameAction;

describe('discardOnlyChoices', () => {
  test('a bare discard action yields a single Discard choice', () => {
    const choices = discardOnlyChoices(discardAction, undefined);

    expect(choices.map(c => c.label)).toEqual(['Discard']);
    expect(choices[0].action).toBe(discardAction);
  });

  test('an accompanying on-guard action is appended after Discard, never dropped', () => {
    const choices = discardOnlyChoices(discardAction, onGuardAction);

    expect(choices.map(c => c.label)).toEqual(['Discard', 'Place on-guard']);
    expect(choices[1].action).toBe(onGuardAction);
  });
});

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  title = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty: () => { /* no-op */ } };
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
    phaseState: { phase: Phase.EndOfTurn, step: null },
    legalActions: [
      { action: discardAction, viable: true },
      { action: passAction, viable: true },
    ],
  } as unknown as PlayerView;
}

describe('a hand card whose only legal action is discard-card', () => {
  test('clicking it opens a confirmation menu instead of discarding immediately', () => {
    let sent: GameAction | null = null;
    renderHand(discardOnlyView(), pool, action => { sent = action; });

    expect(handArc.children).toHaveLength(1);
    const cardsEl = handArc.children[0];
    expect(cardsEl.children).toHaveLength(1);
    const img = cardsEl.children[0];
    expect(img.className).toBe('hand-card hand-card-playable');

    img.dispatch('click');

    // The click alone must not discard the card.
    expect(sent).toBeNull();

    // The tooltip menu (backdrop > tooltip > button) is appended to document.body.
    const button = body.all().find(el => el.tagName === 'button');
    expect(button).toBeDefined();
    expect(button!.textContent).toBe('Discard');
  });

  test('clicking the Discard button in the menu dispatches the discard action', () => {
    let sent: GameAction | null = null;
    renderHand(discardOnlyView(), pool, action => { sent = action; });

    handArc.children[0].children[0].dispatch('click');
    const button = body.all().find(el => el.tagName === 'button');
    button!.dispatch('click');

    expect(sent).toEqual(discardAction);
  });

  test('clicking the backdrop dismisses the menu without discarding', () => {
    let sent: GameAction | null = null;
    renderHand(discardOnlyView(), pool, action => { sent = action; });

    handArc.children[0].children[0].dispatch('click');
    const backdrop = body.all().find(el => el.className === 'chain-target-backdrop');
    expect(backdrop).toBeDefined();
    backdrop!.dispatch('click');

    expect(sent).toBeNull();
  });
});
