/**
 * @module map-fullscreen
 *
 * Full-screen map overlay for the MECCG game UI.
 *
 * Shows the Middle-Earth surface map in two modes — Surface and Under-deeps.
 * The active mode is stored in map-mode.ts and shared with the radar so both
 * always reflect the same layer.
 *
 * In Surface mode the map is shown normally.  In Under-deeps mode the map
 * image is desaturated and darkened with a brownish tint.  In both modes
 * every company dot is rendered at its surface-map coordinates, but dots
 * belonging to the *other* level are rendered at very low opacity so the
 * player's attention is drawn to the current level's companies.
 */

import type {
  PlayerView,
  CardDefinition,
  Company,
  OpponentCompanyView,
  AgentInPlay,
  OpponentAgentView,
} from '@meccg/shared';
import { getUnderDeepsCoordinates } from './map-under-deeps.js';
import { getMapMode, setMapMode, isOnCurrentLevel } from './map-mode.js';
import { resolveCardDef } from './company-site.js';
import { createCombatMarker } from './map-radar.js';
import {
  DIM_CLASS,
  appendSpreadDots,
  buildMovementLinesLayer,
  resolveAgentPosition,
  resolveHomesitePosition,
  resolveSitePosition,
} from './map-markers.js';

/**
 * Open the full-screen map overlay.
 *
 * @param view - The current player's view.
 * @param activeCompanyIndex - Index of the currently focused company.
 * @param cardPool - Card definition pool for site name lookups.
 * @param onSelectCompany - Callback with the company index when a dot is clicked.
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

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKeyDown);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // Inner container
  const inner = document.createElement('div');
  inner.className = 'map-fullscreen-inner';
  overlay.appendChild(inner);

  // Close button (top-right)
  const closeBtn = document.createElement('button');
  closeBtn.className = 'map-fullscreen-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close map';
  closeBtn.addEventListener('click', () => {
    close();
    document.removeEventListener('keydown', onKeyDown);
  });
  inner.appendChild(closeBtn);

  // Mode buttons (top-left): Surface | Under-deeps
  const layerBar = document.createElement('div');
  layerBar.className = 'map-layer-bar';

  const surfaceBtn = document.createElement('button');
  surfaceBtn.className = 'map-layer-btn';
  surfaceBtn.textContent = 'Surface';

  const underDeepsBtn = document.createElement('button');
  underDeepsBtn.className = 'map-layer-btn';
  underDeepsBtn.textContent = 'Under-deeps';

  layerBar.appendChild(surfaceBtn);
  layerBar.appendChild(underDeepsBtn);
  inner.appendChild(layerBar);

  // Map container
  const mapContainer = document.createElement('div');
  mapContainer.className = 'map-fullscreen-map';
  inner.appendChild(mapContainer);

  /** Update button active states to match the current mode. */
  const syncButtons = () => {
    const m = getMapMode();
    surfaceBtn.classList.toggle('map-layer-btn--active', m === 'surface');
    underDeepsBtn.classList.toggle('map-layer-btn--active', m === 'under-deeps');
  };

  /** Render the map and all dots into mapContainer for the current mode. */
  const renderMap = () => {
    mapContainer.innerHTML = '';
    const mode = getMapMode();

    // Map image — always the surface map image; styled per mode
    const mapImg = document.createElement('img');
    mapImg.src = '/images/map-middle-earth.jpg';
    mapImg.className = mode === 'under-deeps'
      ? 'map-fullscreen-img map-fullscreen-img--under-deeps'
      : 'map-fullscreen-img';
    mapImg.alt = 'Middle-Earth Map';
    mapContainer.appendChild(mapImg);

    // Brownish colour overlay in Under-deeps mode
    if (mode === 'under-deeps') {
      const colorOverlay = document.createElement('div');
      colorOverlay.className = 'map-underdeeps-color-overlay';
      mapContainer.appendChild(colorOverlay);
    }

    // Movement lines (always shown)
    const moveLines = buildMovementLinesLayer(view, cardPool, '0.4');
    if (moveLines) mapContainer.appendChild(moveLines);

    // Dots layer
    const dotsLayer = document.createElement('div');
    dotsLayer.className = 'map-fullscreen-dots';
    mapContainer.appendChild(dotsLayer);

    const pendingDots: Array<{ dot: HTMLElement; x: number; y: number; siteName: string; siteDef: CardDefinition }> = [];

    // Self companies
    view.self.companies.forEach((company, idx) => {
      const role = idx === activeCompanyIndex ? 'active' : 'own';
      const result = createFullMapDot(company, view, cardPool, role);
      if (!result) return;

      result.dot.addEventListener('click', (e) => {
        e.stopPropagation();
        document.removeEventListener('keydown', onKeyDown);
        close();
        onSelectCompany(idx);
      });

      const dimmed = !isOnCurrentLevel(result.siteName, result.siteDef as { keywords?: readonly string[] });
      if (dimmed) result.dot.classList.add(DIM_CLASS);
      pendingDots.push(result);

      const destDot = createDestinationDot(company, view, cardPool);
      if (destDot) {
        if (dimmed) destDot.classList.add(DIM_CLASS);
        dotsLayer.appendChild(destDot);
      }
    });

    // Opponent companies
    for (const company of view.opponent.companies) {
      const result = createFullMapDot(company, view, cardPool, 'opponent');
      const dimmed = result
        ? !isOnCurrentLevel(result.siteName, result.siteDef as { keywords?: readonly string[] })
        : false;
      if (result) {
        if (dimmed) result.dot.classList.add(DIM_CLASS);
        pendingDots.push(result);
      }

      const dest = resolveSitePosition(company.revealedDestinationSite, view, cardPool);
      if (dest) {
        const destDot = document.createElement('div');
        destDot.className = 'map-dot map-dot--opponent-destination map-dot--full';
        destDot.style.left = `${dest.coords[0] * 100}%`;
        destDot.style.top = `${dest.coords[1] * 100}%`;
        if (dimmed) destDot.classList.add(DIM_CLASS);
        destDot.appendChild(buildDotTooltip(companyLabel(company, view, cardPool), `→ ${dest.name}`));
        dotsLayer.appendChild(destDot);
      }
    }

    // Group overlapping dots and spread them side by side
    const STEP_PX = 14;
    appendSpreadDots(dotsLayer, pendingDots, STEP_PX);

    // Own agents
    for (const agent of view.self.agents) {
      const diamond = createFullMapAgentDiamond(agent, view, cardPool);
      if (diamond) dotsLayer.appendChild(diamond);
    }

    // Revealed opponent agents
    for (const agent of view.opponent.agents) {
      if (!agent.revealed || !agent.characterDefinitionId) continue;
      const diamond = createFullMapOpponentAgentDiamond(agent, cardPool);
      if (diamond) dotsLayer.appendChild(diamond);
    }

    // CvCC combat marker
    const combatMarker = createCombatMarker(view, cardPool, true);
    if (combatMarker) dotsLayer.appendChild(combatMarker);

    // Hidden-agents badge
    const hiddenAgentCount = view.opponent.agents.filter((a) => !a.revealed).length;
    if (hiddenAgentCount > 0) {
      const badge = document.createElement('div');
      badge.className = 'map-hidden-agents-badge';
      badge.textContent = `${hiddenAgentCount} hidden agent${hiddenAgentCount === 1 ? '' : 's'}`;
      mapContainer.appendChild(badge);
    }
  };

  // Initial render
  syncButtons();
  renderMap();

  surfaceBtn.addEventListener('click', () => {
    if (getMapMode() === 'surface') return;
    setMapMode('surface');
    syncButtons();
    renderMap();
  });

  underDeepsBtn.addEventListener('click', () => {
    if (getMapMode() === 'under-deeps') return;
    setMapMode('under-deeps');
    syncButtons();
    renderMap();
  });

  document.body.appendChild(overlay);
}

/**
 * Create a destination dot for a self company that has declared movement.
 * Returns null if no destination or coordinates are unavailable.
 */
function createDestinationDot(
  company: Company,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  const dest = resolveSitePosition(company.destinationSite, view, cardPool);
  if (!dest) return null;

  const dot = document.createElement('div');
  dot.className = 'map-dot map-dot--destination map-dot--full';
  dot.style.left = `${dest.coords[0] * 100}%`;
  dot.style.top = `${dest.coords[1] * 100}%`;
  dot.appendChild(buildDotTooltip(companyLabel(company, view, cardPool), `→ ${dest.name}`));

  return dot;
}

/**
 * Build the two-line hover tooltip used by every full-map marker: a bold-ish
 * primary label over a dimmed secondary line (site name, destination, …).
 */
function buildDotTooltip(primary: string, secondary: string): HTMLElement {
  const tooltip = document.createElement('div');
  tooltip.className = 'map-dot-tooltip';
  const line1 = document.createElement('div');
  line1.textContent = primary;
  const line2 = document.createElement('div');
  line2.textContent = secondary;
  line2.style.opacity = '0.75';
  tooltip.appendChild(line1);
  tooltip.appendChild(line2);
  return tooltip;
}

/** Derive a short company label, e.g. "Gandalf's Company". */
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
 * Create a positioned dot for the full map.
 * Returns null (no dot) if the site has no surface-map coordinates.
 * Returns an object with the dot element, its position, and its site name
 * so the caller can apply level-based opacity.
 */
function createFullMapDot(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  role: 'active' | 'own' | 'opponent',
): { dot: HTMLElement; x: number; y: number; siteName: string; siteDef: CardDefinition } | null {
  const site = resolveSitePosition(company.currentSite, view, cardPool);
  if (!site) return null;

  const [x, y] = site.coords;
  const dot = document.createElement('div');
  dot.className = `map-dot map-dot--${role} map-dot--full`;
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${y * 100}%`;

  const label = companyLabel(company, view, cardPool);
  dot.title = `${label} — ${site.name}`;
  dot.appendChild(buildDotTooltip(label, site.name));

  return { dot, x, y, siteName: site.name, siteDef: site.def };
}

/** Create a full-map agent diamond for one of the player's own agents. */
function createFullMapAgentDiamond(
  agent: AgentInPlay,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  const { coords, siteName } = resolveAgentPosition(agent, view, cardPool);
  if (!coords) return null;

  const [x, y] = coords;
  const diamond = document.createElement('div');
  const revealedClass = agent.revealed ? 'map-agent--own-revealed' : 'map-agent--own-hidden';
  diamond.className = `map-agent ${revealedClass} map-agent--full`;
  diamond.style.left = `${x * 100}%`;
  diamond.style.top = `${y * 100}%`;

  if (!isOnCurrentLevel(siteName)) diamond.classList.add("map-agent--other-level");

  const agentName = cardPool[agent.character.definitionId]?.name ?? 'Unknown agent';
  diamond.appendChild(buildDotTooltip(agentName, siteName));

  return diamond;
}

/** Create a full-map diamond marker for a revealed opponent agent at its homesite. */
function createFullMapOpponentAgentDiamond(
  agent: OpponentAgentView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  const agentDef = agent.characterDefinitionId ? cardPool[agent.characterDefinitionId as string] : undefined;
  const home = resolveHomesitePosition(agentDef);
  if (!home) return null;

  const [x, y] = home.coords;
  const agentName = (agentDef as { name?: string }).name ?? 'Agent';
  const diamond = document.createElement('div');
  diamond.className = 'map-agent map-agent--opponent-revealed map-agent--full';
  diamond.style.left = `${x * 100}%`;
  diamond.style.top = `${y * 100}%`;
  if (!isOnCurrentLevel(home.name)) diamond.classList.add('map-agent--other-level');
  diamond.appendChild(buildDotTooltip(agentName, `${home.name} (home)`));

  return diamond;
}

// Keep import to suppress unused-import errors — under-deeps coord loading
// is triggered from game-entry.ts; this file only needs the type.
void (getUnderDeepsCoordinates as unknown);
