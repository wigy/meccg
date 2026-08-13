/**
 * @module company-hazard-limit-badge.test
 *
 * Regression test for the feature request "Stop the view jumping back to
 * overview" (forwarded via admin): from the all-companies overview, nothing
 * distinguished "this party is done taking hazards" from "this party still
 * has hazard limit left" — the `#opponent-hazard-limit` chip is unconditionally
 * hidden by the `.all-companies-mode` CSS class, and clicking Pass looked
 * harmless while it actually ended hazard opportunities against the active
 * company.
 *
 * `renderCompanyBlock` now renders a remaining-hazard-limit badge on the
 * active company's block during the `play-hazards` step, mirroring the
 * existing "moved" checkmark badge, so the count is visible directly in the
 * grid regardless of view mode.
 *
 * Uses the same hand-rolled DOM stub as site-phase-active-company-dim.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, Company, CompanyId } from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';

const pool = loadCardPool();

const ACTIVE_COMPANY_ID = 'company-p2-0' as CompanyId;
const OTHER_COMPANY_ID = 'company-p2-1' as CompanyId;

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

/** Opponent's turn (self = p1, active player = p2), Movement/Hazard, play-hazards step. */
const view = {
  self: { id: 'p1', companies: [], cardsInPlay: [] },
  opponent: {
    id: 'p2',
    companies: [makeCompany(ACTIVE_COMPANY_ID), makeCompany(OTHER_COMPANY_ID)],
    cardsInPlay: [],
  },
  activePlayer: 'p2',
  activeConstraints: [],
  phaseState: {
    phase: Phase.MovementHazard,
    step: 'play-hazards',
    activeCompanyIndex: 0,
    hazardLimitAtReveal: 4,
    preRevealHazardLimitConstraintIds: [],
    hazardsPlayedThisCompany: 1,
  },
  legalActions: [],
} as unknown as PlayerView;

/** Find a rendered badge span by class among a block's children (searches the name element). */
function findBadge(block: StubEl, className: string): StubEl | undefined {
  for (const child of block.children) {
    if (child.className === className) return child;
    const nested = child.children.find(c => c.className === className);
    if (nested) return nested;
  }
  return undefined;
}

describe('play-hazards step shows a remaining hazard-limit badge on the active company', () => {
  test('the company at activeCompanyIndex gets an "HL N" badge', () => {
    const block = renderCompanyBlock(makeCompany(ACTIVE_COMPANY_ID), {}, view, pool, 'opponent') as unknown as StubEl;
    const badge = findBadge(block, 'company-hazard-limit-badge');
    expect(badge).toBeDefined();
    expect(badge!.textContent).toBe('HL 3');
  });

  test('a sibling company not at activeCompanyIndex gets no badge', () => {
    const block = renderCompanyBlock(makeCompany(OTHER_COMPANY_ID), {}, view, pool, 'opponent') as unknown as StubEl;
    expect(findBadge(block, 'company-hazard-limit-badge')).toBeUndefined();
  });

  test('no badge outside the play-hazards step', () => {
    const drawStepView = {
      ...view,
      phaseState: { ...view.phaseState, step: 'draw-cards' },
    } as unknown as PlayerView;
    const block = renderCompanyBlock(makeCompany(ACTIVE_COMPANY_ID), {}, drawStepView, pool, 'opponent') as unknown as StubEl;
    expect(findBadge(block, 'company-hazard-limit-badge')).toBeUndefined();
  });
});
