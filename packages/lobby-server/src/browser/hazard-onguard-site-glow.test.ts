/**
 * @module hazard-onguard-site-glow.test
 *
 * Regression test for the on-guard placement affordance appearing on every
 * rendered site. `place-on-guard` names no target — the engine places the
 * card at the ACTIVE company's site (the company resolving its M/H
 * sub-phase; see `PlaceOnGuardAction` in actions-site.ts) — but
 * `applyHazardOnGuardClick` lit up and wired whatever site card it was
 * handed. With a hazard selected, every rendered site glowed as a target
 * (other opponent companies' sites, hidden destination backs, even the
 * hazard player's own sites), and clicking one of those read as "place it
 * here" while the card actually landed at the active company's site.
 *
 * Uses the DOM stub pattern of `haven-return-site-click.test.ts`.
 */

import './test-dom-bootstrap.js'; // must precede the company-site import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, GameAction, PlayerView } from '@meccg/shared';
import { renderSiteArea } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';
import { setSelectedHazardForPlay, clearHazardPlaySelection } from './render-selection-state.js';

const pool = loadCardPool();

const SITE_DEF = 'tw-430' as CardDefinitionId; // has a proxy image
const ACTIVE_SITE = 'p2-70' as CardInstanceId;
const OTHER_SITE = 'p2-71' as CardInstanceId;
const HAZARD = 'p1-9' as CardInstanceId;

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === ACTIVE_SITE || id === OTHER_SITE) return SITE_DEF;
  return undefined;
});

// --- Minimal DOM stub, mirroring haven-return-site-click.test.ts ------------

class StubEl {
  tagName: string;
  parent: StubEl | null = null;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  classList = {
    add: (...cs: string[]) => { this.className = [this.className, ...cs].filter(Boolean).join(' '); },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
  };
});

afterEach(() => {
  clearHazardPlaySelection();
});

// --- Fixtures ----------------------------------------------------------------

function opponentCompany(id: string, siteInstance: CardInstanceId): Company {
  return {
    id,
    characters: [],
    currentSite: { instanceId: siteInstance, definitionId: SITE_DEF, status: CardStatus.Untapped },
    siteCardOwned: true,
    hasPlannedMovement: false,
    revealedDestinationSite: null,
    onGuardCards: [],
  } as unknown as Company;
}

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: 'p1',
  cardInstanceId: HAZARD,
} as GameAction;

/** Hazard player's view during the opponent's M/H phase, company 0 active. */
function hazardWindowView(active: Company, other: Company): PlayerView {
  return {
    activePlayer: 'p2',
    self: { id: 'p1', companies: [] },
    opponent: { id: 'p2', companies: [active, other] },
    phaseState: { phase: Phase.MovementHazard, step: 'play-hazards', activeCompanyIndex: 0 },
    activeConstraints: [],
    legalActions: [],
  } as unknown as PlayerView;
}

const siteImg = (area: HTMLElement): StubEl | undefined =>
  (area as unknown as StubEl).all().find(el => el.className.includes('company-card--site'));

// --- Tests --------------------------------------------------------------------

describe('with a hazard selected during the opponent movement', () => {
  test('the active company site glows and dispatches the on-guard placement', () => {
    const active = opponentCompany('company-p2-0', ACTIVE_SITE);
    const other = opponentCompany('company-p2-1', OTHER_SITE);
    const view = hazardWindowView(active, other);
    setSelectedHazardForPlay(HAZARD, onGuardAction);

    let sent: unknown = null;
    const area = renderSiteArea(active, view, pool, { onAction: action => { sent = action; } });
    const img = siteImg(area)!;

    expect(img.className).toContain('company-card--influence-target');
    img.click();
    expect(sent).toEqual(onGuardAction);
  });

  test('a non-active company site gets neither glow nor click', () => {
    const active = opponentCompany('company-p2-0', ACTIVE_SITE);
    const other = opponentCompany('company-p2-1', OTHER_SITE);
    const view = hazardWindowView(active, other);
    setSelectedHazardForPlay(HAZARD, onGuardAction);

    let sent: unknown = null;
    const area = renderSiteArea(other, view, pool, { onAction: action => { sent = action; } });
    const img = siteImg(area)!;

    expect(img.className).not.toContain('company-card--influence-target');
    img.click();
    expect(sent).toBeNull();
  });
});
