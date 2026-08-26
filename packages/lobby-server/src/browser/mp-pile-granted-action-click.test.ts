/**
 * @module mp-pile-granted-action-click.test
 *
 * Regression test for bug report b1d659842346e2b9 (game mt7a24d0-qcbgun, seq
 * 1053): "It [Andúril, the Flame of the West] is stored at a haven with a
 * reforging. I should be able to discard the stored reforging to place
 * andúril with narsil, but I don't see an option to do so."
 *
 * The engine correctly offers `anduril-combine-with-narsil` as a viable
 * `activate-granted-action` once Andúril (tw-192) is stored at a Haven with a
 * stored Reforging (tw-314) available to discard (`storedCombineGrantActions`
 * in organization.ts) — confirmed present in the game log at the reported
 * sequence. But nothing in the browser wired it up: a `storedAtSite` card has
 * no bearer, so it never appears on the board — the MP (marshalling-point)
 * pile browser is the only place the player ever sees it, and
 * `populateBrowserGrid` in render-piles.ts had no branch checking for granted
 * actions sourced from a killPile card. Fixed by tracking whether the self MP
 * pile is being browsed and, for that pile, wiring any card with a viable
 * `activate-granted-action` into the same `showInPlayGrantedActionMenu` used
 * for other bearer-less sources (Sauron ba-43, A Panoply of Wings wh-37).
 */

import './test-dom-bootstrap.js'; // must precede the render-piles import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, ViewCard, CardInstanceId, PlayerId, ActivateGrantedAction } from '@meccg/shared';
import { renderDeckPiles } from './render-piles.js';

const pool = loadCardPool();

const ANDURIL = 'tw-192'; // Andúril, the Flame of the West — stored, offers the combine ability
const OTHER_CARD = 'td-19'; // padded out so the fix is proven selective, not "every MP pile card became clickable"

const ANDURIL_INSTANCE = 'p1-122' as CardInstanceId;
const OTHER_INSTANCE = 'p1-42' as CardInstanceId;
const REFORGING_INSTANCE = 'p1-29' as CardInstanceId; // stored Reforging, the discard candidate
const NARSIL_BEARER = 'p1-124' as CardInstanceId; // character bearing Narsil, the recipient

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {};
  title = '';
  alt = '';
  src = '';
  textContent = '';
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ }, currentTarget: this, target: this });
  }
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number } {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  remove(): void { /* no-op */ }
  querySelectorAll(selector: string): StubEl[] {
    return this.children.filter(c => c.tagName === selector);
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
}

let byId: Record<string, StubEl>;
let bodyStub: StubEl;

beforeEach(() => {
  bodyStub = new StubEl('body');
  byId = {
    'self-mp-pile': new StubEl('div'),
    'pile-browser-modal': new StubEl('div'),
    'pile-browser-title': new StubEl('div'),
    'pile-browser-grid': new StubEl('div'),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? null,
    querySelector: () => null,
    body: bodyStub,
    addEventListener: () => { /* no-op: document-level Escape handler */ },
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const PLAYER_1 = 'p1' as PlayerId;

const pileCard = (defId: string, instanceId: CardInstanceId): ViewCard =>
  ({ instanceId, definitionId: defId } as unknown as ViewCard);

const selfKillPile: ViewCard[] = [
  pileCard(OTHER_CARD, OTHER_INSTANCE),
  pileCard(ANDURIL, ANDURIL_INSTANCE),
];

const combineAction: EvaluatedAction = {
  action: {
    type: 'activate-granted-action', player: PLAYER_1,
    characterId: ANDURIL_INSTANCE, // bearer-less source self-references
    sourceCardId: ANDURIL_INSTANCE,
    sourceCardDefinitionId: ANDURIL,
    actionId: 'anduril-combine-with-narsil',
    rollThreshold: 0,
    targetCardId: REFORGING_INSTANCE,
    recipientCharacterId: NARSIL_BEARER,
  } as ActivateGrantedAction,
  viable: true,
};

const passAction: EvaluatedAction = { action: { type: 'pass', player: PLAYER_1 }, viable: true } as EvaluatedAction;

const view = {
  self: { id: 'p1', playDeck: [], siteDeck: [], sideboard: [], killPile: selfKillPile, outOfPlayPile: [], discardPile: [] },
  opponent: { id: 'p2', playDeck: [], siteDeck: [], sideboard: [], killPile: [], outOfPlayPile: [], discardPile: [] },
  legalActions: [combineAction, passAction],
} as unknown as PlayerView;

describe('MP pile granted-action click (Andúril, the Flame of the West tw-192)', () => {
  test('a stored card with a viable activate-granted-action is clickable and fires the action', () => {
    const onAction = vi.fn();
    renderDeckPiles(view, pool, onAction);

    // Open the pile browser the same way a player click on the MP pile would.
    byId['self-mp-pile'].click();

    const gridImgs = byId['pile-browser-grid'].children;
    expect(gridImgs.length).toBe(selfKillPile.length);

    const selectable = gridImgs.filter(img => img.classList.contains('site-selectable'));
    expect(selectable.map(img => img.dataset.instanceId)).toEqual([`browser:${ANDURIL_INSTANCE}`]);

    // Click the stored card -> ability tooltip -> its single discard candidate.
    selectable[0].click();
    const tooltip = bodyStub.children.find(c => c.className === 'char-action-tooltip');
    expect(tooltip).toBeDefined();
    tooltip!.children[0].click();

    const cardGridModal = bodyStub.children.find(c => c.className === 'granted-target-modal');
    expect(cardGridModal).toBeDefined();
    const grid = cardGridModal!.children.find(c => c.className === 'granted-target-grid');
    expect(grid).toBeDefined();
    expect(grid!.children).toHaveLength(1);
    grid!.children[0].click();

    expect(onAction).toHaveBeenCalledWith(combineAction.action);
    // The MP pile browser closes once the ability fires.
    expect(byId['pile-browser-modal'].classList.contains('hidden')).toBe(true);
  });

  test('no granted action offered — no MP pile card is selectable', () => {
    const onAction = vi.fn();
    const viewWithoutGrant = { ...view, legalActions: [passAction] } as unknown as PlayerView;
    renderDeckPiles(viewWithoutGrant, pool, onAction);

    byId['self-mp-pile'].click();

    const gridImgs = byId['pile-browser-grid'].children;
    const selectable = gridImgs.filter(img => img.classList.contains('site-selectable'));
    expect(selectable).toHaveLength(0);
  });
});
