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
} from '@meccg/shared';
import { getCoordinates } from './map-coordinates.js';
import { getUnderDeepsCoordinates, createUnderDeepsView } from './map-under-deeps.js';
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
): HTMLElement | null {
  const activeCompany = view.self.companies[activeCompanyIndex];
  if (!activeCompany?.currentSite) return null;

  const activeSiteDef = resolveCardDef(activeCompany.currentSite.instanceId, view, cardPool);
  if (!activeSiteDef) return null;

  const activeSiteName = activeSiteDef.name;

  // Check if the active company is at an Under-deeps site
  const isUnderDeeps = getUnderDeepsCoordinates(activeSiteName) !== null;

  if (isUnderDeeps) {
    return createUnderDeepsRadar(view, cardPool, activeCompanyIndex);
  }

  // Surface map radar
  const activeCoords = getCoordinates(activeSiteName);
  // Only show radar when we can place the active company on the map
  if (!activeCoords) return null;

  const radar = document.createElement('div');
  radar.className = 'map-radar';
  radar.title = 'Click to open full map';

  // Map background image
  const mapBg = document.createElement('div');
  mapBg.className = 'map-bg';
  radar.appendChild(mapBg);

  // Dot container — overlaid on the map background
  const dotsLayer = document.createElement('div');
  dotsLayer.className = 'map-dots';
  radar.appendChild(dotsLayer);

  // Render own companies
  view.self.companies.forEach((company, idx) => {
    const dot = createCompanyDot(company, view, cardPool, idx === activeCompanyIndex ? 'active' : 'own');
    if (dot) dotsLayer.appendChild(dot);

    // Destination dot for companies with planned movement
    const destDot = createRadarDestinationDot(company, view, cardPool);
    if (destDot) dotsLayer.appendChild(destDot);
  });

  // Render opponent companies
  for (const company of view.opponent.companies) {
    const dot = createCompanyDot(company, view, cardPool, 'opponent');
    if (dot) dotsLayer.appendChild(dot);
  }

  // Clicking the radar fires a custom event
  radar.addEventListener('click', () => {
    radar.dispatchEvent(new CustomEvent('map-radar-click', { bubbles: true }));
  });

  return radar;
}

/**
 * Create a radar widget showing the Under-deeps schematic scaled to radar size.
 * Used when the active company is at an Under-deeps site.
 */
function createUnderDeepsRadar(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  activeCompanyIndex: number,
): HTMLElement | null {
  const udView = createUnderDeepsView(view, cardPool, activeCompanyIndex);
  if (!udView) return null;

  const radar = document.createElement('div');
  radar.className = 'map-radar map-radar--underdeeps';
  radar.title = 'Click to open full map (Under-deeps)';

  // Scale the Under-deeps view to fit the radar box
  udView.style.width = '100%';
  udView.style.height = '100%';
  radar.appendChild(udView);

  // Small indicator that we're in the Under-deeps layer
  const indicator = document.createElement('span');
  indicator.className = 'map-radar-layer-indicator';
  indicator.textContent = '⛏';
  indicator.title = 'Under-deeps';
  radar.appendChild(indicator);

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
  role: 'active' | 'own' | 'opponent',
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

  return dot;
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
