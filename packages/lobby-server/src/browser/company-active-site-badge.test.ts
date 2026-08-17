/**
 * @module company-active-site-badge.test
 *
 * The single-company view used to mark the active company with the same green
 * glow the all-companies overview uses (`.company-block--active`). At full
 * scale, with only one company on screen and nothing to contrast it against,
 * that border reads as decoration rather than information — and it is ugly.
 *
 * The glow is now suppressed by CSS in `.company-single`, and `renderSiteArea`
 * instead stamps an "Active" badge on the top-left corner of the site the
 * company is heading to: the destination site while moving, the current site
 * otherwise. The badge only renders when the caller asks for it, so the
 * overview grid — where the glow still distinguishes companies from each
 * other — is untouched.
 *
 * Uses the same hand-rolled DOM stub as shared-site-instance-id.test.ts (the
 * package runs vitest in the default node environment, with no jsdom),
 * extended with the `querySelector`/`replaceWith` the badge anchoring needs.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, PlayerView } from '@meccg/shared';
import { renderSiteArea } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const SITE_DEF = 'td-178' as CardDefinitionId; // Isle of the Ulond (has a proxy image)
const CURRENT_INSTANCE = 'p2-69' as CardInstanceId;
const DEST_INSTANCE = 'p2-70' as CardInstanceId;

setCachedInstanceLookup((id: CardInstanceId) =>
  (id === CURRENT_INSTANCE || id === DEST_INSTANCE ? SITE_DEF : undefined));

// --- Minimal DOM stub -------------------------------------------------------

/** Match a `.a.b:not(.c)` style selector against an element's class list. */
function matchesSelector(el: StubEl, selector: string): boolean {
  const excluded = /:not\(\.([\w-]+)\)/.exec(selector)?.[1];
  const required = selector.replace(/:not\([^)]*\)/g, '').split('.').filter(Boolean);
  const own = el.className.split(/\s+/).filter(Boolean);
  if (!required.every(c => own.includes(c))) return false;
  return excluded === undefined || !own.includes(excluded);
}

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  parent: StubEl | null = null;
  className = '';
  alt = '';
  src = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); child.parent = this; return child; }
  addEventListener(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Swap this element for `next` in its parent, as the DOM method does. */
  replaceWith(next: StubEl): void {
    const parent = this.parent;
    if (!parent) return;
    parent.children[parent.children.indexOf(this)] = next;
    next.parent = parent;
    this.parent = null;
  }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
  querySelectorAll(selector: string): StubEl[] {
    return this.all().slice(1).filter(el => matchesSelector(el, selector));
  }
  querySelector(selector: string): StubEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
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

function company(destination: boolean): Company {
  return {
    id: 'company-p1-0',
    characters: [],
    currentSite: { instanceId: CURRENT_INSTANCE, definitionId: SITE_DEF, status: CardStatus.Untapped },
    siteCardOwned: true,
    destinationSite: destination
      ? { instanceId: DEST_INSTANCE, definitionId: SITE_DEF, status: CardStatus.Untapped }
      : null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

/** The badge element rendered into a site area, if any. */
function badge(area: HTMLElement): StubEl | undefined {
  return (area as unknown as StubEl).all().find(el => el.className === 'company-active-badge');
}

/** Instance id of the site card the badge shares a wrapper with. */
function badgedSiteInstanceId(area: HTMLElement): string | undefined {
  return badge(area)?.parent?.children
    .find(el => el.tagName === 'img' && el.className.includes('company-card--site'))
    ?.dataset.instanceId;
}

// --- Tests ------------------------------------------------------------------

describe('active-company badge on the site card', () => {
  test('a stationary active company is badged on its current site', () => {
    const area = renderSiteArea(company(false), view, pool, { activeBadge: true });

    expect(badge(area)?.textContent).toBe('Active');
    expect(badgedSiteInstanceId(area)).toBe(CURRENT_INSTANCE as string);
  });

  test('a moving active company is badged on its destination site, not the one it is leaving', () => {
    const area = renderSiteArea(company(true), view, pool, { activeBadge: true });

    expect(badge(area)?.textContent).toBe('Active');
    expect(badgedSiteInstanceId(area)).toBe(DEST_INSTANCE as string);
  });

  test('no badge without the flag — the overview grid keeps the glow instead', () => {
    expect(badge(renderSiteArea(company(true), view, pool, {}))).toBeUndefined();
  });
});
