/**
 * @module shared-site-instance-id.test
 *
 * Regression test for bug report "UI sites" (game mruvf51s-a9ge5j, seq 178):
 * two sibling companies standing at the same location share one physical site
 * card instance (the engine draws a site once from the location deck, so
 * `currentSite.instanceId` is identical across the companies — verified in the
 * game log where companies `company-p2-2` and `company-p2-3` both carry site
 * instance `p2-69`). The all-companies overview rendered both site cards with
 * the same `data-instance-id`, so the FLIP animation — which tracks elements by
 * that id — collapsed them to a single remembered position and the shared site
 * cards "jumped" between company slots on every re-render.
 *
 * `renderSiteArea` now scopes repeat occurrences of a shared site instance by
 * company id: the first company keeps the raw id (its card still slides in from
 * the site deck), later companies get a stable `<companyId>:<instanceId>` id.
 *
 * Uses a tiny hand-rolled DOM stub (the package runs vitest in the default node
 * environment, with no jsdom) — just enough for the `createElement`/`dataset`/
 * `appendChild` the site renderer uses on this path.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, PlayerView } from '@meccg/shared';
import { renderSiteArea, siteElementInstanceId } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const SHARED_SITE_DEF = 'td-178' as CardDefinitionId; // Isle of the Ulond (has a proxy image)
const SHARED_SITE_INSTANCE = 'p2-69' as CardInstanceId;

setCachedInstanceLookup((id: CardInstanceId) =>
  (id === SHARED_SITE_INSTANCE ? SHARED_SITE_DEF : undefined));

// --- Minimal DOM stub -------------------------------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
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

// --- Fixtures ---------------------------------------------------------------

/** Minimal PlayerView — only the fields renderSiteArea reads without an onAction. */
const view = {
  activePlayer: 'p1',
  self: { id: 'p1' },
  phaseState: { phase: Phase.Organization, step: null },
  activeConstraints: [],
  legalActions: [],
} as unknown as PlayerView;

/** A company standing at the shared site, with no planned movement. */
function companyAtSharedSite(id: string): Company {
  return {
    id,
    characters: [],
    currentSite: { instanceId: SHARED_SITE_INSTANCE, definitionId: SHARED_SITE_DEF, status: CardStatus.Untapped },
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

/** Read the site card's data-instance-id out of a rendered site area. */
function siteInstanceId(area: HTMLElement): string | undefined {
  return (area as unknown as StubEl).all()
    .find(el => el.tagName === 'img' && el.className.includes('company-card--site'))
    ?.dataset.instanceId;
}

// --- Tests ------------------------------------------------------------------

describe('sibling companies sharing a site card get distinct FLIP ids', () => {
  test('the second company at the shared site is disambiguated by company id', () => {
    const rendered = new Set<string>();
    const first = renderSiteArea(companyAtSharedSite('company-p2-2'), view, pool, { renderedSiteInstances: rendered });
    const second = renderSiteArea(companyAtSharedSite('company-p2-3'), view, pool, { renderedSiteInstances: rendered });

    // First occurrence keeps the raw instance id (so it can still slide in from
    // the site deck pile); the second is scoped by its company so the two site
    // cards no longer collide.
    expect(siteInstanceId(first)).toBe(SHARED_SITE_INSTANCE as string);
    expect(siteInstanceId(second)).toBe(`company-p2-3:${SHARED_SITE_INSTANCE as string}`);
    expect(siteInstanceId(first)).not.toBe(siteInstanceId(second));
  });

  test('without a shared set (single-company view) the raw id is used', () => {
    const only = renderSiteArea(companyAtSharedSite('company-p2-2'), view, pool, {});
    expect(siteInstanceId(only)).toBe(SHARED_SITE_INSTANCE as string);
  });
});

describe('siteElementInstanceId', () => {
  test('scopes only occurrences after the first for a given instance', () => {
    const rendered = new Set<string>();
    expect(siteElementInstanceId('company-a', SHARED_SITE_INSTANCE, rendered)).toBe(SHARED_SITE_INSTANCE as string);
    expect(siteElementInstanceId('company-b', SHARED_SITE_INSTANCE, rendered)).toBe(`company-b:${SHARED_SITE_INSTANCE as string}`);
  });
});
