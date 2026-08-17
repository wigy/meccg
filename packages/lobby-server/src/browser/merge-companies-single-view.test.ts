/**
 * @module merge-companies-single-view.test
 *
 * Regression test for bug report 2543be41df2580b9 (game mshkjqbp-4pszaj,
 * seq 1659): "Can not move him to Gandalf's company [...] clicking on
 * Beregond doesnt give me any option at all."
 *
 * Beregond sat alone in his own company while Gandalf's company was at the
 * same site — a legal `merge-companies` action existed to fold Beregond's
 * company into Gandalf's. `renderAllCompaniesView` wires `mergeActions` into
 * every rendered `renderCompanyBlock` call, but `renderSingleView` — the
 * focused single-company view shown by default — never did. So when the
 * player was focused on Beregond's own (solo) company rather than the
 * all-companies overview, `getMergeActionsForChar` always saw `undefined`
 * and no click handler was attached at all: clicking Beregond did nothing.
 *
 * Uses the same hand-rolled DOM stub as company-attachments-render.test.ts
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
  MergeCompaniesAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderSingleView } from './company-views.js';
import { resetState, setFocusedCompanyId, setLastOnAction, setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const BEREGOND = 'tw-127' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const BEREGOND_INST = 'p1-4' as CardInstanceId;
const GANDALF_INST = 'p1-1' as CardInstanceId;

const BEREGOND_COMPANY_ID = 'company-p1-5';
const GANDALF_COMPANY_ID = 'company-p1-0';

// --- Minimal DOM stub (same as character-self-granted-action-click.test.ts) -

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
  parent: StubEl | null = null;
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); child.parent = this; return child; }
  /** Swap this element for `next` in its parent, as the DOM method does. */
  replaceWith(next: StubEl): void {
    const parent = this.parent;
    if (!parent) return;
    parent.children[parent.children.indexOf(this)] = next;
    next.parent = parent;
    this.parent = null;
  }
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
  /** Match a `.a.b:not(.c)` style selector — enough for the site-badge anchoring. */
  querySelectorAll(selector: string): StubEl[] {
    const excluded = /:not\(\.([\w-]+)\)/.exec(selector)?.[1];
    const required = selector.replace(/:not\([^)]*\)/g, '').split('.').filter(Boolean);
    return this.all().slice(1).filter(el => {
      const own = el.className.split(/\s+/).filter(Boolean);
      return required.every(c => own.includes(c)) && (excluded === undefined || !own.includes(excluded));
    });
  }
  querySelector(selector: string): StubEl | null { return this.querySelectorAll(selector)[0] ?? null; }
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
  resetState();
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  resetState();
});

const beregond: CharacterInPlay = {
  instanceId: BEREGOND_INST,
  definitionId: BEREGOND,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 4, body: 8, directInfluence: 0, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const gandalf: CharacterInPlay = {
  instanceId: GANDALF_INST,
  definitionId: GANDALF,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 6, body: 9, directInfluence: 3, corruptionPoints: 1 },
} as unknown as CharacterInPlay;

const beregondCompany = {
  id: BEREGOND_COMPANY_ID,
  characters: [BEREGOND_INST],
  currentSite: { instanceId: 'p1-68', definitionId: 'wh-58', status: 'untapped' },
  siteCardOwned: false,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const gandalfCompany = {
  id: GANDALF_COMPANY_ID,
  characters: [GANDALF_INST],
  currentSite: { instanceId: 'p1-68', definitionId: 'wh-58', status: 'untapped' },
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const mergeIntoGandalf: MergeCompaniesAction = {
  type: 'merge-companies',
  player: PLAYER,
  sourceCompanyId: BEREGOND_COMPANY_ID,
  targetCompanyId: GANDALF_COMPANY_ID,
} as unknown as MergeCompaniesAction;

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [beregondCompany, gandalfCompany],
      characters: { [BEREGOND_INST as string]: beregond, [GANDALF_INST as string]: gandalf },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions,
  } as unknown as PlayerView;
}

const findCharImg = (root: StubEl, instanceId: CardInstanceId): StubEl | undefined =>
  root.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (instanceId as string));

describe('clicking a solo character with a single merge-companies target, focused single-company view', () => {
  test('fires the merge action immediately instead of doing nothing', () => {
    const onAction = vi.fn();
    const view = boardView([mergeIntoGandalf]);

    setLastOnAction(onAction);
    setCachedInstanceLookup((id: CardInstanceId) => {
      if (id === BEREGOND_INST) return BEREGOND;
      if (id === GANDALF_INST) return GANDALF;
      return undefined;
    });
    setFocusedCompanyId(BEREGOND_COMPANY_ID as never);

    const container = new StubEl('div') as unknown as HTMLElement;
    renderSingleView(container, view, pool);

    const img = findCharImg(container as unknown as StubEl, BEREGOND_INST);
    expect(img).toBeDefined();

    img!.click();

    expect(onAction).toHaveBeenCalledWith(mergeIntoGandalf);
  });
});
