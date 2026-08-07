/**
 * @module opponent-company-focus-click.test
 *
 * Regression test for bug report 39c08002a46d7ea0 (game mshkjqbp-4pszaj, seq
 * 271): "The recent update now gives me the arrows, but i cant move to the
 * opponents party. I am now in the play hazards stage."
 *
 * During the opponent's movement/hazard phase the hazard player is forced
 * into the all-companies overview (`shouldOverrideToAllCompanies`). Clicking
 * a self company there focuses it into single-company view — but the
 * opponent-company loop in `renderAllCompaniesView` only ever wired
 * click handlers onto individual highlighted cards (for targeting), never a
 * default handler on the company block itself. So once nav arrows only
 * cycled within the focused side's own companies (fixed separately in
 * `getCycleCompanies`), there was no way left to bring an opponent company
 * into single view at all if focus had landed elsewhere first.
 */

import './test-dom-bootstrap.js'; // must precede the company-views import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, Company, CardInstanceId, EvaluatedAction, GameAction } from '@meccg/shared';
import { renderAllCompaniesView } from './company-views.js';
import {
  setLastOnAction, setLastCardPool, setLastView, setCachedInstanceLookup,
  getFocusedCompanyId, getAllCompaniesOverride, setFocusedCompanyId, setAllCompaniesOverride,
} from './company-view-state.js';

const pool = loadCardPool();

const OPPONENT_COMPANY_ID = 'company-p2-0';

// --- Minimal DOM stub (same shape as opponent-hazard-target-click.test.ts) ---

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: () => void } = { setProperty: () => { /* no-op */ } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  onclick: ((e: unknown) => void) | null = null;
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
    const evt = { stopPropagation: () => { /* no-op */ }, currentTarget: this, target: this };
    for (const h of this.listeners.click ?? []) h(evt);
    this.onclick?.(evt);
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
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
});

afterEach(() => {
  setLastOnAction(null);
  setLastView(null);
  setLastCardPool(null);
  setFocusedCompanyId(null);
  setAllCompaniesOverride(false);
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
});

const selfCompany = {
  id: 'company-p1-0',
  characters: [],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const opponentCompany = {
  id: OPPONENT_COMPANY_ID,
  characters: [],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: { id: 'p1', companies: [selfCompany], characters: {}, cardsInPlay: [], agents: [] },
    opponent: { id: 'p2', companies: [opponentCompany], characters: {}, cardsInPlay: [], agents: [] },
    activePlayer: 'p2',
    phaseState: { phase: 'movement-hazard', step: null },
    legalActions,
  } as unknown as PlayerView;
}

describe('clicking an opponent company in the all-companies overview', () => {
  test('focuses it into single-company view, mirroring self-company clicks', () => {
    const onAction = vi.fn();
    const view = boardView([]);
    setLastOnAction(onAction);
    setLastView(view);
    setLastCardPool(pool);
    setCachedInstanceLookup((id: CardInstanceId) => id as unknown as never);

    // Focus is on our own company already (as it would be after clicking it
    // in the forced overview) — this reproduces the reporter being stuck
    // unable to reach the opponent's side.
    setFocusedCompanyId(selfCompany.id);
    setAllCompaniesOverride(true);

    const container = new StubEl('div') as unknown as HTMLElement;
    renderAllCompaniesView(container, view, pool);

    const opponentBlock = (container as unknown as StubEl).all().find(
      c => c.dataset.companyId === OPPONENT_COMPANY_ID,
    );
    expect(opponentBlock).toBeDefined();
    expect(opponentBlock!.classList.contains('company-block--clickable')).toBe(true);

    opponentBlock!.click();

    expect(getFocusedCompanyId()).toBe(OPPONENT_COMPANY_ID);
    expect(getAllCompaniesOverride()).toBe(false);
  });
});
