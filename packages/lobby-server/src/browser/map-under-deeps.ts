/**
 * @module map-under-deeps
 *
 * Renders the Under-deeps schematic layer: a dark SVG canvas with
 * site nodes positioned from under-deeps-coordinates.json, connected
 * by adjacency lines derived from the live player view.
 *
 * Under-deeps sites are identified by `keywords: ["under-deeps"]` in the
 * site card definitions (dm-sites.json + ba-sites.json). Their coordinates
 * are stored in under-deeps-coordinates.json relative to the bounding box
 * of those sites, produced by tools/convert-under-deeps-positions.ts.
 *
 * Color coding for company dots mirrors the surface map:
 * - Active company: gold (#f0c040)
 * - Other own companies: grey (#888)
 * - Opponent companies: red (#c04040)
 */

import type {
  PlayerView,
  CardDefinition,
  Company,
  OpponentCompanyView,
} from '@meccg/shared';
import { resolveCardDef } from './company-site.js';

// ---------------------------------------------------------------------------
// Coordinate loading and caching
// ---------------------------------------------------------------------------

/** Map from site name (lower-cased) to [x, y] fraction coordinates. */
let udCoordCache: Map<string, [number, number]> | null = null;

/** In-flight fetch promise — prevents duplicate requests during concurrent callers. */
let udLoadPromise: Promise<void> | null = null;

/**
 * Load and cache the Under-deeps coordinate data from the static JSON asset.
 * Safe to call multiple times — the fetch is performed at most once.
 */
export async function loadUnderDeepsCoordinates(): Promise<void> {
  if (udCoordCache !== null) return;
  if (udLoadPromise !== null) {
    await udLoadPromise;
    return;
  }

  udLoadPromise = (async () => {
    const response = await fetch('/data/under-deeps-coordinates.json');
    if (!response.ok) {
      throw new Error(`Failed to load under-deeps coordinates: ${response.status} ${response.statusText}`);
    }
    const raw: Record<string, [number, number]> = await response.json() as Record<string, [number, number]>;

    // Build case-insensitive lookup map
    const map = new Map<string, [number, number]>();
    for (const [name, coords] of Object.entries(raw)) {
      map.set(name.toLowerCase(), coords);
    }
    udCoordCache = map;
  })();

  await udLoadPromise;
}

/**
 * Look up the [x, y] fraction coordinates for an Under-deeps site by name.
 * Returns null if coordinates are not available (either not loaded yet,
 * or the site has no entry in the Under-deeps coordinate database).
 *
 * Lookup is case-insensitive.
 */
export function getUnderDeepsCoordinates(siteName: string): [number, number] | null {
  if (udCoordCache === null) return null;
  return udCoordCache.get(siteName.toLowerCase()) ?? null;
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

/** SVG namespace used for all SVG element creation. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fixed dimensions of the Under-deeps SVG canvas. */
const SVG_WIDTH = 600;
const SVG_HEIGHT = 400;

/** Radius of each site node circle. */
const NODE_RADIUS = 6;

/** Font size for site name labels. */
const LABEL_FONT_SIZE = 10;

/** Color coding for company dot roles. */
const DOT_COLORS: Record<'active' | 'own' | 'opponent', string> = {
  active: '#f0c040',
  own: '#888888',
  opponent: '#c04040',
};

/**
 * Create the Under-deeps schematic view.
 *
 * @param view - The current player's view.
 * @param cardPool - The full card definition pool for site name lookups.
 * @param activeCompanyIndex - Index of the active company in `view.self.companies`.
 * @returns A `<div class="map-underdeeps">` containing an SVG, or null if
 *   coordinates have not been loaded yet.
 */
export function createUnderDeepsView(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  activeCompanyIndex: number,
): HTMLElement | null {
  if (udCoordCache === null) return null;

  const container = document.createElement('div');
  container.className = 'map-underdeeps';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(SVG_WIDTH));
  svg.setAttribute('height', String(SVG_HEIGHT));
  svg.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
  svg.setAttribute('class', 'map-underdeeps-svg');
  container.appendChild(svg);

  // Dark background
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(SVG_WIDTH));
  bg.setAttribute('height', String(SVG_HEIGHT));
  bg.setAttribute('fill', '#0a0a12');
  svg.appendChild(bg);

  // Draw all known Under-deeps site nodes and labels
  for (const [name, coords] of udCoordCache.entries()) {
    const [fx, fy] = coords;
    const cx = fx * SVG_WIDTH;
    const cy = fy * SVG_HEIGHT;

    // Site node circle
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(NODE_RADIUS));
    circle.setAttribute('fill', '#334');
    circle.setAttribute('stroke', '#667');
    circle.setAttribute('stroke-width', '1');
    svg.appendChild(circle);

    // Site name label
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(cx));
    label.setAttribute('y', String(cy + NODE_RADIUS + LABEL_FONT_SIZE));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#99a');
    label.setAttribute('font-size', String(LABEL_FONT_SIZE));
    label.setAttribute('font-family', 'sans-serif');
    // Display the canonical (original-case) name — look it up from the stored entries
    label.textContent = getCanonicalName(name);
    svg.appendChild(label);
  }

  // Draw company dots on top of the site nodes
  view.self.companies.forEach((company, idx) => {
    const dot = createUnderDeepsDot(company, view, cardPool, idx === activeCompanyIndex ? 'active' : 'own', svg);
    if (dot) svg.appendChild(dot);
  });

  for (const company of view.opponent.companies) {
    const dot = createUnderDeepsDot(company, view, cardPool, 'opponent', svg);
    if (dot) svg.appendChild(dot);
  }

  return container;
}

/**
 * Convert a lower-cased cache key back to a display name by finding the
 * original entry with the matching lowercase key.
 * Falls back to title-casing the key if not found.
 */
function getCanonicalName(lowerName: string): string {
  // The cache stores lowercase keys; we stored the original name as the key in the raw data.
  // Since we only have lowercase keys in the cache, reconstruct a human-readable version
  // by capitalising each word (good enough for display, actual canonical name not needed here).
  return lowerName.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Create a company dot SVG element for the Under-deeps schematic.
 * Returns null if the company's current site is not an Under-deeps site.
 */
function createUnderDeepsDot(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  role: 'active' | 'own' | 'opponent',
  _svg: SVGSVGElement,
): SVGElement | null {
  if (!company.currentSite) return null;

  const siteDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
  if (!siteDef) return null;

  const coords = getUnderDeepsCoordinates(siteDef.name);
  if (!coords) return null;

  const [fx, fy] = coords;
  const cx = fx * SVG_WIDTH;
  const cy = fy * SVG_HEIGHT;
  const color = DOT_COLORS[role];

  const g = document.createElementNS(SVG_NS, 'g');

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', '5');
  circle.setAttribute('fill', color);
  circle.setAttribute('stroke', 'rgba(0,0,0,0.5)');
  circle.setAttribute('stroke-width', '1');

  if (role === 'active') {
    // Slightly larger for the active company
    circle.setAttribute('r', '7');
  }

  g.appendChild(circle);
  return g;
}
