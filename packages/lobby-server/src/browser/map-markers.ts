/**
 * @module map-markers
 *
 * Geometry and marker helpers shared by the two map renderers — the minimap
 * radar (`map-radar.ts`) and the full-screen overlay (`map-fullscreen.ts`).
 *
 * Both renderers draw the same information on the same surface-map coordinate
 * system and differ only in presentation: the radar uses bare `title`
 * tooltips and small markers, the full map uses hover tooltip elements and
 * larger markers with a `--full` class. Everything that is purely about
 * *where* a marker goes — resolving an agent's position, laying out dashed
 * movement lines, spreading co-located dots apart — is the same in both and
 * lives here.
 */

import type {
  PlayerView,
  CardDefinition,
  CardInstanceId,
  AgentInPlay,
} from '@meccg/shared';
import { getCoordinates } from './map-coordinates.js';
import { isOnCurrentLevel } from './map-mode.js';
import { resolveCardDef } from './company-site.js';

/** SVG namespace for the movement-overlay layer. */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/** CSS class applied to dots/agents on the level that is NOT currently selected. */
export const DIM_CLASS = 'map-dot--other-level';

/**
 * Resolve a site reference to its position on the surface map.
 *
 * Every marker both renderers draw starts from this same three-step lookup:
 * instance id → site definition → surface-map coordinates, with any step able
 * to come up empty (an unresolvable instance, or a site with no printed map
 * position such as an Under-deeps location).
 *
 * @returns The coordinates, the site name and its definition (needed for
 * level checks), or null if the reference has no map position.
 */
export function resolveSitePosition(
  site: { readonly instanceId: CardInstanceId } | null | undefined,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): { coords: [number, number]; name: string; def: CardDefinition } | null {
  if (!site) return null;
  const def = resolveCardDef(site.instanceId, view, cardPool);
  if (!def) return null;
  const coords = getCoordinates(def.name);
  if (!coords) return null;
  return { coords, name: def.name, def };
}

/**
 * Resolve the first usable site named in a card's `homesite` field.
 *
 * `homesite` is a comma-separated list that may contain non-site entries
 * ("Any Dark-hold", "None"); those are skipped, as are named sites with no
 * surface-map coordinates. Returns the bare site name so callers can build
 * their own label from it.
 *
 * @returns The coordinates and site name, or null if none of the entries resolve.
 */
export function resolveHomesitePosition(
  agentDef: CardDefinition | undefined,
): { coords: [number, number]; name: string } | null {
  const homesite = agentDef && 'homesite' in agentDef ? (agentDef as { homesite: string }).homesite : undefined;
  if (!homesite) return null;

  for (const part of homesite.split(',')) {
    const name = part.trim();
    if (name.startsWith('Any ') || name === 'None') continue;
    const coords = getCoordinates(name);
    if (coords) return { coords, name };
  }

  return null;
}

/**
 * Resolve the map position for one of the player's own agents.
 *
 * Uses the top of the agent's `siteStack` when deployed; falls back to the
 * first concrete name in the card's `homesite` field when the agent has not
 * yet been placed, in which case the returned site name carries a `(home)`
 * suffix to make the distinction visible in tooltips.
 */
export function resolveAgentPosition(
  agent: AgentInPlay,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): { coords: [number, number] | null; siteName: string } {
  if (agent.siteStack.length > 0) {
    const currentSite = agent.siteStack[agent.siteStack.length - 1];
    const siteDef = resolveCardDef(currentSite.instanceId, view, cardPool);
    if (!siteDef) return { coords: null, siteName: '' };
    return { coords: getCoordinates(siteDef.name), siteName: siteDef.name };
  }

  // Agent not yet deployed — try homesite from card definition
  const home = resolveHomesitePosition(cardPool[agent.character.definitionId]);
  if (!home) return { coords: null, siteName: '' };
  return { coords: home.coords, siteName: `${home.name} (home)` };
}

/**
 * Build an SVG layer with dashed movement lines from each company's current
 * site to its destination site — own companies' declared destinations plus the
 * opponent's revealed ones. Lines whose origin is on the other map level are
 * drawn at low opacity, matching how the dots themselves are dimmed.
 *
 * @param strokeWidth - Line width in viewBox units; the radar and the full map
 * use the same 0-100 viewBox but very different pixel sizes, so each passes its
 * own value.
 * @returns The SVG layer, or null if no company has a destination.
 */
export function buildMovementLinesLayer(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  strokeWidth: string,
): SVGSVGElement | null {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; dimmed: boolean }> = [];

  const addLine = (
    currentSiteId: CardInstanceId,
    destSiteId: CardInstanceId,
  ): void => {
    const currentDef = resolveCardDef(currentSiteId, view, cardPool);
    const destDef = resolveCardDef(destSiteId, view, cardPool);
    if (!currentDef || !destDef) return;
    const c = getCoordinates(currentDef.name);
    const d = getCoordinates(destDef.name);
    if (!c || !d) return;
    const dimmed = !isOnCurrentLevel(currentDef.name, currentDef as { keywords?: readonly string[] });
    lines.push({ x1: c[0] * 100, y1: c[1] * 100, x2: d[0] * 100, y2: d[1] * 100, dimmed });
  };

  for (const company of view.self.companies) {
    if (!company.currentSite || !company.destinationSite) continue;
    addLine(company.currentSite.instanceId, company.destinationSite.instanceId);
  }

  for (const company of view.opponent.companies) {
    if (!company.currentSite || !company.revealedDestinationSite) continue;
    addLine(company.currentSite.instanceId, company.revealedDestinationSite.instanceId);
  }

  if (lines.length === 0) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'map-destination-line');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');

  for (const { x1, y1, x2, y2, dimmed } of lines) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', 'rgba(0, 0, 0, 0.75)');
    line.setAttribute('stroke-width', strokeWidth);
    if (dimmed) line.setAttribute('opacity', '0.15');
    svg.appendChild(line);
  }

  return svg;
}

/**
 * Append company dots to a layer, arranging any that share a position side by
 * side so a stack of companies at one site stays individually clickable.
 *
 * @param stepPx - Horizontal spacing between co-located dots (dot width + gap).
 */
export function appendSpreadDots<T extends { dot: HTMLElement; x: number; y: number }>(
  dotsLayer: HTMLElement,
  pendingDots: readonly T[],
  stepPx: number,
): void {
  const groups = new Map<string, T[]>();
  for (const item of pendingDots) {
    const key = `${Math.round(item.x * 10000)},${Math.round(item.y * 10000)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  for (const group of groups.values()) {
    if (group.length > 1) {
      const total = group.length;
      group.forEach(({ dot }, i) => {
        const dx = (i - (total - 1) / 2) * stepPx;
        dot.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), -50%)`;
      });
    }
    for (const { dot } of group) dotsLayer.appendChild(dot);
  }
}
