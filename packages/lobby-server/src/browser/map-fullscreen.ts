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
 */

import type {
  PlayerView,
  CardDefinition,
  Company,
  OpponentCompanyView,
} from '@meccg/shared';
import { getCoordinates } from './map-coordinates.js';
import { resolveCardDef } from './company-site.js';

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

  // Map image container
  const mapContainer = document.createElement('div');
  mapContainer.className = 'map-fullscreen-map';
  inner.appendChild(mapContainer);

  // Background map image
  const mapImg = document.createElement('img');
  mapImg.src = '/images/map-middle-earth.svg';
  mapImg.className = 'map-fullscreen-img';
  mapImg.alt = 'Middle-Earth Map';
  mapContainer.appendChild(mapImg);

  // Dots layer
  const dotsLayer = document.createElement('div');
  dotsLayer.className = 'map-fullscreen-dots';
  mapContainer.appendChild(dotsLayer);

  // Self companies
  view.self.companies.forEach((company, idx) => {
    const role = idx === activeCompanyIndex ? 'active' : 'own';
    const dot = createFullMapDot(company, view, cardPool, role);
    if (!dot) return;

    // Self company dots are always clickable — clicking selects and closes
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      document.removeEventListener('keydown', onKeyDown);
      close();
      onSelectCompany(idx);
    });

    dotsLayer.appendChild(dot);
  });

  // Opponent companies
  for (const company of view.opponent.companies) {
    const dot = createFullMapDot(company, view, cardPool, 'opponent');
    if (dot) dotsLayer.appendChild(dot);
  }

  document.body.appendChild(overlay);
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

  // Tooltip
  dot.title = siteDef.name;

  // Hover tooltip with site name
  const tooltip = document.createElement('div');
  tooltip.className = 'map-dot-tooltip';
  tooltip.textContent = siteDef.name;
  dot.appendChild(tooltip);

  return dot;
}
