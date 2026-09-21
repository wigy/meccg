/**
 * @module sideboard-with-nazgul-click.test
 *
 * Regression test for bug report d758b623d2af1fb2 (game mua2yi5x-908841, turn
 * 13, movement-hazard phase): "Can't click on Hoarmurath to fetch hazards.
 * similar to wizard but than for hazard, and with a discard of the nazgul."
 *
 * The engine correctly offered `sideboard-with-nazgul` for the reporter's
 * untapped Hoarmûrath of Dír (tw-44) permanent-event — confirmed directly in
 * the logged state's legalActions at seq 505 — but nothing in the browser
 * board wired that action type to a click on the in-play card. The analogous
 * resource-side ability (tapping an avatar to access the sideboard, rule
 * 2.II.6) is wired via `getSideboardIntentActions`/`sideboardIntentActions`
 * on character clicks, but Hoarmûrath's Nazgûl sideboard access (rule
 * 2.IV.vii.5) lives on a bare `cardsInPlay` entry, not a character, so
 * `renderInPlayCardImage`'s click dispatcher never consulted it — the card
 * had no board affordance at all.
 *
 * Uses the same hand-rolled DOM stub as declare-burglary-click.test.ts (the
 * package runs vitest in the default node environment, with no jsdom); the
 * two-destination case exercises `showTooltipMenu`'s `auto` placement, which
 * needs `document.body`/`querySelector`/`getBoundingClientRect` and
 * `window.innerWidth`/`innerHeight`.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  SideboardWithNazgulAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCardsInPlayRow } from './company-block.js';

const pool = loadCardPool();

const HOARMURATH = 'tw-44' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const HOARMURATH_INST = 'p1-48' as CardInstanceId;

// --- Minimal DOM stub, extended with body/querySelector/getBoundingClientRect
// so showTooltipMenu (used by the two-destination menu path) can run. -------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: () => void } = { setProperty: () => { /* no-op */ } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
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
  get childElementCount(): number { return this.children.length; }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let bodyStub: StubEl;

beforeEach(() => {
  bodyStub = new StubEl('body');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    body: bodyStub,
    addEventListener: () => { /* no-op: swallow showTooltipMenu's deferred click-outside listener */ },
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
});

// --- View fixtures ------------------------------------------------------------

const sideboardWithNazgul = (destination: 'discard' | 'deck'): SideboardWithNazgulAction => ({
  type: 'sideboard-with-nazgul',
  player: PLAYER,
  cardInstanceId: HOARMURATH_INST,
  destination,
});

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [],
      characters: {},
      cardsInPlay: [{ instanceId: HOARMURATH_INST, definitionId: HOARMURATH, status: CardStatus.Untapped }],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'movement-hazard', step: 'play-hazards' },
    legalActions,
  } as unknown as PlayerView;
}

const findHoarmurathImg = (container: StubEl): StubEl | undefined =>
  container.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (HOARMURATH_INST as string));

describe('sideboard-with-nazgul offered by an in-play Nazgûl permanent-event (Hoarmûrath of Dír, tw-44)', () => {
  test('with only the discard destination available, clicking the card fires it directly', () => {
    const onAction = vi.fn();
    const view = boardView([sideboardWithNazgul('discard')]);
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, view, pool, onAction);

    const img = findHoarmurathImg(container);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--movable')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(sideboardWithNazgul('discard'));
  });

  test('with both destinations available, clicking the card opens a menu to choose', () => {
    const onAction = vi.fn();
    const view = boardView([sideboardWithNazgul('discard'), sideboardWithNazgul('deck')]);
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, view, pool, onAction);

    const img = findHoarmurathImg(container);
    expect(img).toBeDefined();

    img!.click();
    expect(onAction).not.toHaveBeenCalled();

    const tooltip = bodyStub.all().find(e => e.className === 'char-action-tooltip');
    expect(tooltip).toBeDefined();
    const buttons = tooltip!.children.filter(c => c.tagName === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons.map(b => b.textContent)).toEqual(['Fetch to Discard', 'Fetch to Deck']);

    buttons[1].click();
    expect(onAction).toHaveBeenCalledWith(sideboardWithNazgul('deck'));
  });
});
