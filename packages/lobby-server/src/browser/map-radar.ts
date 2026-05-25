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
