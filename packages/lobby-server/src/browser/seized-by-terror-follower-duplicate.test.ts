/**
 * @module seized-by-terror-follower-duplicate.test
 *
 * Regression test for bug report 97c002cc69a61328 (game msewu2v3-p8eovx, seq
 * 787): "Seized by Terror sent Arwen back to Buhr Widu, but the game
 * duplicated Arwen, so that one Arwen continued with the company to Lorien
 * and one returned to Buhr Widu."
 *
 * The engine handled the split correctly — Arwen (p1-100) was removed from
 * Gandalf's company (`company.characters`) and placed alone in a new company
 * at the site of origin. But Seized by Terror only touches company
 * membership; per CoE 2.II.2.2, direct-influence control (`controlledBy` /
 * `followers`) is independent of physical company location, so Arwen
 * correctly remained a follower under Gandalf's direct influence.
 *
 * `renderCompanyBlock` nests every ID in a character's `followers` list
 * under that character's column regardless of whether the follower is still
 * physically present in the same company. Since Arwen was still listed in
 * Gandalf's `followers`, she rendered nested under Gandalf in his company
 * (traveling to Lórien) *and* as her own title character in her new solo
 * company (back at Buhr Widu) — the same character instance drawn twice.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type { PlayerView, Company, CharacterInPlay, CardDefinitionId, CardInstanceId, CompanyId } from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';

const pool = loadCardPool();

const GANDALF = 'tw-156' as CardDefinitionId;
const ARWEN = 'tw-122' as CardDefinitionId;

const GANDALF_INST = 'p1-2' as CardInstanceId;
const ARWEN_INST = 'p1-100' as CardInstanceId;

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

const gandalf = {
  instanceId: GANDALF_INST,
  definitionId: GANDALF,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [ARWEN_INST], // stale — Arwen split off physically but stays under direct influence
  controlledBy: 'general',
  effectiveStats: { prowess: 8, body: 9, directInfluence: 10, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const arwen = {
  instanceId: ARWEN_INST,
  definitionId: ARWEN,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: GANDALF_INST,
  effectiveStats: { prowess: 2, body: 8, directInfluence: 0, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const charMap: Record<string, CharacterInPlay> = { [GANDALF_INST as string]: gandalf, [ARWEN_INST as string]: arwen };

const gandalfCompany = {
  id: 'company-p1-1' as CompanyId,
  characters: [GANDALF_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const arwenCompany = {
  id: 'company-p1-2' as CompanyId,
  characters: [ARWEN_INST],
  currentSite: null,
  siteCardOwned: false,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

function boardView(): PlayerView {
  return {
    self: { id: 'p1', companies: [gandalfCompany, arwenCompany], characters: charMap, cardsInPlay: [] },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions: [],
  } as unknown as PlayerView;
}

const renderedInstanceIds = (el: StubEl): string[] =>
  el.all().filter(e => e.tagName === 'img' && e.dataset.instanceId).map(e => e.dataset.instanceId);

// --- Tests --------------------------------------------------------------------

describe('a follower split into a new company does not render twice', () => {
  test("Arwen does not render nested under Gandalf once she is physically in her own company", () => {
    const block = renderCompanyBlock(gandalfCompany, charMap, boardView(), pool, 'self') as unknown as StubEl;

    expect(renderedInstanceIds(block)).toContain(GANDALF_INST as string);
    expect(renderedInstanceIds(block)).not.toContain(ARWEN_INST as string);
  });

  test('Arwen still renders as the title character of her own solo company', () => {
    const block = renderCompanyBlock(arwenCompany, charMap, boardView(), pool, 'self') as unknown as StubEl;

    expect(renderedInstanceIds(block)).toContain(ARWEN_INST as string);
  });
});
