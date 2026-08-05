/**
 * @module item-discard-cost-granted-action-confirm.test
 *
 * Regression test for bug report 95b2e034703ec1d0 (game msefhs53-znd4eu, seq
 * 124): "Il faut une confirmation avant de la défausser" — Secret Book
 * (as-131) was discarded the instant its `untap-site` granted action was
 * clicked, with no way to back out of an accidental click.
 *
 * `buildItemClick` in company-block.ts committed the sole available granted
 * action directly whenever an item offered only one option (no simultaneous
 * store/transfer choice needing a menu). That shortcut is fine for a
 * tap-only cost (reversible next untap step), but Secret Book's `untap-site`
 * ability pays with `cost: { discard: "self" }` — activating it destroys the
 * card permanently, and a misclick can't be undone. The item click handler
 * now asks for confirmation first via `showConfirm` whenever the sole
 * granted action's cost discards its own source card, mirroring the existing
 * "only transferring available" branch, which already always requires an
 * explicit second click rather than committing on the first.
 *
 * Uses the same hand-rolled DOM stub as character-self-granted-action-click.test.ts
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
  ActivateGrantedAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';

const { showConfirm } = vi.hoisted(() => ({ showConfirm: vi.fn() }));
vi.mock('./dialog.js', () => ({ showConfirm }));

// Vitest hoists the vi.mock call above to the top of the module (before these
// static imports run), so company-block picks up the mocked showConfirm.
import { renderCompanyBlock } from './company-block.js';
import { getGrantedActions } from './company-actions.js';

const pool = loadCardPool();

const ODOACER = 'le-28' as CardDefinitionId;
const SECRET_BOOK = 'as-131' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const BEARER_INST = 'p1-100' as CardInstanceId;
const SECRET_BOOK_INST = 'p1-25' as CardInstanceId;

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
  definitionId: ODOACER,
  status: CardStatus.Untapped,
  items: [
    { instanceId: SECRET_BOOK_INST, definitionId: SECRET_BOOK, status: CardStatus.Untapped },
  ],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 4, body: 6, directInfluence: 0, corruptionPoints: 0 },
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

const untapSite: ActivateGrantedAction = {
  type: 'activate-granted-action',
  player: PLAYER,
  characterId: BEARER_INST,
  sourceCardId: SECRET_BOOK_INST,
  sourceCardDefinitionId: SECRET_BOOK,
  actionId: 'untap-site',
  rollThreshold: 0,
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
    phaseState: { phase: 'organization' },
    legalActions,
  } as unknown as PlayerView;
}

const findSecretBookImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (SECRET_BOOK_INST as string));

describe('an item whose sole granted action discards itself (Secret Book untap-site)', () => {
  test('clicking the item asks for confirmation before dispatching the discard', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(true);
    const view = boardView([untapSite]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      grantedActions: getGrantedActions(view),
    }) as unknown as StubEl;

    const img = findSecretBookImg(block);
    expect(img).toBeDefined();

    img!.click();

    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();

    await Promise.resolve(); // flush the mocked showConfirm promise
    expect(onAction).toHaveBeenCalledWith(untapSite);
  });

  test('declining the confirmation does not dispatch the discard', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(false);
    const view = boardView([untapSite]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      grantedActions: getGrantedActions(view),
    }) as unknown as StubEl;

    const img = findSecretBookImg(block);
    img!.click();

    await Promise.resolve();
    expect(onAction).not.toHaveBeenCalled();
  });
});
