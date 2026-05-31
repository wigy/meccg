/**
 * @module map-radar
 *
 * Renders the minimap radar widget shown in the single-company view.
 *
 * The radar is a compact fixed-size element showing the Middle-Earth map
 * with coloured dots for all companies:
 * - Active company: gold dot with a pulse animation
 * - Other own companies: grey dots
 * - Opponent companies: red dots
 *
 * When the active company is at an Under-deeps site, the radar renders the
 * Under-deeps schematic instead of the surface map. A small indicator in the
 * top-left corner shows the cave symbol (⛏) to signal the underground layer.
 *
 * If a self company has a declared `destinationSite` (during Organization
 * phase), a small green destination dot is shown at the destination's
 * coordinates alongside the company's current-site dot.
 *
 * Clicking the radar fires the custom `map-radar-click` event on the element,
 * which is picked up by the company-views wiring to open the full map overlay.
 *
 * The radar is not shown when the active company has no site (guards against
 * the null-currentSite case that can occur during setup).
 */

import type {
  PlayerView,
  CardDefinition,
  Company,
  OpponentCompanyView,
  AgentInPlay,
  OpponentAgentView,
} from '@meccg/shared';
import { getCoordinates } from './map-coordinates.js';
import { getMapMode, isOnCurrentLevel } from './map-mode.js';
import { resolveCardDef } from './company-site.js';

/** Index into the combined list of all companies (self first, then opponent). */
export type CompanyIndex = number;

/**
 * Create the minimap radar widget for the single-company view.
 *
 * @param view - The current player's view.
 * @param activeCompanyIndex - The index of the active company in `view.self.companies`.
 * @param cardPool - The full card definition pool for name lookups.
 * @returns A `<div class="map-radar">` element, or null if the active company has no site.
 */
export function createRadar(
  view: PlayerView,
  activeCompanyIndex: number,
  cardPool: Readonly<Record<string, CardDefinition>>,
  activeOpponentIndex?: number,
): HTMLElement | null {
  const activeCompany = view.self.companies[activeCompanyIndex];
  const hasAnySelfSite = view.self.companies.some(c => c.currentSite);
  const hasAnyAgent = view.self.agents.length > 0 || view.opponent.agents.some(a => a.revealed);
  if (!activeCompany?.currentSite && !hasAnySelfSite && !hasAnyAgent) return null;

  const mode = getMapMode();

  const radar = document.createElement('div');
  radar.className = mode === 'under-deeps' ? 'map-radar map-radar--under-deeps-mode' : 'map-radar';
  radar.title = 'Click to open full map';

  // Map background image
  const mapBg = document.createElement('div');
  mapBg.className = 'map-bg';
  radar.appendChild(mapBg);

  // Movement lines SVG layer (drawn behind the dots)
  const moveLines = buildRadarMovementLines(view, cardPool);
  if (moveLines) radar.appendChild(moveLines);

  // Dot container — overlaid on the map background
  const dotsLayer = document.createElement('div');
  dotsLayer.className = 'map-dots';
  radar.appendChild(dotsLayer);

  // Collect company dots before appending so overlapping ones can be spread.
  const pendingDots: Array<{ dot: HTMLElement; x: number; y: number }> = [];

  // Render own companies
  view.self.companies.forEach((company, idx) => {
    const dot = createCompanyDot(company, view, cardPool, idx === activeCompanyIndex ? 'active' : 'own');
    const dimmed = dot?.classList.contains('map-dot--other-level') ?? false;
    if (dot) {
      const siteDef = resolveCardDef(company.currentSite!.instanceId, view, cardPool);
      const coords = siteDef ? getCoordinates(siteDef.name) : null;
      if (coords) pendingDots.push({ dot, x: coords[0], y: coords[1] });
    }

    const destDot = createRadarDestinationDot(company, view, cardPool);
    if (destDot) {
      if (dimmed) destDot.classList.add('map-dot--other-level');
      dotsLayer.appendChild(destDot);
    }
  });

  // Render opponent companies
  view.opponent.companies.forEach((company, idx) => {
    const role = idx === activeOpponentIndex ? 'opponent-active' : 'opponent';
    const dot = createCompanyDot(company, view, cardPool, role);
    const dimmed = dot?.classList.contains('map-dot--other-level') ?? false;
    if (dot) {
      const siteDef = resolveCardDef(company.currentSite!.instanceId, view, cardPool);
      const coords = siteDef ? getCoordinates(siteDef.name) : null;
      if (coords) pendingDots.push({ dot, x: coords[0], y: coords[1] });
    }

    if (company.revealedDestinationSite) {
      const destDef = resolveCardDef(company.revealedDestinationSite.instanceId, view, cardPool);
      if (destDef) {
        const coords = getCoordinates(destDef.name);
        if (coords) {
          const destDot = document.createElement('div');
          destDot.className = 'map-dot map-dot--opponent-destination';
          destDot.style.left = `${coords[0] * 100}%`;
          destDot.style.top = `${coords[1] * 100}%`;
          destDot.title = `→ ${destDef.name}`;
          if (dimmed) destDot.classList.add('map-dot--other-level');
          dotsLayer.appendChild(destDot);
        }
      }
    }
  });

  // Group company dots sharing the same position and arrange them side by side.
  const groups = new Map<string, typeof pendingDots>();
  for (const item of pendingDots) {
    const key = `${Math.round(item.x * 10000)},${Math.round(item.y * 10000)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const STEP_PX = 10; // dot width (8px) + 2px gap
  for (const group of groups.values()) {
    if (group.length > 1) {
      const total = group.length;
      group.forEach(({ dot }, i) => {
        const dx = (i - (total - 1) / 2) * STEP_PX;
        dot.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), -50%)`;
      });
    }
    for (const { dot } of group) dotsLayer.appendChild(dot);
  }

  // Render own agents as diamond markers (always visible — face-up and face-down)
  for (const agent of view.self.agents) {
    const diamond = createAgentDiamond(agent, view, cardPool);
    if (diamond) dotsLayer.appendChild(diamond);
  }

  // Render revealed opponent agents at their homesite (siteStackSize === 0)
  // or skip if face-down (position unknown to the resource player).
  for (const agent of view.opponent.agents) {
    if (!agent.revealed || !agent.characterDefinitionId) continue;
    const diamond = createOpponentAgentDiamond(agent, cardPool);
    if (diamond) dotsLayer.appendChild(diamond);
  }

  // Clicking the radar fires a custom event
  radar.addEventListener('click', () => {
    radar.dispatchEvent(new CustomEvent('map-radar-click', { bubbles: true }));
  });

  return radar;
}

/**
 * Create a positioned dot element for one company.
 * Returns null if the company has no current site or if the site has no coordinates.
 */
function createCompanyDot(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  role: 'active' | 'own' | 'opponent' | 'opponent-active',
): HTMLElement | null {
  if (!company.currentSite) return null;

  const siteDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
  if (!siteDef) return null;

  const coords = getCoordinates(siteDef.name);
  if (!coords) return null;

  const [x, y] = coords;

  const dot = document.createElement('div');
  dot.className = `map-dot map-dot--${role}`;
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${y * 100}%`;
  dot.title = siteDef.name;

  if (!isOnCurrentLevel(siteDef.name, siteDef as { keywords?: readonly string[] })) dot.classList.add('map-dot--other-level');

  return dot;
}

/**
 * Create a diamond marker element for one of the player's own agents on the radar.
 *
 * Own agents are always shown (face-up or face-down) because the player always
 * knows where their own agents are.
 *
 * Returns null if coordinates are unavailable.
 */
function createAgentDiamond(
  agent: AgentInPlay,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  const { coords, siteName } = resolveAgentPosition(agent, view, cardPool);
  if (!coords) return null;

  const [x, y] = coords;

  const agentName = cardPool[agent.character.definitionId]?.name ?? 'Unknown agent';

  const diamond = document.createElement('div');
  const revealedClass = agent.revealed ? 'map-agent--own-revealed' : 'map-agent--own-hidden';
  diamond.className = `map-agent ${revealedClass}`;
  diamond.style.left = `${x * 100}%`;
  diamond.style.top = `${y * 100}%`;
  diamond.title = `${agentName} — ${siteName}`;
  if (!isOnCurrentLevel(siteName)) diamond.classList.add('map-agent--other-level');

  return diamond;
}

/**
 * Resolve the map position for an agent.
 * Uses the top of the siteStack when deployed; falls back to the first concrete
 * name in the card's `homesite` field when the agent has not yet been placed.
 */
function resolveAgentPosition(
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
  const agentDef = cardPool[agent.character.definitionId];
  const homesite = agentDef && 'homesite' in agentDef ? (agentDef as { homesite: string }).homesite : undefined;
  if (!homesite) return { coords: null, siteName: '' };

  for (const part of homesite.split(',')) {
    const name = part.trim();
    if (name.startsWith('Any ') || name === 'None') continue;
    const coords = getCoordinates(name);
    if (coords) return { coords, siteName: `${name} (home)` };
  }

  return { coords: null, siteName: '' };
}

/**
 * Create a radar diamond marker for a revealed opponent agent.
 * The agent's homesite is looked up from its card definition.
 * Returns null if coordinates are unavailable.
 */
function createOpponentAgentDiamond(
  agent: OpponentAgentView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  const agentDef = agent.characterDefinitionId ? cardPool[agent.characterDefinitionId as string] : undefined;
  const homesite = agentDef && 'homesite' in agentDef ? (agentDef as { homesite: string }).homesite : undefined;
  if (!homesite) return null;

  for (const part of homesite.split(',')) {
    const name = part.trim();
    if (name.startsWith('Any ') || name === 'None') continue;
    const coords = getCoordinates(name);
    if (!coords) continue;

    const [x, y] = coords;
    const agentName = (agentDef as { name?: string }).name ?? 'Agent';
    const diamond = document.createElement('div');
    diamond.className = 'map-agent map-agent--opponent-revealed';
    diamond.style.left = `${x * 100}%`;
    diamond.style.top = `${y * 100}%`;
    diamond.title = `${agentName} — ${name} (home)`;
    if (!isOnCurrentLevel(name)) diamond.classList.add('map-agent--other-level');
    return diamond;
  }

  return null;
}

/**
 * Create a small green destination dot for the radar when a self company has
 * a declared `destinationSite`. Returns null if no destination or no coordinates.
 */
function createRadarDestinationDot(
  company: Company,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  if (!company.destinationSite) return null;

  const destDef = resolveCardDef(company.destinationSite.instanceId, view, cardPool);
  if (!destDef) return null;

  const coords = getCoordinates(destDef.name);
  if (!coords) return null;

  const [x, y] = coords;

  const dot = document.createElement('div');
  dot.className = 'map-dot map-dot--destination';
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${y * 100}%`;
  dot.title = `→ ${destDef.name}`;

  return dot;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build a miniature SVG layer for the radar showing dashed movement lines
 * from each company's current site to its destination site.
 * Returns null if no companies have a destination.
 */
function buildRadarMovementLines(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): SVGSVGElement | null {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; dimmed: boolean }> = [];

  for (const company of view.self.companies) {
    if (!company.currentSite || !company.destinationSite) continue;
    const currentDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
    const destDef = resolveCardDef(company.destinationSite.instanceId, view, cardPool);
    if (!currentDef || !destDef) continue;
    const c = getCoordinates(currentDef.name);
    const d = getCoordinates(destDef.name);
    if (!c || !d) continue;
    const dimmed = !isOnCurrentLevel(currentDef.name, currentDef as { keywords?: readonly string[] });
    lines.push({ x1: c[0] * 100, y1: c[1] * 100, x2: d[0] * 100, y2: d[1] * 100, dimmed });
  }

  for (const company of view.opponent.companies) {
    if (!company.currentSite || !company.revealedDestinationSite) continue;
    const currentDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
    const destDef = resolveCardDef(company.revealedDestinationSite.instanceId, view, cardPool);
    if (!currentDef || !destDef) continue;
    const c = getCoordinates(currentDef.name);
    const d = getCoordinates(destDef.name);
    if (!c || !d) continue;
    const dimmed = !isOnCurrentLevel(currentDef.name, currentDef as { keywords?: readonly string[] });
    lines.push({ x1: c[0] * 100, y1: c[1] * 100, x2: d[0] * 100, y2: d[1] * 100, dimmed });
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
    line.setAttribute('stroke-width', '1');
    if (dimmed) line.setAttribute('opacity', '0.15');
    svg.appendChild(line);
  }

  return svg;
}
