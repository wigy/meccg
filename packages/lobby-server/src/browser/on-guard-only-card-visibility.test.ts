/**
 * @module on-guard-only-card-visibility.test
 *
 * Regression test for bug report 0b917d21c4bd17fa (game ms941l08-pfac2w, seq
 * 893): "Cant select any card (on-guard can be anything) on non-moving
 * companies." CoE 2.IV.vii.4 lets the hazard player place *any* hand card
 * on-guard, and the engine correctly offered `place-on-guard` for every card
 * in the reporter's hand throughout the game — but a card whose only legal
 * action was `place-on-guard` (no `play-hazard`, `play-short-event`, etc.)
 * was rendered with the exact same `hand-card-dimmed` styling as a card with
 * *no* legal action at all. For a company whose hazard creatures don't key to
 * the site — the common case for a company that stayed put, since it has no
 * fresh destination to key against — every card in hand ends up in this
 * bucket, so the whole hand looked uniformly unplayable with no bright card
 * around to reveal the on-guard menu. The reporter's opponent (an AI that
 * acts directly on legal actions, bypassing this rendering) placed on-guard
 * cards throughout the same game without trouble.
 *
 * The highlight is deliberately *not* the answer: since any hand card may go
 * on-guard, glowing them all would make the whole hand read as playable and
 * drown out the cards with a real play. On-guard-only cards therefore keep the
 * dimmed styling but stay clickable, so the on-guard menu is still reachable
 * from every card.
 *
 * Uses the hand-rolled DOM stub pattern of `company-attachments-render.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { renderHand } from './render-hand.js';

const pool = loadCardPool();

const LESSER_RING = 'tw-266' as CardDefinitionId; // hero-resource-item, no hazard/short-event action
const RING_INSTANCE = 'p1-16' as CardInstanceId;

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: 'p1',
  cardInstanceId: RING_INSTANCE,
} as GameAction;

const passAction: GameAction = { type: 'pass', player: 'p1' } as GameAction;

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

/** A view where the only legal action for the hand's single card is place-on-guard. */
function onGuardOnlyView(): PlayerView {
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
    activePlayer: 'p2',
    phaseState: { phase: Phase.MovementHazard, step: null },
    legalActions: [
      { action: onGuardAction, viable: true },
      { action: passAction, viable: true },
    ],
  } as unknown as PlayerView;
}

describe('a hand card whose only legal action is place-on-guard', () => {
  test('renders dimmed, so the on-guard option never glows like a real play', () => {
    renderHand(onGuardOnlyView(), pool, () => { /* no-op */ });

    expect(handArc.children).toHaveLength(1);
    const cardsEl = handArc.children[0];
    expect(cardsEl.children).toHaveLength(1);
    const img = cardsEl.children[0];
    expect(img.className).toBe('hand-card hand-card-dimmed');
    expect(img.className).not.toContain('hand-card-playable');
  });

  test('clicking it opens a menu that dispatches place-on-guard', () => {
    let sent: GameAction | null = null;
    renderHand(onGuardOnlyView(), pool, action => { sent = action; });

    const img = handArc.children[0].children[0];
    img.dispatch('click');

    // The tooltip menu (backdrop > tooltip > button) is appended to document.body.
    const button = body.all().find(el => el.tagName === 'button');
    expect(button).toBeDefined();
    button!.dispatch('click');

    expect(sent).toEqual(onGuardAction);
  });
});
