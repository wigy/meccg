/**
 * @module follower-title-character-duplicate.test
 *
 * Regression test for the company block rendering a follower twice when the
 * follower wins the title-character tie-break. `getTitleCharacter` picks by
 * (avatar, mind, MP, prowess, name) over ALL company members, followers
 * included, while the render loop skips followers because they draw nested
 * under their controller's column. Nothing removed a follower-title-character
 * from its controller's rendered followers, so it drew twice: once as the
 * leftmost title column and once nested under its controller — the same
 * `data-instance-id` clickable in two places, also corrupting FLIP-animation
 * identity.
 *
 * Reachable with plain cards: Halbarad (tw-162, mind 1, prowess 0, DI 1)
 * legally controls Dori (tw-141, mind 1, prowess 3) — mind ties, MP ties at
 * 0, Dori wins on prowess. In an avatar-less company of the two, Dori was
 * picked as title character while also rendering as Halbarad's follower.
 * The title character is now picked among standalone (non-follower)
 * characters only.
 *
 * Uses the DOM stub pattern of `seized-by-terror-follower-duplicate.test.ts`.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type { PlayerView, Company, CharacterInPlay, CardDefinitionId, CardInstanceId, CompanyId } from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';

const pool = loadCardPool();

const HALBARAD = 'tw-162' as CardDefinitionId;
const DORI = 'tw-141' as CardDefinitionId;

const HALBARAD_INST = 'p1-10' as CardInstanceId;
const DORI_INST = 'p1-11' as CardInstanceId;

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

// --- Fixtures ----------------------------------------------------------------

const halbarad = {
  instanceId: HALBARAD_INST,
  definitionId: HALBARAD,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [DORI_INST],
  controlledBy: 'general',
  effectiveStats: { prowess: 0, body: 5, directInfluence: 1, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const dori = {
  instanceId: DORI_INST,
  definitionId: DORI,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: HALBARAD_INST,
  effectiveStats: { prowess: 3, body: 6, directInfluence: 0, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const charMap: Record<string, CharacterInPlay> = {
  [HALBARAD_INST as string]: halbarad,
  [DORI_INST as string]: dori,
};

const company = {
  id: 'company-p1-1' as CompanyId,
  characters: [HALBARAD_INST, DORI_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

function boardView(): PlayerView {
  return {
    self: { id: 'p1', companies: [company], characters: charMap, cardsInPlay: [] },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions: [],
  } as unknown as PlayerView;
}

const renderedInstanceIds = (el: StubEl): string[] =>
  el.all().filter(e => e.tagName === 'img' && e.dataset.instanceId).map(e => e.dataset.instanceId);

// --- Tests --------------------------------------------------------------------

describe('a follower who wins the title-character tie-break', () => {
  test('renders exactly once, nested under her controller', () => {
    const block = renderCompanyBlock(company, charMap, boardView(), pool, 'self') as unknown as StubEl;

    const ids = renderedInstanceIds(block);
    expect(ids.filter(id => id === (DORI_INST as string))).toHaveLength(1);
    expect(ids.filter(id => id === (HALBARAD_INST as string))).toHaveLength(1);
  });
});
