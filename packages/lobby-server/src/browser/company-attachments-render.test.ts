/**
 * @module company-attachments-render.test
 *
 * Regression test for bug report 6e25583bf69deb74 (game ms1ouxw9-n417mp, seq
 * 58): "We should have structures and placement for company specific cards
 * instead of general in play." A company-targeting permanent event (Going
 * Ever Under Dark ba-37, bound to a company via `CardInPlay.companyId`) was
 * rendered in the flat cards-in-play row instead of inside the block of the
 * company it is bound to.
 *
 * The partition now mirrors the site-attachments one: `renderCompanyBlock`
 * shows company-bound cards in a `company-attachments` strip inside the
 * company block, and `renderCardsInPlayRow` excludes them from the flat row
 * (falling back to the flat row only when the bound company is not on the
 * board, so a card is never rendered twice nor dropped entirely).
 *
 * Uses a tiny hand-rolled DOM stub (the package runs vitest in the default
 * node environment, with no jsdom) — just enough for the renderers' use of
 * `createElement`/`appendChild`/`classList`/`style.setProperty`.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type { PlayerView, Company, CardDefinitionId, CardInstanceId, CompanyId } from '@meccg/shared';
import { renderCompanyBlock, renderCardsInPlayRow } from './company-block.js';

const pool = loadCardPool();

const GOING_EVER_UNDER_DARK = 'ba-37' as CardDefinitionId;
const DARK_TRYST = 'as-80' as CardDefinitionId;

const COMPANY_ID = 'company-p1-0' as CompanyId;
const BOUND_INST = 'p1-26' as CardInstanceId;    // Going Ever Under Dark, bound to the company
const GENERAL_INST = 'p1-40' as CardInstanceId;  // Dark Tryst, a general permanent

// --- Minimal DOM stub -------------------------------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
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
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
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

// --- View fixtures ----------------------------------------------------------

/** A characterless company with no site — only the fields the renderers read. */
const company = {
  id: COMPANY_ID,
  characters: [],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

/** Build a PlayerView holding the two permanents; only rendered fields are set. */
function boardView(opts?: { companies?: Company[] }): PlayerView {
  return {
    self: {
      id: 'p1',
      companies: opts?.companies ?? [company],
      characters: {},
      cardsInPlay: [
        { instanceId: BOUND_INST, definitionId: GOING_EVER_UNDER_DARK, status: CardStatus.Untapped, companyId: COMPANY_ID },
        { instanceId: GENERAL_INST, definitionId: DARK_TRYST, status: CardStatus.Untapped },
      ],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions: [],
  } as unknown as PlayerView;
}

/** Instance IDs of every rendered card image inside an element. */
const renderedInstanceIds = (el: StubEl): string[] =>
  el.all().filter(e => e.tagName === 'img' && e.dataset.instanceId).map(e => e.dataset.instanceId);

// --- Tests ------------------------------------------------------------------

describe('company-bound permanent events render with their company', () => {
  test('the company block shows the bound card in a company-attachments strip', () => {
    const block = renderCompanyBlock(company, {}, boardView(), pool, 'self') as unknown as StubEl;

    const strip = block.all().find(e => e.className === 'company-attachments');
    expect(strip).toBeDefined();
    expect(renderedInstanceIds(strip!)).toContain(BOUND_INST as string);
    // The general (unbound) permanent does not creep into the company block.
    expect(renderedInstanceIds(block)).not.toContain(GENERAL_INST as string);
  });

  test('the flat cards-in-play row excludes the bound card but keeps general ones', () => {
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, boardView(), pool);

    const ids = renderedInstanceIds(container);
    expect(ids).toContain(GENERAL_INST as string);
    expect(ids).not.toContain(BOUND_INST as string);
  });

  test('a card bound to a company not on the board falls back to the flat row', () => {
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, boardView({ companies: [] }), pool);

    // With no rendered company to host it, the card must not be dropped.
    expect(renderedInstanceIds(container)).toContain(BOUND_INST as string);
  });
});
