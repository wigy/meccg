/**
 * @module item-cp-badge-bearer-conditional.test
 *
 * Regression test for bug report 64e20fa15c5423ce (game msrlpeqo-04zb0j, seq
 * 536, turn 13, organization phase): "Should be giving a dwarf 3 corruption
 * points, not 2" — Durin's Axe (tw-212) on Kíli (tw-167, a Dwarf).
 *
 * Durin's Axe declares a printed 2 corruption points plus a bearer-conditional
 * `stat-modifier` effect (`+1 if held by a Dwarf`, total 3 — confirmed correct
 * on the server side by `tests/cards/tw-212.test.ts`). The item CP badge,
 * however, was computed by `effectiveItemCorruptionPoints`, which only summed
 * the printed value and `in-play-item-modifier` deltas (e.g. Scorba at Home) —
 * it never looked at the item's own bearer-conditional `stat-modifier`
 * effects, so the badge always read the printed 2 regardless of the bearer's
 * race.
 *
 * Uses the hand-rolled DOM stub pattern of `item-cp-badge-in-play-modifier.test.ts`.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  Company,
  CharacterInPlay,
  CardDefinitionId,
  CardInstanceId,
  CompanyId,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';

const pool = loadCardPool();

const KILI = 'tw-167' as CardDefinitionId; // Dwarf
const ARAGORN = 'tw-120' as CardDefinitionId; // Dunadan
const DURINS_AXE = 'tw-212' as CardDefinitionId; // major item, printed 2 CP, +1 if Dwarf bearer

const COMPANY_ID = 'company-p1-0' as CompanyId;
const CHAR_INST = 'p1-100' as CardInstanceId;
const ITEM_INST = 'p1-11' as CardInstanceId;

// --- Minimal DOM stub -------------------------------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style = { setProperty: () => { /* no-op */ }, cursor: '' };
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

const company = {
  id: COMPANY_ID,
  characters: [CHAR_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

/** A board view with the given bearer carrying Durin's Axe. */
function boardView(bearerDefId: CardDefinitionId): { view: PlayerView; bearer: CharacterInPlay } {
  const bearer = {
    instanceId: CHAR_INST,
    definitionId: bearerDefId,
    status: CardStatus.Untapped,
    items: [{ instanceId: ITEM_INST, definitionId: DURINS_AXE, status: CardStatus.Untapped }],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: { prowess: 7, body: 8, directInfluence: 0, corruptionPoints: 0 },
  } as unknown as CharacterInPlay;

  const view = {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [CHAR_INST as string]: bearer },
      cardsInPlay: [],
    },
    opponent: {
      id: 'p2',
      companies: [],
      characters: {},
      cardsInPlay: [],
    },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions: [],
  } as unknown as PlayerView;

  return { view, bearer };
}

/** The text of every item CP badge rendered inside an element. */
const cpBadgeTexts = (el: StubEl): string[] =>
  el.all().filter(e => e.className === 'item-cp-badge').map(e => e.textContent);

// --- Tests ------------------------------------------------------------------

describe("item CP badges include the item's own bearer-conditional bonus", () => {
  test("Durin's Axe reads 3 CP on Kíli, a Dwarf", () => {
    const { view, bearer } = boardView(KILI);
    const block = renderCompanyBlock(company, { [CHAR_INST as string]: bearer }, view, pool, 'self') as unknown as StubEl;

    expect(cpBadgeTexts(block)).toEqual(['3 CP']);
  });

  test("Durin's Axe reads its printed 2 CP on Aragorn, not a Dwarf", () => {
    const { view, bearer } = boardView(ARAGORN);
    const block = renderCompanyBlock(company, { [CHAR_INST as string]: bearer }, view, pool, 'self') as unknown as StubEl;

    expect(cpBadgeTexts(block)).toEqual(['2 CP']);
  });
});
