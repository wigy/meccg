/**
 * @module armory-play-from-set-aside-click.test
 *
 * Regression test for bug report 9742326039defd14 (game mwbubabw-5wxnxj, seq
 * 892, turn 16 site phase): "Cant see to play any minors from armory". The
 * company was at The Lonely Mountain (a Border-hold via King under the
 * Mountain) with minor items stored under two Armories (dm-116). The engine
 * offered `play-hero-resource` actions with `fromSetAside: true` for Horn of
 * Anor and the other stored items — confirmed in the logged legalActions —
 * but the stored items live in `cardsInPlay`, not in hand, and
 * `renderInPlayCardImage` never looked for that action, so the cards had no
 * click affordance and could not be played.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  PlayHeroResourceAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCardsInPlayRow } from './company-block.js';
import { getSelectedResourceForPlay, clearResourcePlaySelection } from './render-selection-state.js';
import { findSetAsideItemPlayActions } from './set-aside-item-play.js';

const pool = loadCardPool();

const ARMORY = 'dm-116' as CardDefinitionId;
const HORN_OF_ANOR = 'tw-259' as CardDefinitionId;
const PLAYER = 'p1' as PlayerId;
const ARMORY_INST = 'p1-5' as CardInstanceId;
const HORN_INST = 'p1-11' as CardInstanceId;
const GLOIN = 'p1-180' as CardInstanceId;
const BALIN = 'p1-3' as CardInstanceId;

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

const playFromArmory = (bearer: CardInstanceId): PlayHeroResourceAction => ({
  type: 'play-hero-resource',
  player: PLAYER,
  cardInstanceId: HORN_INST,
  companyId: 'company-p1-0',
  attachToCharacterId: bearer,
  fromSetAside: true,
} as PlayHeroResourceAction);

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [],
      characters: {},
      cardsInPlay: [
        { instanceId: ARMORY_INST, definitionId: ARMORY, status: CardStatus.Untapped, setAside: [HORN_INST] },
        { instanceId: HORN_INST, definitionId: HORN_OF_ANOR, status: CardStatus.Untapped, setAsideHost: ARMORY_INST, setAsideNoMp: true },
      ],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'site', step: 'play-resources' },
    legalActions,
  } as unknown as PlayerView;
}

const findImg = (container: StubEl, id: CardInstanceId): StubEl | undefined =>
  container.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (id as string));

describe('Armory (dm-116) play item from under Armory', () => {
  test('findSetAsideItemPlayActions only returns fromSetAside plays of that card', () => {
    const fromHand = { ...playFromArmory(GLOIN), cardInstanceId: 'p1-14' as CardInstanceId, fromSetAside: undefined } as GameAction;
    const actions: GameAction[] = [playFromArmory(GLOIN), fromHand, { type: 'pass', player: PLAYER } as GameAction];
    expect(findSetAsideItemPlayActions(actions, HORN_INST)).toEqual([playFromArmory(GLOIN)]);
    expect(findSetAsideItemPlayActions(actions, 'p1-14' as CardInstanceId)).toEqual([]);
  });

  test('with one eligible bearer, clicking the stored item plays it directly', () => {
    const onAction = vi.fn();
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, boardView([playFromArmory(GLOIN)]), pool, onAction);

    const img = findImg(container, HORN_INST);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--movable')).toBe(true);
    img!.click();
    expect(onAction).toHaveBeenCalledWith(playFromArmory(GLOIN));
  });

  test('with several eligible bearers, clicking the stored item starts character targeting', () => {
    clearResourcePlaySelection();
    const onAction = vi.fn();
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, boardView([playFromArmory(GLOIN), playFromArmory(BALIN)]), pool, onAction);

    const img = findImg(container, HORN_INST);
    expect(img).toBeDefined();
    img!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(getSelectedResourceForPlay()).toBe(HORN_INST);
    clearResourcePlaySelection();
  });

  test('the Armory host itself gets no item-play affordance', () => {
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, boardView([playFromArmory(GLOIN)]), pool, vi.fn());
    const host = findImg(container, ARMORY_INST);
    expect(host).toBeDefined();
    expect(host!.classList.contains('company-card--movable')).toBe(false);
  });
});
