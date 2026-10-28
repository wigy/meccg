/**
 * @module sideboard-with-multiple-nazgul-click.test
 *
 * Feature request 6b82aa0e77304a94: "If I have 2 or more Nazgul and I want to
 * discard one of them for fetching, there is no way to select one of them."
 *
 * The engine offers one `sideboard-with-nazgul` action per untapped Nazgûl
 * permanent-event and destination (rule 2.IV.vii.5), but
 * `renderInPlayCardImage`'s click dispatcher gave each in-play card a single
 * behaviour and checked the Nazgûl's own `tap-alt-permanent-event` ability
 * first. Any Nazgûl whose tap ability was available (Akhôrahil tw-4,
 * Adûnaphel tw-2, ...) therefore never showed the fetch options, so with
 * several Nazgûl in play the player could not choose which one to give up.
 * A Nazgûl offering both now opens one menu listing the tap ability and the
 * fetch destinations, each dispatching that card's own instance id.
 *
 * Uses the same hand-rolled DOM stub as sideboard-with-nazgul-click.test.ts
 * (the package runs vitest in the node environment, with no jsdom).
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
  TapAltPermanentEventAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCardsInPlayRow } from './company-block.js';
import { getSelectedTapAltPermanentEvent, clearTapAltPermanentEventSelection } from './render.js';

const pool = loadCardPool();

const PLAYER = 'p1' as PlayerId;
const AKHORAHIL = { instanceId: 'p1-40' as CardInstanceId, definitionId: 'tw-4' as CardDefinitionId };
const HOARMURATH = { instanceId: 'p1-48' as CardInstanceId, definitionId: 'tw-44' as CardDefinitionId };
const ADUNAPHEL = { instanceId: 'p1-33' as CardInstanceId, definitionId: 'tw-2' as CardDefinitionId };
const OPP_CHAR = 'p2-102' as CardInstanceId;

// --- Minimal DOM stub (see sideboard-with-nazgul-click.test.ts) --------------

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
  clearTapAltPermanentEventSelection();
});

// --- Fixtures -----------------------------------------------------------------

const fetch = (inst: CardInstanceId, destination: 'discard' | 'deck'): SideboardWithNazgulAction => ({
  type: 'sideboard-with-nazgul',
  player: PLAYER,
  cardInstanceId: inst,
  destination,
});

const tapAlt = (inst: CardInstanceId, targetCharacterId?: CardInstanceId): TapAltPermanentEventAction => ({
  type: 'tap-alt-permanent-event',
  player: PLAYER,
  cardInstanceId: inst,
  ...(targetCharacterId ? { targetCharacterId } : {}),
});

function boardView(
  cards: readonly { instanceId: CardInstanceId; definitionId: CardDefinitionId }[],
  legalActionsRaw: GameAction[],
): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [],
      characters: {},
      cardsInPlay: cards.map(c => ({ ...c, status: CardStatus.Untapped })),
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p2',
    phaseState: { phase: 'movement-hazard', step: 'play-hazards' },
    legalActions,
  } as unknown as PlayerView;
}

function render(view: PlayerView, onAction: (a: GameAction) => void): StubEl {
  const container = new StubEl('div');
  renderCardsInPlayRow(container as unknown as HTMLElement, view, pool, onAction);
  return container;
}

const findImg = (container: StubEl, inst: CardInstanceId): StubEl | undefined =>
  container.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (inst as string));

/** The buttons of the most recently opened tooltip menu. */
function menuButtons(): StubEl[] {
  const tooltips = bodyStub.all().filter(e => e.className === 'char-action-tooltip');
  expect(tooltips.length).toBeGreaterThan(0);
  return tooltips[tooltips.length - 1].children.filter(c => c.tagName === 'button');
}

describe('choosing which Nazgûl to discard for sideboard access', () => {
  test('a Nazgûl with a tap ability still offers the fetch, for its own instance', () => {
    const onAction = vi.fn();
    const view = boardView([AKHORAHIL, HOARMURATH], [
      tapAlt(AKHORAHIL.instanceId),
      fetch(AKHORAHIL.instanceId, 'discard'),
      fetch(AKHORAHIL.instanceId, 'deck'),
      fetch(HOARMURATH.instanceId, 'discard'),
      fetch(HOARMURATH.instanceId, 'deck'),
    ]);
    const container = render(view, onAction);

    const akhorahil = findImg(container, AKHORAHIL.instanceId)!;
    const hoarmurath = findImg(container, HOARMURATH.instanceId)!;
    expect(akhorahil.classList.contains('company-card--movable')).toBe(true);
    expect(hoarmurath.classList.contains('company-card--movable')).toBe(true);

    akhorahil.click();
    expect(onAction).not.toHaveBeenCalled();
    const buttons = menuButtons();
    expect(buttons.map(b => b.textContent)).toEqual([
      'Tap Akhôrahil: becomes a short-event',
      'Tap & discard Akhôrahil: fetch hazards to discard pile',
      'Tap & discard Akhôrahil: fetch 1 hazard to play deck',
    ]);

    buttons[1].click();
    expect(onAction).toHaveBeenCalledWith(fetch(AKHORAHIL.instanceId, 'discard'));
  });

  test('the other Nazgûl dispatches its own instance id', () => {
    const onAction = vi.fn();
    const view = boardView([AKHORAHIL, HOARMURATH], [
      tapAlt(AKHORAHIL.instanceId),
      fetch(AKHORAHIL.instanceId, 'discard'),
      fetch(HOARMURATH.instanceId, 'discard'),
      fetch(HOARMURATH.instanceId, 'deck'),
    ]);
    const container = render(view, onAction);

    findImg(container, HOARMURATH.instanceId)!.click();
    menuButtons()[1].click();
    expect(onAction).toHaveBeenCalledWith(fetch(HOARMURATH.instanceId, 'deck'));
  });

  test('two Nazgûl with tap abilities each dispatch their own instance id', () => {
    const onAction = vi.fn();
    const view = boardView([AKHORAHIL, ADUNAPHEL], [
      tapAlt(AKHORAHIL.instanceId),
      fetch(AKHORAHIL.instanceId, 'discard'),
      tapAlt(ADUNAPHEL.instanceId, OPP_CHAR),
      fetch(ADUNAPHEL.instanceId, 'discard'),
    ]);
    const container = render(view, onAction);

    findImg(container, ADUNAPHEL.instanceId)!.click();
    menuButtons()[1].click();
    expect(onAction).toHaveBeenLastCalledWith(fetch(ADUNAPHEL.instanceId, 'discard'));

    findImg(container, AKHORAHIL.instanceId)!.click();
    menuButtons()[1].click();
    expect(onAction).toHaveBeenLastCalledWith(fetch(AKHORAHIL.instanceId, 'discard'));
  });

  test('the tap entry fires a targetless tap directly', () => {
    const onAction = vi.fn();
    const view = boardView([AKHORAHIL], [
      tapAlt(AKHORAHIL.instanceId),
      fetch(AKHORAHIL.instanceId, 'discard'),
    ]);
    const container = render(view, onAction);

    findImg(container, AKHORAHIL.instanceId)!.click();
    menuButtons()[0].click();
    expect(onAction).toHaveBeenCalledWith(tapAlt(AKHORAHIL.instanceId));
  });

  test('the tap entry for a targeted tap (Adûnaphel) starts character selection', () => {
    const onAction = vi.fn();
    const view = boardView([ADUNAPHEL], [
      tapAlt(ADUNAPHEL.instanceId, OPP_CHAR),
      fetch(ADUNAPHEL.instanceId, 'discard'),
    ]);
    const container = render(view, onAction);

    findImg(container, ADUNAPHEL.instanceId)!.click();
    menuButtons()[0].click();
    expect(onAction).not.toHaveBeenCalled();
    expect(getSelectedTapAltPermanentEvent()).toBe(ADUNAPHEL.instanceId);

    // Re-rendered while selected: clicking again cancels instead of reopening the menu.
    const menusBefore = bodyStub.all().filter(e => e.className === 'char-action-tooltip').length;
    const rerendered = render(view, onAction);
    findImg(rerendered, ADUNAPHEL.instanceId)!.click();
    expect(getSelectedTapAltPermanentEvent()).toBeNull();
    expect(bodyStub.all().filter(e => e.className === 'char-action-tooltip').length).toBe(menusBefore);
  });

  test('a Nazgûl with only a tap ability still fires it directly', () => {
    const onAction = vi.fn();
    const view = boardView([AKHORAHIL], [tapAlt(AKHORAHIL.instanceId)]);
    const container = render(view, onAction);

    findImg(container, AKHORAHIL.instanceId)!.click();
    expect(onAction).toHaveBeenCalledWith(tapAlt(AKHORAHIL.instanceId));
  });
});
