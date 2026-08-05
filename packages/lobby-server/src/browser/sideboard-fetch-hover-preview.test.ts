/**
 * @module sideboard-fetch-hover-preview.test
 *
 * Regression test for bug report 35e48aaee3d9c154 (game msemg36i-8u3lp2, seq
 * 325): "When doing fetch from sideboard at the end of the turn, you aren't
 * able to see a blown up preview of the card when hovering over."
 *
 * Root cause: `openCardGridModal` (used by the "Fetch from Sideboard" and
 * granted-target pickers) appends its card images to `document.body`, outside
 * `#visual-view` — but `setupCardPreview` (render-card-preview.ts) only wires
 * up hover preview via a delegated `mouseover` listener on `#visual-view`, and
 * additionally requires `data-card-id` on the hovered image, which these modal
 * images deliberately omit (so the FLIP animation system ignores them). The
 * combination meant hovering a card in the sideboard-fetch grid never
 * populated `#card-preview`.
 *
 * Fix: `openCardGridModal` now wires its own `mouseenter`/`mouseleave`
 * listeners directly on each modal card image, populating the shared
 * `#card-preview` panel via `buildCardPreviewInfo` without touching
 * `data-card-id`/`data-instance-id`.
 */

import './test-dom-bootstrap.js'; // must precede the company-modals import (load-time window access)
import { describe, test, expect, afterEach } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { openSideboardForFetch, dismissSideboardModal } from './company-modals.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const FETCHED_DEF = 'tw-67' as CardDefinitionId; // Muster Disperses — has a proxy image
const FETCHED_INSTANCE = 'p1-96' as CardInstanceId;

setCachedInstanceLookup((id: CardInstanceId) => (id === FETCHED_INSTANCE ? FETCHED_DEF : undefined));

// --- Minimal DOM stub, mirroring on-guard-discard-target-click.test.ts ------

class StubEl {
  tagName: string;
  parent: StubEl | null = null;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  private _innerHTML = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx !== -1) this.parent.children.splice(idx, 1);
    this.parent = null;
  }
  get innerHTML(): string { return this._innerHTML; }
  set innerHTML(value: string) { this._innerHTML = value; this.children = []; }
  querySelectorAll(selector: string): StubEl[] {
    const cls = selector.replace('.', '');
    return this.all().filter(el => el.className.split(' ').includes(cls));
  }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  dispatch(type: string): void {
    for (const h of this.listeners[type] ?? []) h({});
  }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

const body = new StubEl('body');
const cardPreview = new StubEl('div');

(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new StubEl(tag),
  body,
  getElementById: (id: string) => (id === 'card-preview' ? cardPreview : null),
  querySelector: (selector: string) => {
    const cls = selector.replace('.', '');
    return body.all().find(el => el.className.split(' ').includes(cls)) ?? null;
  },
};

afterEach(() => {
  dismissSideboardModal();
  cardPreview.innerHTML = '';
});

function fetchAction(): GameAction {
  return {
    type: 'fetch-hazard-from-sideboard',
    player: 'p1',
    sideboardCardInstanceId: FETCHED_INSTANCE,
  } as GameAction;
}

describe('sideboard-fetch modal — hover preview', () => {
  test('hovering a card in the grid populates #card-preview with its blown-up info', () => {
    openSideboardForFetch([fetchAction()], null, pool, () => { /* no-op */ });

    const cardImg = body.all().find(el => el.className.includes('sideboard-fetch-card'));
    expect(cardImg).toBeDefined();
    expect(cardPreview.children.length).toBe(0);

    cardImg!.dispatch('mouseenter');

    expect(cardPreview.children.length).toBeGreaterThan(0);
    const nameEl = cardPreview.all().find(el => el.className === 'card-preview-name');
    expect(nameEl).toBeDefined();
  });

  test('mouseleave clears the preview', () => {
    openSideboardForFetch([fetchAction()], null, pool, () => { /* no-op */ });
    const cardImg = body.all().find(el => el.className.includes('sideboard-fetch-card'));

    cardImg!.dispatch('mouseenter');
    expect(cardPreview.children.length).toBeGreaterThan(0);

    cardImg!.dispatch('mouseleave');
    expect(cardPreview.children.length).toBe(0);
  });
});
