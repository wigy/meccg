/**
 * @module company-single-view-shrink-to-fit.test
 *
 * Regression test for bug report a93ee82af9b44aba (game mt1j9m0i-5d4lze,
 * turn 8, site phase): "Gloin does not fit on the screen. Must fit whole
 * company in single row."
 *
 * At the reported state, company-p1-0 held 6 characters (Ivic, Beregond,
 * Alatar, Asternak, Glóin, Haldir). `renderAllCompaniesView` shrinks
 * `--company-scale` in a `requestAnimationFrame` loop when the rendered page
 * overflows the viewport, but `renderSingleView` hard-coded the scale to '1'
 * with no such fallback — a company with enough characters to wrap onto an
 * extra row (or run past the bottom of the screen) at full scale stayed that
 * way, pushing later characters like Glóin out of view.
 *
 * Uses the same hand-rolled DOM stub as merge-companies-single-view.test.ts
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
  PlayerId,
} from '@meccg/shared';
import { renderSingleView } from './company-views.js';
import { resetState, setFocusedCompanyId } from './company-view-state.js';

const pool = loadCardPool();

const PLAYER = 'p1' as PlayerId;
const COMPANY_ID = 'company-p1-0';

const CHAR_DEFS = ['dm-17', 'tw-127', 'wh-1', 'le-1', 'tw-160', 'tw-164'] as CardDefinitionId[];
const CHAR_INSTS = CHAR_DEFS.map((_, i) => `p1-${i}` as CardInstanceId);

// --- Minimal DOM stub (same shape as merge-companies-single-view.test.ts) ---

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
  dataset: Record<string, string> = {};
  scrollHeight = 0;
  styleProps: Record<string, string> = {};
  style = { setProperty: (k: string, v: string) => { this.styleProps[k] = v; } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  parent: StubEl | null = null;
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); child.parent = this; return child; }
  addEventListener(_type: string, _handler: (e: unknown) => void): void { /* no-op */ }
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
let documentElementStub: StubEl;

beforeEach(() => {
  bodyStub = new StubEl('body');
  documentElementStub = new StubEl('html');
  // Simulate a page that overflows the viewport at full scale.
  documentElementStub.scrollHeight = 2000;
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    body: bodyStub,
    documentElement: documentElementStub,
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
  // Invoke the callback synchronously so the shrink-to-fit loop runs inline.
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame =
    (cb: () => void) => { cb(); return 0; };
  resetState();
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  resetState();
});

const characters: Record<string, CharacterInPlay> = Object.fromEntries(
  CHAR_INSTS.map((instanceId, i) => [instanceId as string, {
    instanceId,
    definitionId: CHAR_DEFS[i],
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: { prowess: 4, body: 8, directInfluence: 0, corruptionPoints: 0 },
  } as unknown as CharacterInPlay]),
);

const company = {
  id: COMPANY_ID,
  characters: CHAR_INSTS,
  currentSite: { instanceId: 'p1-67', definitionId: 'le-376', status: 'tapped' },
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

function boardView(): PlayerView {
  return {
    self: {
      id: PLAYER,
      companies: [company],
      characters,
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: PLAYER,
    phaseState: { phase: 'site' },
    legalActions: [],
  } as unknown as PlayerView;
}

describe('single-company view with a 6-character company that overflows the viewport', () => {
  test('shrinks --company-scale below 1 instead of leaving the company at fixed full scale', () => {
    setFocusedCompanyId(COMPANY_ID as never);

    const container = new StubEl('div') as unknown as HTMLElement;
    renderSingleView(container, boardView(), pool);

    const single = (container as unknown as StubEl).children.find(c => c.className === 'company-single');
    expect(single).toBeDefined();
    expect(single!.styleProps['--company-scale']).not.toBe('1');
    expect(Number(single!.styleProps['--company-scale'])).toBeLessThan(1);
  });
});
