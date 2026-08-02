/**
 * @module hand-arc-scale-target.test
 *
 * Regression test for bug report 312ca3add87e3ef7 (game msbzsycu-lnleri, seq
 * 7): "quand j'ai trop de cartes en main j'ai du mal a acceder aux dernieres
 * sur les cotes" (with too many cards in hand, the last ones on the sides
 * are hard to reach). A large hand (15 cards in the reported game's character
 * draft pool) triggers fitHandArc's scale-to-fit transform. That transform
 * used to land on #hand-arc itself, which also hosts a `position: fixed`
 * `::before` pseudo-element used as the hover catch-zone that keeps the fan
 * raised while the mouse crosses the gaps between fanned cards. A `transform`
 * on #hand-arc makes it the containing block for that fixed-position
 * descendant, pulling the catch-zone's viewport-relative edges inward by
 * exactly the arc's own side margins -- shrinking it right when a large hand
 * needs scaling, so the mouse loses hover near the fanned-out side cards and
 * the arc snaps shut before they can be clicked.
 *
 * The fix renders cards into an inner `.hand-arc-cards` wrapper and applies
 * the scale transform there instead, leaving #hand-arc itself untransformed
 * so its catch-zone stays anchored to the viewport.
 *
 * Uses the hand-rolled DOM stub pattern of
 * `on-guard-only-card-visibility.test.ts` (the package runs vitest in the
 * default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId } from '@meccg/shared';
import { renderHand } from './render-hand.js';

const pool = loadCardPool();

const LESSER_RING = 'tw-266' as CardDefinitionId; // hero-resource-item, no hazard/short-event action

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  title = '';
  offsetWidth = 200; // forces fitHandArc's overflow branch to engage
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty: () => { /* no-op */ } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  remove(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  get firstElementChild(): StubEl | null { return this.children[0] ?? null; }
}

let handArc: StubEl;

beforeEach(() => {
  handArc = new StubEl('div');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id === 'hand-arc' ? handArc : null),
    querySelector: () => null,
    body: new StubEl('body'),
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 1000, innerHeight: 1000 };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

/** A view with a large (15-card) hand, mirroring the reported game's draft pool size. */
function largeHandView(): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  const hand = Array.from({ length: 15 }, (_, i) => ({
    instanceId: `p1-${i}` as CardInstanceId,
    definitionId: LESSER_RING,
  }));
  return {
    self: { ...emptySide, id: 'p1', hand },
    opponent: { ...emptySide, id: 'p2' },
    activePlayer: 'p1',
    phaseState: { phase: Phase.Organization, step: null },
    legalActions: [],
  } as unknown as PlayerView;
}

describe('a large hand that overflows the arc and needs scaling', () => {
  test('the scale transform lands on the inner cards wrapper, not on #hand-arc', () => {
    renderHand(largeHandView(), pool, () => { /* no-op */ });

    expect(handArc.children).toHaveLength(1);
    const cardsEl = handArc.children[0];
    expect(cardsEl.className).toBe('hand-arc-cards');
    expect(cardsEl.children).toHaveLength(15);

    // The wrapper must be scaled down to fit...
    expect(cardsEl.style.transform).toMatch(/^scale\(/);
    // ...but #hand-arc itself must stay untransformed, or it would become the
    // containing block for its `::before` hover catch-zone (a `position:
    // fixed` pseudo-element) and break the catch-zone's viewport-relative
    // sizing right when the arc needs to scale.
    expect(handArc.style.transform).toBeUndefined();
  });
});
