/**
 * @module chambers-site-target-live-focus.test
 *
 * Regression test for bug report 82494cdd1062223c (game mshkjqbp-4pszaj, seq
 * 427): "I move to my Gandalf view (with a No Stranger) to play Chambers.
 * But it adds it to Beorn's House." Chambers in the Royal Court (wh-97) has
 * one `play-permanent-event` action per hero Free-hold site in play, and
 * `findCardAction` defaults the target to the player's focused company's
 * site (fixed for bug 438d0869daf6313a). But switching the focused company
 * via the board's nav arrows only re-renders the company view, not the
 * hand — so a hand card's click handler, bound at the last hand render,
 * kept firing against whichever company was focused back then. The player
 * navigated to Gandalf's company (a different site) after the hand last
 * rendered, then clicked Chambers, and it landed on the stale, no-longer-
 * focused site.
 *
 * The click handler must re-resolve the target from the live focused
 * company at click time, not the one captured when the hand was rendered.
 *
 * Uses the hand-rolled DOM stub pattern of discard-confirmation.test.ts (the
 * package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, CompanyId, GameAction } from '@meccg/shared';
import { renderHand } from './render-hand.js';
import { setFocusedCompanyId, resetState } from './company-view-state.js';

const pool = loadCardPool();

const CHAMBERS = 'wh-97' as CardDefinitionId;
const CHAMBERS_INSTANCE = 'p1-12' as CardInstanceId;

const BEORNS_HOUSE = 'tw-376' as CardDefinitionId; // company-p1-0's site (first in the list)
const EAGLES_EYRIE = 'tw-391' as CardDefinitionId; // company-p1-2's site (Gandalf's company)

const COMPANY_BEORNS_HOUSE = 'company-p1-0' as CompanyId;
const COMPANY_EAGLES_EYRIE = 'company-p1-2' as CompanyId;

const playAtBeornsHouse: GameAction = {
  type: 'play-permanent-event',
  player: 'p1',
  cardInstanceId: CHAMBERS_INSTANCE,
  targetSiteDefinitionId: BEORNS_HOUSE,
} as GameAction;

const playAtEaglesEyrie: GameAction = {
  type: 'play-permanent-event',
  player: 'p1',
  cardInstanceId: CHAMBERS_INSTANCE,
  targetSiteDefinitionId: EAGLES_EYRIE,
} as GameAction;

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  title = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty: () => { /* no-op */ } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  remove(): void { /* no-op */ }
  dispatch(type: string, event: unknown = { clientX: 0, clientY: 0, stopPropagation() { /* no-op */ } }): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let handArc: StubEl;
let body: StubEl;

beforeEach(() => {
  handArc = new StubEl('div');
  body = new StubEl('body');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id === 'hand-arc' ? handArc : null),
    querySelector: () => null,
    body,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  resetState();
});

/** A view with two companies at different Free-hold sites, both able to host Chambers. */
function chambersView(): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  return {
    self: {
      ...emptySide,
      id: 'p1',
      hand: [{ instanceId: CHAMBERS_INSTANCE, definitionId: CHAMBERS }],
      companies: [
        {
          id: 'company-p1-0',
          currentSite: { instanceId: 'p1-74', definitionId: BEORNS_HOUSE },
          destinationSite: null,
          onGuardCards: [],
        },
        {
          id: 'company-p1-2',
          currentSite: { instanceId: 'p1-71', definitionId: EAGLES_EYRIE },
          destinationSite: null,
          onGuardCards: [],
        },
      ],
    },
    opponent: { ...emptySide, id: 'p2' },
    activePlayer: 'p1',
    phaseState: { phase: Phase.Organization, step: null },
    legalActions: [
      { action: playAtBeornsHouse, viable: true },
      { action: playAtEaglesEyrie, viable: true },
    ],
  } as unknown as PlayerView;
}

describe('Chambers site target follows the live focused company, not the stale render', () => {
  test('clicking after navigating to a different company targets the newly-focused site', () => {
    setFocusedCompanyId(COMPANY_BEORNS_HOUSE); // hand renders with Beorn's House focused
    let sent: GameAction | null = null;
    renderHand(chambersView(), pool, action => { sent = action; });

    // Player navigates to Gandalf's company — only the company view re-renders,
    // the hand (and its bound click handlers) does not.
    setFocusedCompanyId(COMPANY_EAGLES_EYRIE);

    const img = handArc.children[0].children[0];
    img.dispatch('click');

    expect(sent).toEqual(playAtEaglesEyrie);
  });

  test('clicking without navigating away still targets the originally-focused site', () => {
    setFocusedCompanyId(COMPANY_BEORNS_HOUSE);
    let sent: GameAction | null = null;
    renderHand(chambersView(), pool, action => { sent = action; });

    const img = handArc.children[0].children[0];
    img.dispatch('click');

    expect(sent).toEqual(playAtBeornsHouse);
  });
});
