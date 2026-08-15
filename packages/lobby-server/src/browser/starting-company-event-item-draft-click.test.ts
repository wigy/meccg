/**
 * @module starting-company-event-item-draft-click.test
 *
 * Regression test for bug report 1b4955192d29fc33 (game msuclfw0-25sp6v, seq
 * 24): "Still no opportunity to play the card" — Orders from Lugbúrz (as-94)
 * may be played with a starting company in lieu of a minor item, and the
 * engine legally offered a `place-starting-company-event` action for it
 * throughout item-draft, but the browser board never gave the player a way
 * to take it.
 *
 * Two separate omissions combined to make the card unclickable:
 *  - `getHandCards` only populated the item-draft hand arc from
 *    `itemDraftState.unassignedItems`, but starting-company-event cards live
 *    in the play deck/sideboard instead, so the card was never even shown.
 *  - `findCardAction` / `isItemDraftCard` had no case for
 *    `place-starting-company-event`, so even if shown it would have rendered
 *    with no click handler.
 *
 * Uses the hand-rolled DOM stub pattern of chambers-site-target-live-focus.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase, SetupStep } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, CompanyId, GameAction } from '@meccg/shared';
import { renderHand } from './render-hand.js';
import { resetState } from './company-view-state.js';

const pool = loadCardPool();

const ORDERS_FROM_LUGBURZ = 'as-94' as CardDefinitionId;
const ORDERS_FROM_LUGBURZ_INSTANCE = 'p1-103' as CardInstanceId;
const MINOR_ITEM = 'le-310' as CardDefinitionId;
const MINOR_ITEM_INSTANCE = 'p1-104' as CardInstanceId;
const COMPANY = 'company-p1-0' as CompanyId;

const placeOrdersFromLugburz: GameAction = {
  type: 'place-starting-company-event',
  player: 'p1',
  cardDefId: ORDERS_FROM_LUGBURZ,
  companyId: COMPANY,
} as GameAction;

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
  resetState();
});

/** A player view mid item-draft: one minor item drafted, Orders from Lugbúrz still offered. */
function itemDraftView(): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  return {
    self: {
      ...emptySide,
      id: 'p1',
      sideboard: [{ instanceId: ORDERS_FROM_LUGBURZ_INSTANCE, definitionId: ORDERS_FROM_LUGBURZ }],
      companies: [{ id: COMPANY, currentSite: null, destinationSite: null, onGuardCards: [] }],
    },
    opponent: { ...emptySide, id: 'p2' },
    activePlayer: null,
    selfIndex: 0,
    phaseState: {
      phase: Phase.Setup,
      setupStep: {
        step: SetupStep.ItemDraft,
        itemDraftState: [
          { unassignedItems: [{ instanceId: MINOR_ITEM_INSTANCE, definitionId: MINOR_ITEM }], done: false },
          { unassignedItems: [], done: true },
        ],
        remainingPool: [[], []],
      },
    },
    legalActions: [
      { action: placeOrdersFromLugburz, viable: true },
      { action: { type: 'pass', player: 'p1' }, viable: true },
    ],
  } as unknown as PlayerView;
}

describe('Starting-company-event cards are clickable during item draft', () => {
  test('Orders from Lugbúrz appears in the hand arc and dispatches its placement action', () => {
    let sent: GameAction | null = null;
    renderHand(itemDraftView(), pool, action => { sent = action; });

    const cardImgs = handArc.children[0]?.children ?? [];
    const ordersImg = cardImgs.find(img => img.dataset.cardId === ORDERS_FROM_LUGBURZ);
    expect(ordersImg).toBeDefined();
    expect(ordersImg?.className).toBe('hand-card hand-card-playable');

    ordersImg?.dispatch('click');
    expect(sent).toEqual(placeOrdersFromLugburz);
  });
});
