/**
 * @module store-item-click-confirm.test
 *
 * Regression test for bug report e05a8c55854c7e12 (game msofql34-nfz3ai, seq
 * 774): "there is no pop up do u want to store this item at the haven it
 * just goes once clicked" — storing an item at a haven during the
 * end-of-turn phase committed the `store-item` action the instant the item
 * was clicked, with no way to back out of an accidental click.
 *
 * `buildItemClick` in company-block.ts fired the sole available store action
 * directly, unlike its sibling branches ("only a granted action available"
 * and "only transferring available"), which both already gate on an
 * explicit confirmation. Storing an item removes it from play for the rest
 * of the game and can't be undone, so the item click handler now asks for
 * confirmation first via `showConfirm` whenever the sole available option is
 * a store action, mirroring the self-discard granted-action branch just
 * above it.
 *
 * Uses the same hand-rolled DOM stub as item-discard-cost-granted-action-confirm.test.ts
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
  StoreItemAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';

const { showConfirm } = vi.hoisted(() => ({ showConfirm: vi.fn() }));
vi.mock('./dialog.js', () => ({ showConfirm }));

// Vitest hoists the vi.mock call above to the top of the module (before these
// static imports run), so company-block picks up the mocked showConfirm.
import { renderCompanyBlock } from './company-block.js';
import { getStoreItemActions } from './company-actions.js';

const pool = loadCardPool();

const BOFUR = 'tw-132' as CardDefinitionId;
const SHIELD = 'tw-327' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const BEARER_INST = 'p1-105' as CardInstanceId;
const SHIELD_INST = 'p1-103' as CardInstanceId;

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
  definitionId: BOFUR,
  status: CardStatus.Tapped,
  items: [
    { instanceId: SHIELD_INST, definitionId: SHIELD, status: CardStatus.Untapped },
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

const storeShield: StoreItemAction = {
  type: 'store-item',
  player: PLAYER,
  itemInstanceId: SHIELD_INST,
  characterId: BEARER_INST,
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
    phaseState: { phase: 'end-of-turn' },
    legalActions,
  } as unknown as PlayerView;
}

const findShieldImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (SHIELD_INST as string));

describe('an item whose only available action is storing (Shield of Iron-bound Ash at end of turn)', () => {
  test('clicking the item asks for confirmation before dispatching the store action', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(true);
    const view = boardView([storeShield]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      storeItemActions: getStoreItemActions(view),
    }) as unknown as StubEl;

    const img = findShieldImg(block);
    expect(img).toBeDefined();

    img!.click();

    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();

    await Promise.resolve(); // flush the mocked showConfirm promise
    expect(onAction).toHaveBeenCalledWith(storeShield);
  });

  test('declining the confirmation does not dispatch the store action', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(false);
    const view = boardView([storeShield]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      storeItemActions: getStoreItemActions(view),
    }) as unknown as StubEl;

    const img = findShieldImg(block);
    img!.click();

    await Promise.resolve();
    expect(onAction).not.toHaveBeenCalled();
  });
});
