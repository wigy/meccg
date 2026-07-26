/**
 * @module item-cp-badge-in-play-modifier.test
 *
 * Regression test for bug report 71eb00f6fd040640 (game ms1vaegk-e4fvuf, seq
 * 320): "Glamdring has 2 CP, UI shows 1 CP for glamdring."
 *
 * *Scorba at Home* (td-65) — "each major item gives an additional corruption
 * point" — was in play, so the engine charged Théoden 2 corruption points for
 * *Glamdring* (tw-244, printed 1 CP) when *Corpse-candle* forced a corruption
 * check. The company block, however, painted the item's CP badge straight from
 * the card definition, so the board still read "1 CP" and the check's total
 * looked wrong.
 *
 * The badge now uses `effectiveItemCorruptionPoints`, the same per-item
 * arithmetic the engine's recompute applies, over both players' cards in play.
 *
 * Uses the hand-rolled DOM stub pattern of `company-attachments-render.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
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

const THEODEN = 'tw-182' as CardDefinitionId;
const GLAMDRING = 'tw-244' as CardDefinitionId;   // major item, printed 1 CP
const SCORBA_AT_HOME = 'td-65' as CardDefinitionId; // +1 CP to each major item

const COMPANY_ID = 'company-p1-0' as CompanyId;
const CHAR_INST = 'p1-108' as CardInstanceId;
const ITEM_INST = 'p1-3' as CardInstanceId;
const SCORBA_INST = 'p2-176' as CardInstanceId;

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

/** Théoden bearing Glamdring; only the fields the renderers read are set. */
const theoden = {
  instanceId: CHAR_INST,
  definitionId: THEODEN,
  status: CardStatus.Untapped,
  items: [{ instanceId: ITEM_INST, definitionId: GLAMDRING, status: CardStatus.Untapped }],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 8, body: 6, directInfluence: 3, corruptionPoints: 1 },
} as unknown as CharacterInPlay;

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

/** A board view, optionally with the opponent's Scorba at Home in play. */
function boardView(scorbaInPlay: boolean): PlayerView {
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [CHAR_INST as string]: theoden },
      cardsInPlay: [],
    },
    opponent: {
      id: 'p2',
      companies: [],
      characters: {},
      cardsInPlay: scorbaInPlay
        ? [{ instanceId: SCORBA_INST, definitionId: SCORBA_AT_HOME, status: CardStatus.Untapped }]
        : [],
    },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions: [],
  } as unknown as PlayerView;
}

/** The text of every item CP badge rendered inside an element. */
const cpBadgeTexts = (el: StubEl): string[] =>
  el.all().filter(e => e.className === 'item-cp-badge').map(e => e.textContent);

// --- Tests ------------------------------------------------------------------

describe('item CP badges include in-play item modifiers', () => {
  test('Glamdring reads 2 CP while Scorba at Home is in play', () => {
    const block = renderCompanyBlock(company, { [CHAR_INST as string]: theoden }, boardView(true), pool, 'self') as unknown as StubEl;

    expect(cpBadgeTexts(block)).toEqual(['2 CP']);
  });

  test('Glamdring reads its printed 1 CP with no modifier in play', () => {
    const block = renderCompanyBlock(company, { [CHAR_INST as string]: theoden }, boardView(false), pool, 'self') as unknown as StubEl;

    expect(cpBadgeTexts(block)).toEqual(['1 CP']);
  });
});
