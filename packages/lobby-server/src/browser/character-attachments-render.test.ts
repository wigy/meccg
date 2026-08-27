/**
 * @module character-attachments-render.test
 *
 * Regression test for the "support/resource event hanging in a corner"
 * report: a permanent/short-event card attached to a character
 * (`CardInPlay.attachedTo`, e.g. a corruption card, or *Flee from Strike*
 * once it stays in play on the fleeing character) rendered in the flat,
 * absolutely-positioned cards-in-play row instead of inline with its bearer —
 * `renderCardsInPlayRow` only ever excluded cards bound to a present site
 * (`attachedToSite`) or company (`companyId`), never one bound to a character.
 *
 * The partition now mirrors the company- and site-attachments ones:
 * `renderCompanyBlock` collects `attachedTo`-bound cards per character and
 * `renderCharacterColumn` renders them inline in `.character-attachments`
 * alongside items/allies/hazards, while `renderCardsInPlayRow` excludes them
 * from the flat row (falling back to it only when the target character is not
 * in play, so a card is never rendered twice nor dropped entirely).
 *
 * Uses the same hand-rolled DOM stub as company-attachments-render.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, CardStatus, ARAGORN } from '@meccg/shared';
import type { PlayerView, Company, CharacterInPlay, CardDefinitionId, CardInstanceId } from '@meccg/shared';
import { renderCompanyBlock, renderCardsInPlayRow } from './company-block.js';

const pool = loadCardPool();

const GOING_EVER_UNDER_DARK = 'ba-37' as CardDefinitionId; // stands in for a character-attached permanent event
const DARK_TRYST = 'as-80' as CardDefinitionId;            // a general permanent, unrelated to any character

const COMPANY_ID = 'company-p1-0';
const HOST_CHAR_INST = 'p1-1' as CardInstanceId;
const ATTACHED_INST = 'p1-26' as CardInstanceId;  // attached to the host character
const GENERAL_INST = 'p1-40' as CardInstanceId;   // not attached to anything

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

const characters: Record<string, CharacterInPlay> = {
  [HOST_CHAR_INST as string]: {
    instanceId: HOST_CHAR_INST,
    definitionId: ARAGORN,
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    effectiveStats: { prowess: 6, body: 8, directInfluence: 0, corruptionPoints: 0 },
  } as unknown as CharacterInPlay,
};

/** A company with one character, no site — only the fields the renderers read. */
const company = {
  id: COMPANY_ID,
  characters: [HOST_CHAR_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

/** Build a PlayerView with a character-attached card and an unrelated one. */
function boardView(opts?: { characters?: Record<string, CharacterInPlay> }): PlayerView {
  const chars = opts?.characters ?? characters;
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: chars,
      cardsInPlay: [
        { instanceId: ATTACHED_INST, definitionId: GOING_EVER_UNDER_DARK, status: CardStatus.Untapped, attachedTo: HOST_CHAR_INST },
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

describe('character-attached permanent/short events render with their bearer', () => {
  test('the character column shows the attached card inline in .character-attachments', () => {
    const block = renderCompanyBlock(company, characters, boardView(), pool, 'self') as unknown as StubEl;

    const strip = block.all().find(e => e.className === 'character-attachments');
    expect(strip).toBeDefined();
    expect(renderedInstanceIds(strip!)).toContain(ATTACHED_INST as string);
    // The general (unattached) permanent does not creep into the character column.
    expect(renderedInstanceIds(block)).not.toContain(GENERAL_INST as string);
  });

  test('the flat cards-in-play row excludes the attached card but keeps general ones', () => {
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, boardView(), pool);

    const ids = renderedInstanceIds(container);
    expect(ids).toContain(GENERAL_INST as string);
    expect(ids).not.toContain(ATTACHED_INST as string);
  });

  test('a card attached to a character not in play falls back to the flat row', () => {
    const container = new StubEl('div');
    renderCardsInPlayRow(container as unknown as HTMLElement, boardView({ characters: {} }), pool);

    // With no rendered character to host it, the card must not be dropped.
    expect(renderedInstanceIds(container)).toContain(ATTACHED_INST as string);
  });
});
