/**
 * @module discard-item-from-company-click.test
 *
 * Regression test for bug report 95667dd977632547 (game msyzbg80-1qwf56, seq
 * 462): "Logged in after 5 min. Still dont see a selection box where I can
 * select an item" — after Brigands (tw-17) wounded a character, the engine
 * correctly enqueued a `discard-one-company-item` pending resolution and
 * offered `discard-item-from-company` actions for every item in the company
 * (confirmed by packages/shared/src/tests/cards/tw-17.test.ts), but the
 * browser client had no click handler wired to that action type at all —
 * unlike every sibling action (store-item, transfer-item, restore-character,
 * discard-character), `discard-item-from-company` was never collected into a
 * lookup map or consulted by `buildItemClick` in company-block.ts, so no
 * item was ever clickable and the player had no way to resolve the pending
 * discard, no matter how long they waited or reloaded.
 *
 * Uses the same hand-rolled DOM stub as store-item-click-confirm.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  Company,
  CharacterInPlay,
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  DiscardItemFromCompanyAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';

const { showConfirm } = vi.hoisted(() => ({ showConfirm: vi.fn() }));
vi.mock('./dialog.js', () => ({ showConfirm }));

// Vitest hoists the vi.mock call above to the top of the module (before these
// static imports run), so company-block picks up the mocked showConfirm.
import { renderCompanyBlock } from './company-block.js';
import { getDiscardItemFromCompanyActions } from './company-actions.js';

const pool = loadCardPool();

const ARAGORN = 'tw-8' as CardDefinitionId;
const GLAMDRING = 'tw-181' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const BEARER_INST = 'p1-105' as CardInstanceId;
const ITEM_INST = 'p1-103' as CardInstanceId;

const COMPANY_ID = 'company-p1-0';

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
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
  showConfirm.mockReset();
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const bearer: CharacterInPlay = {
  instanceId: BEARER_INST,
  definitionId: ARAGORN,
  status: CardStatus.Tapped,
  items: [
    { instanceId: ITEM_INST, definitionId: GLAMDRING, status: CardStatus.Untapped },
  ],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 4, body: 7, directInfluence: 0, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const company = {
  id: COMPANY_ID,
  characters: [BEARER_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const discardGlamdring: DiscardItemFromCompanyAction = {
  type: 'discard-item-from-company',
  player: PLAYER,
  itemInstanceId: ITEM_INST,
};

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [BEARER_INST as string]: bearer },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'movement-hazard' },
    legalActions,
  } as unknown as PlayerView;
}

const findItemImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (ITEM_INST as string));

describe('a Brigands-style forced item discard (discard-item-from-company pending resolution)', () => {
  test('the item is clickable and asks for confirmation before dispatching the discard', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(true);
    const view = boardView([discardGlamdring]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      discardItemFromCompanyActions: getDiscardItemFromCompanyActions(view),
    }) as unknown as StubEl;

    const img = findItemImg(block);
    expect(img).toBeDefined();

    img!.click();

    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();

    await Promise.resolve(); // flush the mocked showConfirm promise
    expect(onAction).toHaveBeenCalledWith(discardGlamdring);
  });

  test('declining the confirmation does not dispatch the discard action', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(false);
    const view = boardView([discardGlamdring]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      discardItemFromCompanyActions: getDiscardItemFromCompanyActions(view),
    }) as unknown as StubEl;

    const img = findItemImg(block);
    img!.click();

    await Promise.resolve();
    expect(onAction).not.toHaveBeenCalled();
  });
});
