/**
 * @module map-fullscreen
 *
 * Full-screen map overlay for the MECCG game UI.
 *
 * When the player clicks the radar minimap, this module opens a full-screen
 * overlay containing the Middle-Earth map with all company positions shown
 * as coloured dots. Hovering a dot reveals a tooltip with the company's
 * site name. Clicking a company dot selects that company (via the provided
 * callback) and closes the overlay.
 *
 * The overlay is closed by:
 * - Clicking the × close button
 * - Pressing the Escape key
 * - Clicking the semi-transparent backdrop outside the map
 *
 * Color coding mirrors the radar: gold pulse for active company, grey for
 * other own companies, red for opponent companies.
 *
 * A layer toggle button (top-left) switches between the surface map and the
 * Under-deeps schematic. The toggle is active only when at least one company
 * is at an Under-deeps site.
 *
 * Movement overlay (Phase 6): when a self company has a `destinationSite`
 * set, a dashed green line is drawn from its current site dot to the
 * destination, and a green destination dot is added.
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
import { getUnderDeepsCoordinates, createUnderDeepsView } from './map-under-deeps.js';
import { resolveCardDef } from './company-site.js';

/** SVG namespace for creating the movement-overlay SVG layer. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Open the full-screen map overlay.
 *
 * @param view - The current player's view.
 * @param activeCompanyIndex - Index of the currently focused company in `view.self.companies`.
 * @param cardPool - Card definition pool for site name lookups.
 * @param onSelectCompany - Callback invoked with the company index when the player
 *   clicks a dot for one of their own companies. The overlay is closed before the
 *   callback fires.
 */
export function openFullMap(
  view: PlayerView,
  activeCompanyIndex: number,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onSelectCompany: (idx: number) => void,
): void {
  // Backdrop
  const overlay = document.createElement('div');
  overlay.className = 'map-fullscreen-overlay';

  const close = () => overlay.remove();

  // Clicking the backdrop closes the overlay
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Escape key closes the overlay
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKeyDown);
    }
  };
  document.addEventListener('keydown', onKeyDown);
  overlay.addEventListener('remove-listener', () => {
    document.removeEventListener('keydown', onKeyDown);
  });

  // Inner container
  const inner = document.createElement('div');
  inner.className = 'map-fullscreen-inner';
  overlay.appendChild(inner);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'map-fullscreen-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close map';
  closeBtn.addEventListener('click', () => {
    close();
    document.removeEventListener('keydown', onKeyDown);
  });
  inner.appendChild(closeBtn);

  // Determine whether any company is at an Under-deeps site
  const hasUnderDeepsCompany = checkHasUnderDeepsCompany(view, cardPool);

  // Layer toggle button (top-left)
  let currentLayer: 'surface' | 'under-deeps' = 'surface';
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'map-layer-toggle';
  toggleBtn.textContent = 'Surface';
  toggleBtn.title = hasUnderDeepsCompany
    ? 'Toggle between surface map and Under-deeps schematic'
    : 'No companies in the Under-deeps';
  if (!hasUnderDeepsCompany) {
    toggleBtn.disabled = true;
  }
  inner.appendChild(toggleBtn);

  // Map image container
  const mapContainer = document.createElement('div');
  mapContainer.className = 'map-fullscreen-map';
  inner.appendChild(mapContainer);

  /** Render the surface map layer into mapContainer. */
  const renderSurfaceLayer = () => {
    mapContainer.innerHTML = '';

    // Background map image
    const mapImg = document.createElement('img');
    mapImg.src = '/images/map-middle-earth.jpg';
    mapImg.className = 'map-fullscreen-img';
    mapImg.alt = 'Middle-Earth Map';
    mapContainer.appendChild(mapImg);

    // Movement lines SVG layer (drawn behind dots)
    const moveLines = buildMovementLinesLayer(view, cardPool);
    if (moveLines) {
      mapContainer.appendChild(moveLines);
    }

    // Dots layer
    const dotsLayer = document.createElement('div');
    dotsLayer.className = 'map-fullscreen-dots';
    mapContainer.appendChild(dotsLayer);

    // Collect all company dots before appending so we can spread overlapping ones.
    const pendingDots: Array<{ dot: HTMLElement; x: number; y: number }> = [];

    // Self companies
    view.self.companies.forEach((company, idx) => {
      const role = idx === activeCompanyIndex ? 'active' : 'own';
      const dot = createFullMapDot(company, view, cardPool, role);
      if (!dot) return;

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        document.removeEventListener('keydown', onKeyDown);
        close();
        onSelectCompany(idx);
      });

      const coords = getCoordinates(resolveCardDef(company.currentSite!.instanceId, view, cardPool)!.name)!;
      pendingDots.push({ dot, x: coords[0], y: coords[1] });

      const destDot = createDestinationDot(company, view, cardPool);
      if (destDot) dotsLayer.appendChild(destDot);
    });

    // Opponent companies
    for (const company of view.opponent.companies) {
      const dot = createFullMapDot(company, view, cardPool, 'opponent');
      if (dot) {
        const coords = getCoordinates(resolveCardDef(company.currentSite!.instanceId, view, cardPool)!.name)!;
        pendingDots.push({ dot, x: coords[0], y: coords[1] });
      }

      if (company.revealedDestinationSite) {
        const destDef = resolveCardDef(company.revealedDestinationSite.instanceId, view, cardPool);
        if (destDef) {
          const coords = getCoordinates(destDef.name);
          if (coords) {
            const destDot = document.createElement('div');
            destDot.className = 'map-dot map-dot--opponent-destination map-dot--full';
            destDot.style.left = `${coords[0] * 100}%`;
            destDot.style.top = `${coords[1] * 100}%`;
            const tooltip = document.createElement('div');
            tooltip.className = 'map-dot-tooltip';
            const tl1 = document.createElement('div');
            tl1.textContent = companyLabel(company, view, cardPool);
            const tl2 = document.createElement('div');
            tl2.textContent = `→ ${destDef.name}`;
            tl2.style.opacity = '0.75';
            tooltip.appendChild(tl1);
            tooltip.appendChild(tl2);
            destDot.appendChild(tooltip);
            dotsLayer.appendChild(destDot);
          }
        }
      }
    }

    // Group dots that share the same map position and arrange them side by side,
    // centred on the site coordinate.
    const groups = new Map<string, typeof pendingDots>();
    for (const item of pendingDots) {
      const key = `${Math.round(item.x * 10000)},${Math.round(item.y * 10000)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    const STEP_PX = 14; // dot width (12px) + 2px gap
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

    // Own agents — always visible (face-up or face-down)
    for (const agent of view.self.agents) {
      const diamond = createFullMapAgentDiamond(agent, view, cardPool);
      if (diamond) dotsLayer.appendChild(diamond);
    }

    // Revealed opponent agents — shown at their homesite on the full map.
    for (const agent of view.opponent.agents) {
      if (!agent.revealed || !agent.characterDefinitionId) continue;
      const diamond = createFullMapOpponentAgentDiamond(agent, cardPool);
      if (diamond) dotsLayer.appendChild(diamond);
    }

    // Hidden-agents badge: count opponent face-down agents and show a badge
    const hiddenAgentCount = view.opponent.agents.filter((a) => !a.revealed).length;
    if (hiddenAgentCount > 0) {
      const badge = document.createElement('div');
      badge.className = 'map-hidden-agents-badge';
      badge.textContent = `${hiddenAgentCount} hidden agent${hiddenAgentCount === 1 ? '' : 's'}`;
      mapContainer.appendChild(badge);
    }
  };

  /** Render the Under-deeps layer into mapContainer. */
  const renderUnderDeepsLayer = () => {
    mapContainer.innerHTML = '';
    const udView = createUnderDeepsView(view, cardPool, activeCompanyIndex);
    if (udView) {
      mapContainer.appendChild(udView);
    } else {
      const msg = document.createElement('p');
      msg.className = 'map-underdeeps-unavailable';
      msg.textContent = 'Under-deeps coordinates not loaded yet.';
      mapContainer.appendChild(msg);
    }
  };

  // Initial render
  renderSurfaceLayer();

  // Toggle button handler
  toggleBtn.addEventListener('click', () => {
    if (currentLayer === 'surface') {
      currentLayer = 'under-deeps';
      toggleBtn.textContent = 'Under-deeps';
      renderUnderDeepsLayer();
    } else {
      currentLayer = 'surface';
      toggleBtn.textContent = 'Surface';
      renderSurfaceLayer();
    }
  });

  document.body.appendChild(overlay);
}

/**
 * Check whether any company (self or opponent) is currently at an Under-deeps site.
 * Used to determine whether the layer toggle button should be enabled.
 */
function checkHasUnderDeepsCompany(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): boolean {
  const allCompanies: (Company | OpponentCompanyView)[] = [
    ...view.self.companies,
    ...view.opponent.companies,
  ];
  for (const company of allCompanies) {
    if (!company.currentSite) continue;
    const siteDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
    if (siteDef && getUnderDeepsCoordinates(siteDef.name) !== null) return true;
  }
  return false;
}

/**
 * Build an SVG layer containing dashed movement lines for all companies
 * (self and opponent) that have a declared destination site.
 *
 * Self companies draw a green line; opponent companies with a revealed
 * destination draw a red line.
 *
 * The SVG is positioned absolutely over the map container with pointer-events
 * set to none so it does not interfere with dot interactions.
 * Returns null if no companies have a destination.
 */
function buildMovementLinesLayer(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): SVGSVGElement | null {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; stroke: string }> = [];

  for (const company of view.self.companies) {
    if (!company.currentSite || !company.destinationSite) continue;

    const currentDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
    const destDef = resolveCardDef(company.destinationSite.instanceId, view, cardPool);
    if (!currentDef || !destDef) continue;

    const currentCoords = getCoordinates(currentDef.name);
    const destCoords = getCoordinates(destDef.name);
    if (!currentCoords || !destCoords) continue;

    lines.push({
      x1: currentCoords[0] * 100,
      y1: currentCoords[1] * 100,
      x2: destCoords[0] * 100,
      y2: destCoords[1] * 100,
      stroke: 'rgba(0, 0, 0, 0.75)',
    });
  }

  for (const company of view.opponent.companies) {
    if (!company.currentSite || !company.revealedDestinationSite) continue;

    const currentDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
    const destDef = resolveCardDef(company.revealedDestinationSite.instanceId, view, cardPool);
    if (!currentDef || !destDef) continue;

    const currentCoords = getCoordinates(currentDef.name);
    const destCoords = getCoordinates(destDef.name);
    if (!currentCoords || !destCoords) continue;

    lines.push({
      x1: currentCoords[0] * 100,
      y1: currentCoords[1] * 100,
      x2: destCoords[0] * 100,
      y2: destCoords[1] * 100,
      stroke: 'rgba(0, 0, 0, 0.75)',
    });
  }

  if (lines.length === 0) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'map-destination-line');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');

  for (const { x1, y1, x2, y2, stroke } of lines) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', '0.4');
    svg.appendChild(line);
  }

  return svg;
}

/**
 * Create a destination dot element for a self company that has declared movement.
 * Returns null if the company has no destination or if destination coords are unavailable.
 */
function createDestinationDot(
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
  dot.className = 'map-dot map-dot--destination map-dot--full';
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${y * 100}%`;

  const tooltip = document.createElement('div');
  tooltip.className = 'map-dot-tooltip';
  const line1 = document.createElement('div');
  line1.textContent = companyLabel(company, view, cardPool);
  const line2 = document.createElement('div');
  line2.textContent = `→ ${destDef.name}`;
  line2.style.opacity = '0.75';
  tooltip.appendChild(line1);
  tooltip.appendChild(line2);
  dot.appendChild(tooltip);

  return dot;
}

/** Derive a short company label from its first character, e.g. "Gandalf's Company". */
function companyLabel(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const firstId = company.characters[0];
  if (!firstId) return 'Company';
  const def = resolveCardDef(firstId, view, cardPool);
  if (!def) return 'Company';
  return def.name.endsWith('s') ? `${def.name}' Company` : `${def.name}'s Company`;
}

/**
 * Create a positioned dot element for the full map overlay.
 * The dot is larger than the radar dot (12×12px via CSS class `map-dot--full`).
 * Returns null if no coordinates are available for the company's current site.
 */
function createFullMapDot(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  role: 'active' | 'own' | 'opponent',
): HTMLElement | null {
  if (!company.currentSite) return null;

  const siteDef = resolveCardDef(company.currentSite.instanceId, view, cardPool);
  if (!siteDef) return null;

  const coords = getCoordinates(siteDef.name);
  if (!coords) return null;

  const [x, y] = coords;

  const dot = document.createElement('div');
  dot.className = `map-dot map-dot--${role} map-dot--full`;
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${y * 100}%`;

  const label = companyLabel(company, view, cardPool);

  // Tooltip
  dot.title = `${label} — ${siteDef.name}`;

  // Hover tooltip with company name and site on separate lines
  const tooltip = document.createElement('div');
  tooltip.className = 'map-dot-tooltip';
  const line1 = document.createElement('div');
  line1.textContent = label;
  const line2 = document.createElement('div');
  line2.textContent = siteDef.name;
  line2.style.opacity = '0.75';
  tooltip.appendChild(line1);
  tooltip.appendChild(line2);
  dot.appendChild(tooltip);

  return dot;
}

/**
 * Create a diamond marker for one of the player's own agents on the full map.
 *
 * Own agents (face-up or face-down) are always shown because the player always
 * knows where their own agents are positioned. The diamond is larger than the
 * radar version (via `map-agent--full`) and shows a tooltip with the agent name
 * when revealed, or "Face-down agent" when hidden.
 *
 * No click handler is attached — clicking agent diamonds has no effect in Phase 5.
 * Agent selection via the map is deferred to a later iteration once
 * `select-company` targeting covers agents (see spec Phase 5 notes).
 *
 * Returns null if coordinates are unavailable.
 */
function createFullMapAgentDiamond(
  agent: AgentInPlay,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  const { coords, siteName } = resolveFullMapAgentPosition(agent, view, cardPool);
  if (!coords) return null;

  const [x, y] = coords;

  const diamond = document.createElement('div');
  const revealedClass = agent.revealed ? 'map-agent--own-revealed' : 'map-agent--own-hidden';
  diamond.className = `map-agent ${revealedClass} map-agent--full`;
  diamond.style.left = `${x * 100}%`;
  diamond.style.top = `${y * 100}%`;

  const agentName = cardPool[agent.character.definitionId]?.name ?? 'Unknown agent';

  const tooltip = document.createElement('div');
  tooltip.className = 'map-dot-tooltip';
  const tl1 = document.createElement('div');
  tl1.textContent = agentName;
  const tl2 = document.createElement('div');
  tl2.textContent = siteName;
  tl2.style.opacity = '0.75';
  tooltip.appendChild(tl1);
  tooltip.appendChild(tl2);
  diamond.appendChild(tooltip);

  return diamond;
}

/**
 * Resolve the map position for an agent on the full-screen map.
 * Uses the top of the siteStack when deployed; falls back to the first concrete
 * name in the card's `homesite` field when the agent has not yet been placed.
 */
function resolveFullMapAgentPosition(
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
 * Create a full-map diamond marker for a revealed opponent agent at its homesite.
 * Returns null if coordinates are unavailable.
 */
function createFullMapOpponentAgentDiamond(
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
    diamond.className = 'map-agent map-agent--opponent-revealed map-agent--full';
    diamond.style.left = `${x * 100}%`;
    diamond.style.top = `${y * 100}%`;

    const tooltip = document.createElement('div');
    tooltip.className = 'map-dot-tooltip';
    const tl1 = document.createElement('div');
    tl1.textContent = agentName;
    const tl2 = document.createElement('div');
    tl2.textContent = `${name} (home)`;
    tl2.style.opacity = '0.75';
    tooltip.appendChild(tl1);
    tooltip.appendChild(tl2);
    diamond.appendChild(tooltip);

    return diamond;
  }

  return null;
}
