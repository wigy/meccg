/**
 * @module free-council-company-dim.test
 *
 * Regression test for bug report aaccd8bfa358ffdd (game msdfe1fe-2pnv8f, seq
 * 1360): "During the council, and generally in the all-companies view, we
 * can no longer tell what's happening or who's doing what."
 *
 * `renderCompanyBlock`'s `isInactive` calculation used to unconditionally
 * exclude `Phase.FreeCouncil`, so during Free Council both players'
 * companies always rendered at full brightness regardless of whose
 * corruption-check sub-turn was active. That exception dates back to when
 * `activePlayer` wasn't kept in sync with `phaseState.currentPlayer` as
 * corruption checks switched between players (fixed in
 * reducer-free-council.ts's pass handler) — dimming would have stuck on the
 * first checker. Now that `activePlayer` tracks the current checker
 * correctly, Free Council should dim the same way every other phase does.
 *
 * Uses the same hand-rolled DOM stub as company-attachments-render.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, Company, CompanyId } from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';

const pool = loadCardPool();

const SELF_COMPANY_ID = 'company-p1-1' as CompanyId;
const OPPONENT_COMPANY_ID = 'company-p2-1' as CompanyId;

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style = { setProperty: () => { /* no-op */ } };
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
  get childElementCount(): number { return this.children.length; }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const makeCompany = (id: CompanyId): Company => ({
  id,
  characters: [],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
}) as unknown as Company;

/** Free Council, p1 is currently performing corruption checks (self = p1). */
const view = {
  self: { id: 'p1', companies: [makeCompany(SELF_COMPANY_ID)], characters: {}, cardsInPlay: [] },
  opponent: { id: 'p2', companies: [makeCompany(OPPONENT_COMPANY_ID)], characters: {}, cardsInPlay: [] },
  activePlayer: 'p1',
  phaseState: {
    phase: Phase.FreeCouncil,
    tiebreaker: false,
    step: 'corruption-checks',
    currentPlayer: 'p1',
    checkedCharacters: [],
    firstPlayerDone: true,
    pendingCheck: null,
  },
  legalActions: [],
} as unknown as PlayerView;

describe('Free Council dims the company whose corruption checks are not active', () => {
  test("self's company is not dimmed while self is the current checker", () => {
    const block = renderCompanyBlock(makeCompany(SELF_COMPANY_ID), {}, view, pool, 'self') as unknown as StubEl;
    expect(block.className.split(' ')).not.toContain('company-block--inactive');
  });

  test("opponent's company is dimmed while self is the current checker", () => {
    const block = renderCompanyBlock(makeCompany(OPPONENT_COMPANY_ID), {}, view, pool, 'opponent') as unknown as StubEl;
    expect(block.className.split(' ')).toContain('company-block--inactive');
  });
});
