/**
 * @module map-site-picker.test
 *
 * Tests for the map-based movement destination picker (feature request
 * "Map with regions and sites": pick destinations directly on the map, as on
 * play.meccg.com, instead of scanning the site deck as a card grid).
 *
 * Covers the shared destination collection used by both the grid and the
 * map, the route preview, marker placement with its fallbacks, and the
 * overlay itself: only legal destinations are clickable, a click sends the
 * exact `plan-movement` action and closes the map, Escape / × close it
 * without an action, and "Show as cards" opens the grid.
 *
 * The package runs vitest in the default node environment (no jsdom), so the
 * overlay is exercised against a small hand-rolled DOM stub.
 */

import './test-dom-bootstrap.js'; // must precede the render imports (load-time window access)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, EvaluatedAction, GameAction, PlayerView } from '@meccg/shared';
import { loadCoordinates } from './map-coordinates.js';
import { collectMovementDestinations, clearSelectionState } from './render-piles.js';
import { computeRoutePreview, openMovementMap, placeDestinations } from './map-site-picker.js';

const pool = loadCardPool();

const RIVENDELL = 'tw-421' as CardDefinitionId; // haven, Rhudaur
const BARROW_DOWNS = 'tw-375' as CardDefinitionId; // ruins & lairs, Cardolan, nearest haven Rivendell
const WEATHERTOP = 'tw-436' as CardDefinitionId; // ruins & lairs, Arthedain
const BREE = 'tw-378' as CardDefinitionId; // border-hold, Arthedain
const MORIA = 'tw-413' as CardDefinitionId; // shadow-hold, not offered as a destination here
const HERMITS_HILL = 'dm-32' as CardDefinitionId; // no own coordinates — region centroid fallback
const NO_SUCH_SITE = 'zz-404' as CardDefinitionId; // unknown definition — fallback strip

const COMPANY = 'company-p1-0';
const SIBLING = 'company-p1-1';

// ---- Minimal DOM stub ------------------------------------------------------

type Listener = (e: { target?: unknown; key?: string; stopPropagation(): void }) => void;

class StubClassList {
  constructor(private readonly el: StubEl) {}
  private get set(): Set<string> { return new Set(this.el.className.split(/\s+/).filter(Boolean)); }
  private write(s: Set<string>): void { this.el.className = [...s].join(' '); }
  add(...cs: string[]): void { const s = this.set; for (const c of cs) s.add(c); this.write(s); }
  remove(...cs: string[]): void { const s = this.set; for (const c of cs) s.delete(c); this.write(s); }
  contains(c: string): boolean { return this.set.has(c); }
  toggle(c: string, force?: boolean): void { if (force ?? !this.contains(c)) this.add(c); else this.remove(c); }
}

class StubEl {
  tagName: string;
  className = '';
  id = '';
  textContent = '';
  title = '';
  disabled = false;
  src = '';
  alt = '';
  width = 0;
  height = 0;
  children: StubEl[] = [];
  parent: StubEl | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  classList = new StubClassList(this);
  constructor(tagName: string) { this.tagName = tagName; }
  set innerHTML(_v: string) { this.children = []; }
  appendChild(child: StubEl): StubEl { child.parent = this; this.children.push(child); return child; }
  insertAdjacentElement(_pos: string, el: StubEl): StubEl { return this.parent ? this.parent.appendChild(el) : el; }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(c => c !== this);
    this.parent = null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'class') this.className = value;
  }
  addEventListener(type: string, fn: Listener): void { (this.listeners[type] ??= []).push(fn); }
  fire(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn({ target: this, stopPropagation() { /* no-op */ } });
  }
  querySelectorAll(): StubEl[] { return []; }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
  byClass(cls: string): StubEl[] { return this.all().filter(e => e.classList.contains(cls)); }
}

let body: StubEl;
let docListeners: Record<string, Listener[]>;
let byId: Record<string, StubEl>;

beforeAll(async () => {
  // Serve the real coordinate asset so markers land where they will in the game.
  const json = readFileSync(resolve(__dirname, '../../public/data/site-coordinates.json'), 'utf8');
  (globalThis as unknown as { fetch: unknown }).fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(json) as unknown) });
  await loadCoordinates();
});

beforeEach(() => {
  body = new StubEl('body');
  docListeners = {};
  const modal = new StubEl('div');
  modal.className = 'hidden';
  const dialog = new StubEl('div');
  const titleEl = new StubEl('h3');
  dialog.appendChild(titleEl);
  byId = { 'pile-browser-modal': modal, 'pile-browser-grid': new StubEl('div'), 'pile-browser-title': titleEl };
  (globalThis as unknown as { document: unknown }).document = {
    body,
    createElement: (tag: string) => new StubEl(tag),
    createElementNS: (_ns: string, tag: string) => new StubEl(tag),
    getElementById: (id: string) => byId[id] ?? body.all().find(e => e.id === id) ?? null,
    addEventListener: (type: string, fn: Listener) => { (docListeners[type] ??= []).push(fn); },
    removeEventListener: (type: string, fn: Listener) => { docListeners[type] = (docListeners[type] ?? []).filter(f => f !== fn); },
  };
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
});

afterEach(() => {
  clearSelectionState();
});

// ---- Fixtures --------------------------------------------------------------

function planMovement(destinationSite: string, viable = true, companyId = COMPANY): EvaluatedAction {
  return {
    action: { type: 'plan-movement', player: 'p1', companyId, destinationSite } as unknown as GameAction,
    viable,
    ...(viable ? {} : { reason: 'Too far' }),
  } as EvaluatedAction;
}

function company(id: string, currentSite: { instanceId: string; definitionId: CardDefinitionId } | null, destinationSite: typeof currentSite = null): Company {
  return {
    id,
    characters: [],
    currentSite: currentSite ? { ...currentSite, status: 'untapped' } : null,
    siteCardOwned: true,
    destinationSite: destinationSite ? { ...destinationSite, status: 'untapped' } : null,
    movementPath: [],
    moved: false,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

/**
 * Company at Rivendell; a sibling company is at Weathertop. The site deck
 * holds two Barrow-downs, Bree, Moria, Hermit's Hill and an unknown site.
 */
function buildView(legalActions: EvaluatedAction[]): PlayerView {
  return {
    activePlayer: 'p1',
    self: {
      id: 'p1',
      companies: [
        company(COMPANY, { instanceId: 'p1-site-riv', definitionId: RIVENDELL }),
        company(SIBLING, { instanceId: 'p1-site-wt', definitionId: WEATHERTOP }),
      ],
      characters: {},
      siteDeck: [
        { instanceId: 'p1-s1' as CardInstanceId, definitionId: BARROW_DOWNS },
        { instanceId: 'p1-s2' as CardInstanceId, definitionId: BARROW_DOWNS },
        { instanceId: 'p1-s3' as CardInstanceId, definitionId: BREE },
        { instanceId: 'p1-s4' as CardInstanceId, definitionId: MORIA },
        { instanceId: 'p1-s5' as CardInstanceId, definitionId: HERMITS_HILL },
        { instanceId: 'p1-s6' as CardInstanceId, definitionId: NO_SUCH_SITE },
      ],
    },
    opponent: { id: 'p2', companies: [], characters: {} },
    legalActions,
  } as unknown as PlayerView;
}

const standardActions = (): EvaluatedAction[] => [
  planMovement('p1-s1'),
  planMovement('p1-s2'), // second copy of the Barrow-downs
  planMovement('p1-s3', false), // Bree offered but not viable
  planMovement('p1-site-wt'), // sibling company's in-play site
  planMovement('p1-s5'),
  planMovement('p1-s6'),
  planMovement('p1-s1', true, SIBLING), // another company's action — ignored
];

// ---- collectMovementDestinations ------------------------------------------

describe('collectMovementDestinations', () => {
  test('one entry per destination site, with the matching action', () => {
    const dests = collectMovementDestinations(buildView(standardActions()), COMPANY);
    expect(dests.map(d => d.defId).sort()).toEqual([BARROW_DOWNS, BREE, HERMITS_HILL, WEATHERTOP, NO_SUCH_SITE].sort());
    const barrow = dests.find(d => d.defId === BARROW_DOWNS)!;
    expect(barrow.instanceId).toBe('p1-s1');
    expect(barrow.copies).toBe(2);
    expect(barrow.inPlay).toBe(false);
    expect(dests.find(d => d.defId === MORIA)).toBeUndefined();
  });

  test('includes the sibling company\'s in-play site (rule 2.II.7.2)', () => {
    const wt = collectMovementDestinations(buildView(standardActions()), COMPANY).find(d => d.defId === WEATHERTOP)!;
    expect(wt.inPlay).toBe(true);
    expect(wt.instanceId).toBe('p1-site-wt');
    expect(wt.copies).toBe(0);
  });

  test('prefers a viable action over a non-viable one for the same site', () => {
    const view = buildView([planMovement('p1-s1', false), planMovement('p1-s2', true)]);
    const [barrow] = collectMovementDestinations(view, COMPANY);
    expect(barrow.action.viable).toBe(true);
    expect(barrow.instanceId).toBe('p1-s2');
  });
});

// ---- Route preview and placement -------------------------------------------

describe('computeRoutePreview', () => {
  test('Rivendell → Barrow-downs: starter site path and the Rhudaur–Cardolan region path', () => {
    const route = computeRoutePreview(pool[RIVENDELL], pool[BARROW_DOWNS], pool);
    expect(route.starter).toEqual(['wilderness', 'wilderness']);
    expect(route.regions).toEqual(['Rhudaur', 'Cardolan']);
    expect(route.regionTypes).toHaveLength(2);
  });

  test('no starter path between two non-haven sites', () => {
    const route = computeRoutePreview(pool[BREE], pool[WEATHERTOP], pool);
    expect(route.starter).toBeNull();
    expect(route.regions).toEqual(['Arthedain']);
  });
});

describe('placeDestinations', () => {
  test('uses the region centroid for sites without coordinates and lists unknown sites as unplaced', () => {
    const { placed, unplaced } = placeDestinations(collectMovementDestinations(buildView(standardActions()), COMPANY), pool);
    const hermit = placed.find(p => p.dest.defId === HERMITS_HILL)!;
    expect(hermit.approximate).toBe(true);
    expect(placed.find(p => p.dest.defId === BARROW_DOWNS)!.approximate).toBe(false);
    expect(unplaced.map(u => u.dest.defId)).toEqual([NO_SUCH_SITE]);
  });
});

// ---- The overlay -----------------------------------------------------------

function openPicker(actions = standardActions()): { sent: GameAction[]; overlay: StubEl } {
  const sent: GameAction[] = [];
  openMovementMap(buildView(actions), pool, COMPANY, a => sent.push(a));
  const overlay = body.children.find(c => c.classList.contains('map-picker-overlay'))!;
  return { sent, overlay };
}

function markerFor(overlay: StubEl, siteName: string): StubEl | undefined {
  return overlay.byClass('map-site-marker').find(m => m.dataset.siteName === siteName);
}

describe('openMovementMap', () => {
  test('only legal, viable destinations are clickable markers', () => {
    const { overlay } = openPicker();
    const selectable = overlay.byClass('map-site-marker--selectable').filter(m => !m.classList.contains('map-site-marker--legend'));
    expect(selectable.map(m => m.dataset.siteName).sort()).toEqual(['Barrow-downs', 'Hermit’s Hill', 'Weathertop']);
    const bree = markerFor(overlay, 'Bree')!;
    expect(bree.classList.contains('map-site-marker--unreachable')).toBe(true);
    expect(bree.disabled).toBe(true);
    expect(bree.title).toBe('Too far');
    // Moria is in the deck but not offered: drawn dimmed, never clickable.
    const unreachable = overlay.byClass('map-site-marker--unreachable');
    expect(unreachable.some(m => m.title.startsWith('Moria'))).toBe(true);
    expect(markerFor(overlay, 'Barrow-downs')!.byClass('map-site-marker-count')[0].textContent).toBe('2');
  });

  test('the company\'s current site is drawn as the origin marker', () => {
    const { overlay } = openPicker();
    const origin = overlay.byClass('map-site-marker--origin').filter(m => !m.classList.contains('map-site-marker--legend'));
    expect(origin).toHaveLength(1);
    expect(origin[0].title).toContain('Rivendell');
  });

  test('clicking a marker sends its exact plan-movement action and closes the map', () => {
    const { sent, overlay } = openPicker();
    markerFor(overlay, 'Barrow-downs')!.fire('click');
    expect(sent).toEqual([standardActions()[0].action]);
    expect(body.children).not.toContain(overlay);
    expect(docListeners.keydown ?? []).toHaveLength(0);
  });

  test('clicking the sibling\'s in-play site sends the in-play instance id', () => {
    const { sent, overlay } = openPicker();
    markerFor(overlay, 'Weathertop')!.fire('click');
    expect((sent[0] as { destinationSite: string }).destinationSite).toBe('p1-site-wt');
  });

  test('hovering a marker shows the preview panel and draws the route', () => {
    const { overlay } = openPicker();
    markerFor(overlay, 'Barrow-downs')!.fire('mouseenter');
    const preview = overlay.byClass('map-picker-preview')[0];
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(overlay.byClass('map-picker-route-line--region')).toHaveLength(1);
    expect(overlay.byClass('map-picker-route-line--starter')).toHaveLength(1);
    markerFor(overlay, 'Barrow-downs')!.fire('mouseleave');
    expect(preview.classList.contains('hidden')).toBe(true);
    expect(overlay.byClass('map-picker-route-line')).toHaveLength(0);
  });

  test('destinations without any map position are offered in the fallback strip', () => {
    const { sent, overlay } = openPicker();
    const buttons = overlay.byClass('map-picker-fallback-btn');
    expect(buttons.map(b => b.textContent)).toEqual([NO_SUCH_SITE]);
    buttons[0].fire('click');
    expect((sent[0] as { destinationSite: string }).destinationSite).toBe('p1-s6');
  });

  test('Escape closes the map without sending an action', () => {
    const { sent, overlay } = openPicker();
    for (const fn of [...(docListeners.keydown ?? [])]) fn({ key: 'Escape', stopPropagation() { /* no-op */ } });
    expect(body.children).not.toContain(overlay);
    expect(sent).toEqual([]);
  });

  test('the close button closes the map without sending an action', () => {
    const { sent, overlay } = openPicker();
    overlay.byClass('map-fullscreen-close')[0].fire('click');
    expect(body.children).not.toContain(overlay);
    expect(sent).toEqual([]);
    expect(docListeners.keydown ?? []).toHaveLength(0);
  });

  test('"Show as cards" closes the map and opens the site-deck grid with a way back', () => {
    const { overlay } = openPicker();
    overlay.byClass('map-picker-cards-btn')[0].fire('click');
    expect(body.children).not.toContain(overlay);
    expect(byId['pile-browser-modal'].classList.contains('hidden')).toBe(false);
    const mapBtn = byId['pile-browser-title'].parent!.children.find(c => c.id === 'pile-browser-map-btn');
    expect(mapBtn?.classList.contains('hidden')).toBe(false);
  });
});
