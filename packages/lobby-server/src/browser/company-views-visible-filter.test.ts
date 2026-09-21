/**
 * @module company-views-visible-filter.test
 *
 * `renderAllCompaniesView`'s new `visibleCompanyIds` parameter (added for
 * the "roll by company view" feature request): once a corruption-check
 * batch is pending in more than one company at once (CoE 7.1.1's
 * order-choice generalized beyond Ren the Unclean — see `selectableOrder`
 * in types/pending.ts), the "all game view" the client used to force during
 * Free Council is scoped down to just the companies actually relevant to
 * resolving the checks — support can only ever be tapped from a character's
 * own company, so the rest of the board (the other self company, the whole
 * opponent side) is noise.
 *
 * Uses the same hand-rolled DOM stub as opponent-company-focus-click.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the company-views import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { PlayerView, Company, CardInstanceId, CompanyId } from '@meccg/shared';
import { renderAllCompaniesView } from './company-views.js';
import { setLastOnAction, setLastView, setLastCardPool, setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: () => void } = { setProperty: () => { /* no-op */ } };
  onclick: ((e: unknown) => void) | null = null;
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
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
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
});

const selfCompanyA = {
  id: 'company-p1-0' as CompanyId,
  characters: [], currentSite: null, siteCardOwned: true, destinationSite: null,
  movementPath: [], onGuardCards: [], moved: false,
} as unknown as Company;

const selfCompanyB = {
  id: 'company-p1-1' as CompanyId,
  characters: [], currentSite: null, siteCardOwned: true, destinationSite: null,
  movementPath: [], onGuardCards: [], moved: false,
} as unknown as Company;

const opponentCompany = {
  id: 'company-p2-0' as CompanyId,
  characters: [], currentSite: null, siteCardOwned: true, destinationSite: null,
  movementPath: [], onGuardCards: [], moved: false,
} as unknown as Company;

function boardView(): PlayerView {
  return {
    self: { id: 'p1', companies: [selfCompanyA, selfCompanyB], characters: {}, cardsInPlay: [], agents: [] },
    opponent: { id: 'p2', companies: [opponentCompany], characters: {}, cardsInPlay: [], agents: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'free-council', step: 'corruption-checks' },
    legalActions: [],
  } as unknown as PlayerView;
}

describe('renderAllCompaniesView visibleCompanyIds filter', () => {
  test('without a filter, every self and opponent company renders', () => {
    const view = boardView();
    setLastOnAction(vi.fn());
    setLastView(view);
    setLastCardPool(pool);
    setCachedInstanceLookup((id: CardInstanceId) => id as unknown as never);

    const container = new StubEl('div') as unknown as HTMLElement;
    renderAllCompaniesView(container, view, pool);

    const ids = (container as unknown as StubEl).all().map(c => c.dataset.companyId).filter(Boolean);
    expect(new Set(ids)).toEqual(new Set([selfCompanyA.id, selfCompanyB.id, opponentCompany.id]));
  });

  test('with a filter, only the listed companies render — the rest of the board is omitted', () => {
    const view = boardView();
    setLastOnAction(vi.fn());
    setLastView(view);
    setLastCardPool(pool);
    setCachedInstanceLookup((id: CardInstanceId) => id as unknown as never);

    const container = new StubEl('div') as unknown as HTMLElement;
    renderAllCompaniesView(container, view, pool, new Set([selfCompanyA.id]));

    const ids = (container as unknown as StubEl).all().map(c => c.dataset.companyId).filter(Boolean);
    expect(ids).toEqual([selfCompanyA.id]);
  });
});
