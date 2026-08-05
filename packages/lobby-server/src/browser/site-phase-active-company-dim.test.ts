/**
 * @module site-phase-active-company-dim.test
 *
 * Regression test for bug report c8c96996d8f89a95 (game msemg36i-8u3lp2, seq
 * 272): "The screen is focusing on the wrong company during movement/hazard
 * and site phases of opponent's turn."
 *
 * `renderCompanyBlock` dims every company except the one at
 * `phaseState.activeCompanyIndex` during the Movement/Hazard phase, so the
 * hazard player can tell which of the active player's (possibly several)
 * companies is currently resolving. The Site phase never got the same
 * treatment: the `isInactive` special-case only checked
 * `Phase.MovementHazard`, so during Site phase every company belonging to
 * the active player rendered at full brightness regardless of which one
 * `activeCompanyIndex` actually pointed at.
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

const ACTIVE_COMPANY_ID = 'company-p2-1' as CompanyId;
const OTHER_COMPANY_ID = 'company-p2-4' as CompanyId;

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

/** Opponent's turn (self = p1, active player = p2), Site phase, declare-agent-attack step. */
const view = {
  self: { id: 'p1', companies: [], characters: {}, cardsInPlay: [] },
  opponent: {
    id: 'p2',
    companies: [makeCompany(ACTIVE_COMPANY_ID), makeCompany(OTHER_COMPANY_ID)],
    characters: {},
    cardsInPlay: [],
  },
  activePlayer: 'p2',
  phaseState: {
    phase: Phase.Site,
    step: 'declare-agent-attack',
    activeCompanyIndex: 0,
  },
  legalActions: [],
} as unknown as PlayerView;

describe('Site phase dims every opponent company except the active one', () => {
  test('the company at activeCompanyIndex is not dimmed', () => {
    const block = renderCompanyBlock(makeCompany(ACTIVE_COMPANY_ID), {}, view, pool, 'opponent') as unknown as StubEl;
    expect(block.className.split(' ')).not.toContain('company-block--inactive');
  });

  test('a sibling company not at activeCompanyIndex is dimmed', () => {
    const block = renderCompanyBlock(makeCompany(OTHER_COMPANY_ID), {}, view, pool, 'opponent') as unknown as StubEl;
    expect(block.className.split(' ')).toContain('company-block--inactive');
  });
});
