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
import { getMapMode, isOnCurrentLevel } from './map-mode.js';
import {
  DIM_CLASS,
  appendSpreadDots,
  buildMovementLinesLayer,
  resolveAgentPosition,
  resolveHomesitePosition,
  resolveSitePosition,
} from './map-markers.js';

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
  const moveLines = buildMovementLinesLayer(view, cardPool, '1');
  if (moveLines) radar.appendChild(moveLines);

  // Dot container — overlaid on the map background
  const dotsLayer = document.createElement('div');
  dotsLayer.className = 'map-dots';
  radar.appendChild(dotsLayer);

  // Collect company dots before appending so overlapping ones can be spread.
  const pendingDots: Array<{ dot: HTMLElement; x: number; y: number }> = [];

  // Render own companies
  view.self.companies.forEach((company, idx) => {
    const placed = createCompanyDot(company, view, cardPool, idx === activeCompanyIndex ? 'active' : 'own');
    const dimmed = placed?.dot.classList.contains(DIM_CLASS) ?? false;
    if (placed) pendingDots.push(placed);

    const destDot = createRadarDestinationDot(company, view, cardPool);
    if (destDot) {
      if (dimmed) destDot.classList.add(DIM_CLASS);
      dotsLayer.appendChild(destDot);
    }
  });

  // Render opponent companies
  view.opponent.companies.forEach((company, idx) => {
    const role = idx === activeOpponentIndex ? 'opponent-active' : 'opponent';
    const placed = createCompanyDot(company, view, cardPool, role);
    const dimmed = placed?.dot.classList.contains(DIM_CLASS) ?? false;
    if (placed) pendingDots.push(placed);

    const dest = resolveSitePosition(company.revealedDestinationSite, view, cardPool);
    if (dest) {
      const destDot = document.createElement('div');
      destDot.className = 'map-dot map-dot--opponent-destination';
      destDot.style.left = `${dest.coords[0] * 100}%`;
      destDot.style.top = `${dest.coords[1] * 100}%`;
      destDot.title = `→ ${dest.name}`;
      if (dimmed) destDot.classList.add(DIM_CLASS);
      dotsLayer.appendChild(destDot);
    }
  });

  // Group company dots sharing the same position and arrange them side by side.
  const STEP_PX = 10; // dot width (8px) + 2px gap
  appendSpreadDots(dotsLayer, pendingDots, STEP_PX);

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

  // CvCC combat marker — crossed swords at the defending company's site
  const combatMarker = createCombatMarker(view, cardPool, false);
  if (combatMarker) dotsLayer.appendChild(combatMarker);

  // Clicking the radar fires a custom event
  radar.addEventListener('click', () => {
    radar.dispatchEvent(new CustomEvent('map-radar-click', { bubbles: true }));
  });

  return radar;
}

/**
 * Create a positioned dot element for one company, together with the position
 * the caller needs to spread co-located dots apart.
 * Returns null if the company has no current site or if the site has no coordinates.
 */
function createCompanyDot(
  company: Company | OpponentCompanyView,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  role: 'active' | 'own' | 'opponent' | 'opponent-active',
): { dot: HTMLElement; x: number; y: number } | null {
  const site = resolveSitePosition(company.currentSite, view, cardPool);
  if (!site) return null;

  const [x, y] = site.coords;

  const dot = document.createElement('div');
  dot.className = `map-dot map-dot--${role}`;
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${y * 100}%`;
  dot.title = site.name;

  if (!isOnCurrentLevel(site.name, site.def as { keywords?: readonly string[] })) dot.classList.add(DIM_CLASS);

  return { dot, x, y };
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
 * Create a radar diamond marker for a revealed opponent agent.
 * The agent's homesite is looked up from its card definition.
 * Returns null if coordinates are unavailable.
 */
function createOpponentAgentDiamond(
  agent: OpponentAgentView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement | null {
  const agentDef = agent.characterDefinitionId ? cardPool[agent.characterDefinitionId as string] : undefined;
  const home = resolveHomesitePosition(agentDef);
  if (!home) return null;

  const [x, y] = home.coords;
  const agentName = (agentDef as { name?: string }).name ?? 'Agent';
  const diamond = document.createElement('div');
  diamond.className = 'map-agent map-agent--opponent-revealed';
  diamond.style.left = `${x * 100}%`;
  diamond.style.top = `${y * 100}%`;
  diamond.title = `${agentName} — ${home.name} (home)`;
  if (!isOnCurrentLevel(home.name)) diamond.classList.add('map-agent--other-level');
  return diamond;
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
  const dest = resolveSitePosition(company.destinationSite, view, cardPool);
  if (!dest) return null;

  const dot = document.createElement('div');
  dot.className = 'map-dot map-dot--destination';
  dot.style.left = `${dest.coords[0] * 100}%`;
  dot.style.top = `${dest.coords[1] * 100}%`;
  dot.title = `→ ${dest.name}`;

  return dot;
}

/**
 * Create a ⚔ crossed-swords marker at the CvCC combat site.
 * Returns null when there is no active CvCC combat or the site has no coordinates.
 * @param fullMap - true for the full-screen map (larger icon), false for the radar.
 */
export function createCombatMarker(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  fullMap: boolean,
): HTMLElement | null {
  if (!view.combat) return null;

  const companyId = view.combat.companyId;

  // Defending company may be ours or the opponent's depending on who is viewing.
  const selfCompany = view.self.companies.find(c => c.id === companyId);
  const oppCompany = view.opponent.companies.find(c => c.id === companyId);
  const currentSite = selfCompany?.currentSite ?? oppCompany?.currentSite ?? null;

  if (!currentSite) return null;

  const site = resolveSitePosition(currentSite, view, cardPool);
  if (!site) return null;

  const marker = document.createElement('div');
  marker.className = fullMap ? 'map-combat-marker map-combat-marker--full' : 'map-combat-marker';
  marker.style.left = `${site.coords[0] * 100}%`;
  marker.style.top = `${site.coords[1] * 100}%`;
  marker.textContent = '⚔';
  marker.title = `CvCC: ${site.name}`;
  return marker;
}
