/**
 * @module map-site-picker
 *
 * Map-based movement destination picker. Instead of scanning the site deck
 * as a card grid, the player picks where a company goes directly on the map
 * of Middle-earth: every site the engine offers a `plan-movement` action for
 * is drawn as a clickable marker at its map position, hovering a marker
 * previews the site card and a typical route from the company's current site,
 * and clicking it sends that exact legal action.
 *
 * The card grid ({@link openMovementViewer}) stays available — the picker has
 * a "Show as cards" button, the grid a matching "Show on map" button, and the
 * last choice is remembered in `localStorage` so players who prefer the grid
 * keep getting it.
 *
 * Purely a UI layer: destinations come from the legal actions
 * ({@link collectMovementDestinations}), so the picker can never offer a move
 * the engine would reject, and the route preview is informational only (the
 * route itself is still declared in the movement/hazard phase).
 */

import type {
  PlayerView,
  CardDefinition,
  GameAction,
  RegionType,
  SiteCard,
  MovementMap,
} from '@meccg/shared';
import { buildMovementMap, findRegionPaths, isSiteCard } from '@meccg/shared';
import { getCoordinates, areCoordinatesLoaded, loadCoordinates } from './map-coordinates.js';
import { isOnCurrentLevel } from './map-mode.js';
import { appendSpreadDots, SVG_NS } from './map-markers.js';
import { createMapOverlay, companyLabel } from './map-fullscreen.js';
import { collectMovementDestinations, openMovementViewer, type MovementDestination } from './render-piles.js';
import { buildCardPreviewInfo } from './render-card-preview.js';
import { createRegionTypeIcon } from './render-utils.js';

// ---- View preference ----

/** Which destination view clicking a movable site opens. */
export type MovementPickerView = 'map' | 'cards';

const PREF_STORAGE_KEY = 'meccg-movement-picker';

/** Below this viewport width the map is too cramped to click reliably, so the grid is the default. */
const NARROW_SCREEN_PX = 900;

/**
 * The remembered destination view. Defaults to the map on desktop and to the
 * card grid on narrow screens, until the player switches view once.
 */
export function getMovementPickerPreference(): MovementPickerView {
  try {
    const v = localStorage.getItem(PREF_STORAGE_KEY);
    if (v === 'map' || v === 'cards') return v;
  } catch { /* storage unavailable */ }
  const width = typeof window !== 'undefined' ? (window as { innerWidth?: number }).innerWidth : undefined;
  return width !== undefined && width < NARROW_SCREEN_PX ? 'cards' : 'map';
}

/** Remember the player's preferred destination view. */
export function setMovementPickerPreference(v: MovementPickerView): void {
  try { localStorage.setItem(PREF_STORAGE_KEY, v); } catch { /* quota or private mode */ }
}

/**
 * Open the destination picker for a company in the player's preferred view.
 * Falls back to the card grid during the tutorial (whose instructions walk
 * through the grid) and while the map coordinates are still loading.
 */
export function openMovementPicker(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyId: string,
  onAction: (action: GameAction) => void,
): void {
  const inTutorial = typeof document !== 'undefined' && document.body?.classList?.contains('in-tutorial') === true;
  if (inTutorial || getMovementPickerPreference() === 'cards' || !areCoordinatesLoaded()) {
    if (!areCoordinatesLoaded()) void loadCoordinates().catch(() => {});
    openMovementGrid(view, cardPool, companyId, onAction);
    return;
  }
  openMovementMap(view, cardPool, companyId, onAction);
}

/** Open the card-grid view with a "Show on map" button leading back to the map. */
function openMovementGrid(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyId: string,
  onAction: (action: GameAction) => void,
): void {
  const onShowMap = areCoordinatesLoaded()
    ? () => {
      setMovementPickerPreference('map');
      openMovementMap(view, cardPool, companyId, onAction);
    }
    : undefined;
  openMovementViewer(view, cardPool, companyId, onAction, onShowMap);
}

// ---- Route preview (pure) ----

/** A typical route from the company's current site to a destination, for preview only. */
export interface RoutePreview {
  /** Starter movement's site path (region types), or null if starter movement cannot reach it. */
  readonly starter: readonly RegionType[] | null;
  /** Shortest region-movement path (region names, origin and destination region included), or null. */
  readonly regions: readonly string[] | null;
  /** Region types along {@link regions}, in order. */
  readonly regionTypes: readonly RegionType[];
}

/** Per-pool cache of the movement map and region-name → region-type lookup. */
const movementDataCache = new WeakMap<object, { map: MovementMap; regionTypes: Map<string, RegionType> }>();

/** Build (once per card pool) the region graph used for route previews. */
function getMovementData(cardPool: Readonly<Record<string, CardDefinition>>): { map: MovementMap; regionTypes: Map<string, RegionType> } {
  let data = movementDataCache.get(cardPool);
  if (!data) {
    const regionTypes = new Map<string, RegionType>();
    for (const def of Object.values(cardPool)) {
      if (def.cardType === 'region') regionTypes.set(def.name, def.regionType);
    }
    data = { map: buildMovementMap(cardPool), regionTypes };
    movementDataCache.set(cardPool, data);
  }
  return data;
}

/**
 * Work out how a company could typically travel from `originDef` to
 * `destDef`: the starter-movement site path when the move is to or from the
 * relevant haven, and the shortest region path (at most four regions).
 *
 * This is a preview built from printed card data only — card effects that
 * add adjacency or change the region limit are not reflected, which is why
 * the UI labels it a "typical route". The engine still decides the real
 * options when the path is declared.
 */
export function computeRoutePreview(
  originDef: CardDefinition | undefined,
  destDef: CardDefinition | undefined,
  cardPool: Readonly<Record<string, CardDefinition>>,
): RoutePreview {
  if (!originDef || !destDef || !isSiteCard(originDef) || !isSiteCard(destDef)) {
    return { starter: null, regions: null, regionTypes: [] };
  }
  const starter = starterPath(originDef, destDef);

  const { map, regionTypes } = getMovementData(cardPool);
  let regions: string[] | null = null;
  if (map.regionGraph.has(originDef.region) && map.regionGraph.has(destDef.region)) {
    for (const path of findRegionPaths(map, originDef.region, destDef.region)) {
      if (!regions || path.length < regions.length) regions = path;
    }
  }
  const types = (regions ?? []).map(r => regionTypes.get(r)).filter((t): t is RegionType => t !== undefined);
  return { starter, regions, regionTypes: types };
}

/** The starter-movement site path between two sites, or null if starter movement does not connect them. */
function starterPath(origin: SiteCard, dest: SiteCard): readonly RegionType[] | null {
  const originIsHaven = origin.siteType === 'haven';
  const destIsHaven = dest.siteType === 'haven';
  if (originIsHaven && destIsHaven) return origin.havenPaths?.[dest.name] ?? null;
  if (originIsHaven && dest.nearestHaven === origin.name) return dest.sitePath;
  if (destIsHaven && origin.nearestHaven === dest.name) return origin.sitePath;
  return null;
}

// ---- Marker placement (pure) ----

/** A destination with a resolved map position. */
export interface PlacedDestination {
  readonly dest: MovementDestination;
  readonly def: CardDefinition;
  /** [x, y] fractions of the map image. */
  readonly coords: [number, number];
  /** True when the site itself has no coordinates and its region centroid is used instead. */
  readonly approximate: boolean;
}

/**
 * Resolve each destination to a map position: the site's own coordinates,
 * else its region's centroid. Destinations with neither (or an unknown
 * definition) are returned in `unplaced` so the picker can list them in a
 * fallback strip — no legal destination is ever unreachable.
 */
export function placeDestinations(
  destinations: readonly MovementDestination[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): { placed: PlacedDestination[]; unplaced: Array<{ dest: MovementDestination; def: CardDefinition | undefined }> } {
  const placed: PlacedDestination[] = [];
  const unplaced: Array<{ dest: MovementDestination; def: CardDefinition | undefined }> = [];
  for (const dest of destinations) {
    const def = cardPool[dest.defId];
    const own = def ? getCoordinates(def.name) : null;
    if (def && own) {
      placed.push({ dest, def, coords: own, approximate: false });
      continue;
    }
    const region = def && isSiteCard(def) ? getCoordinates(def.region) : null;
    if (def && region) {
      placed.push({ dest, def, coords: region, approximate: true });
      continue;
    }
    unplaced.push({ dest, def });
  }
  return { placed, unplaced };
}

// ---- The overlay ----

/** Spacing between markers that share a map position. */
const MARKER_STEP_PX = 20;

/** Short label for a site type, used in marker tooltips and the legend. */
function siteTypeLabel(def: CardDefinition): string {
  return isSiteCard(def) ? def.siteType.replace(/-/g, ' ') : 'site';
}

/**
 * Open the map picker for a company's movement destination.
 *
 * @param view - The current player view (its legal actions define the destinations).
 * @param cardPool - Card definitions for names, regions and images.
 * @param companyId - The company declaring movement.
 * @param onAction - Receives the chosen `plan-movement` action.
 */
export function openMovementMap(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyId: string,
  onAction: (action: GameAction) => void,
): void {
  const company = view.self.companies.find(c => (c.id as string) === companyId);
  const originDef = company?.currentSite ? cardPool[company.currentSite.definitionId as string] : undefined;
  const originCoords = originDef ? getCoordinates(originDef.name) : null;
  const destinations = collectMovementDestinations(view, companyId);
  const { placed, unplaced } = placeDestinations(destinations, cardPool);
  const destDefIds = new Set(destinations.map(d => d.defId));

  // Site-deck sites the company cannot reach this turn: shown dimmed so the
  // player sees where the rest of their deck lies.
  const otherDeckSites: Array<{ def: CardDefinition; coords: [number, number] }> = [];
  const seenOther = new Set<string>();
  for (const card of view.self.siteDeck) {
    const defId = card.definitionId as string;
    if (destDefIds.has(defId) || seenOther.has(defId)) continue;
    seenOther.add(defId);
    const def = cardPool[defId];
    const coords = def ? getCoordinates(def.name) : null;
    if (def && coords) otherDeckSites.push({ def, coords });
  }

  let routeLayer: SVGSVGElement | null = null;
  let hovered: PlacedDestination | null = null;

  /** Choose a destination: close the picker and send its action. */
  const choose = (dest: MovementDestination): void => {
    overlay.close();
    onAction(dest.action.action);
  };

  const overlay = createMapOverlay((mapContainer) => {
    routeLayer = document.createElementNS(SVG_NS, 'svg');
    routeLayer.setAttribute('class', 'map-picker-route');
    routeLayer.setAttribute('viewBox', '0 0 100 100');
    routeLayer.setAttribute('preserveAspectRatio', 'none');
    mapContainer.appendChild(routeLayer);

    const layer = document.createElement('div');
    layer.className = 'map-fullscreen-dots map-picker-markers';
    mapContainer.appendChild(layer);

    for (const { def, coords } of otherDeckSites) {
      const marker = document.createElement('div');
      marker.className = `map-site-marker map-site-marker--unreachable map-site-marker--${isSiteCard(def) ? def.siteType : 'site'}`;
      positionMarker(marker, coords);
      marker.title = `${def.name} — not reachable this turn`;
      layer.appendChild(marker);
    }

    const pending: Array<{ dot: HTMLElement; x: number; y: number }> = [];
    for (const p of placed) {
      const marker = buildDestinationMarker(p, choose, (target) => showPreview(target));
      pending.push({ dot: marker, x: p.coords[0], y: p.coords[1] });
    }
    appendSpreadDots(layer, pending, MARKER_STEP_PX);

    if (originDef && originCoords) {
      const origin = document.createElement('div');
      origin.className = 'map-site-marker map-site-marker--origin';
      positionMarker(origin, originCoords);
      origin.title = `${originDef.name} — current site`;
      layer.appendChild(origin);
    }

    if (hovered) drawRoute(hovered);
  }, 'map-picker-overlay');

  const { inner } = overlay;

  // Header: which company, what to do, and the switch to the card grid.
  const header = document.createElement('div');
  header.className = 'map-picker-header';
  const title = document.createElement('div');
  title.className = 'map-picker-title';
  const label = company ? companyLabel(company, view, cardPool) : 'Company';
  title.textContent = `Move ${label}`;
  header.appendChild(title);
  const hint = document.createElement('div');
  hint.className = 'map-picker-hint';
  hint.textContent = placed.length + unplaced.length > 0
    ? `Click a highlighted site to move ${label} there`
    : 'No site can be reached this turn';
  header.appendChild(hint);
  const cardsBtn = document.createElement('button');
  cardsBtn.className = 'map-picker-cards-btn';
  cardsBtn.textContent = 'Show as cards';
  cardsBtn.addEventListener('click', () => {
    setMovementPickerPreference('cards');
    overlay.close();
    openMovementGrid(view, cardPool, companyId, onAction);
  });
  header.appendChild(cardsBtn);
  inner.appendChild(header);

  // Side panel previewing the hovered destination.
  const preview = document.createElement('div');
  preview.className = 'map-picker-preview hidden';
  inner.appendChild(preview);

  inner.appendChild(buildLegend());

  if (unplaced.length > 0) {
    const strip = document.createElement('div');
    strip.className = 'map-picker-fallback';
    const stripLabel = document.createElement('span');
    stripLabel.textContent = 'Other destinations:';
    strip.appendChild(stripLabel);
    for (const { dest, def } of unplaced) {
      const btn = document.createElement('button');
      btn.className = 'map-picker-fallback-btn';
      btn.textContent = def?.name ?? dest.defId;
      if (dest.action.viable) {
        btn.addEventListener('click', () => choose(dest));
      } else {
        btn.disabled = true;
        if (dest.action.reason) btn.title = dest.action.reason;
      }
      strip.appendChild(btn);
    }
    inner.appendChild(strip);
  }

  /** Fill the side panel for a destination and draw its route. */
  function showPreview(target: PlacedDestination | null): void {
    hovered = target;
    preview.innerHTML = '';
    if (!target) {
      preview.classList.add('hidden');
      clearRoute();
      return;
    }
    preview.classList.remove('hidden');
    preview.appendChild(buildCardPreviewInfo(target.def));
    const route = computeRoutePreview(originDef, target.def, cardPool);
    preview.appendChild(buildRouteSummary(route, target));
    drawRoute(target);
  }

  function clearRoute(): void {
    if (routeLayer) routeLayer.innerHTML = '';
  }

  /** Draw the typical route to a destination on the route layer. */
  function drawRoute(target: PlacedDestination): void {
    clearRoute();
    if (!routeLayer || !originCoords) return;
    const route = computeRoutePreview(originDef, target.def, cardPool);
    if (route.starter) {
      routeLayer.appendChild(polyline([originCoords, target.coords], 'map-picker-route-line map-picker-route-line--starter'));
    }
    if (route.regions) {
      const points: Array<[number, number]> = [originCoords];
      for (const region of route.regions) {
        const c = getCoordinates(region);
        if (c) points.push(c);
      }
      points.push(target.coords);
      routeLayer.appendChild(polyline(points, 'map-picker-route-line map-picker-route-line--region'));
    }
  }
}

/** Place a marker at map-fraction coordinates. */
function positionMarker(el: HTMLElement, coords: [number, number]): void {
  el.style.left = `${coords[0] * 100}%`;
  el.style.top = `${coords[1] * 100}%`;
}

/** Build a clickable (or, for a non-viable action, dimmed) destination marker. */
function buildDestinationMarker(
  p: PlacedDestination,
  choose: (dest: MovementDestination) => void,
  hover: (target: PlacedDestination | null) => void,
): HTMLElement {
  const { dest, def } = p;
  const marker = document.createElement('button');
  const typeClass = `map-site-marker--${isSiteCard(def) ? def.siteType : 'site'}`;
  marker.className = `map-site-marker map-site-marker--selectable ${typeClass}`;
  if (dest.inPlay) marker.classList.add('map-site-marker--in-play');
  if (p.approximate) marker.classList.add('map-site-marker--approximate');
  if (!isOnCurrentLevel(def.name, def as { keywords?: readonly string[] })) marker.classList.add('map-site-marker--other-level');
  marker.dataset.instanceId = dest.instanceId;
  marker.dataset.siteName = def.name;
  positionMarker(marker, p.coords);

  const tooltip = document.createElement('div');
  tooltip.className = 'map-dot-tooltip';
  tooltip.textContent = dest.inPlay
    ? `${def.name} (already in play at another company)`
    : `${def.name} — ${siteTypeLabel(def)}`;
  marker.appendChild(tooltip);

  if (dest.copies > 1) {
    const badge = document.createElement('span');
    badge.className = 'map-site-marker-count';
    badge.textContent = String(dest.copies);
    marker.appendChild(badge);
  }

  if (!dest.action.viable) {
    marker.classList.remove('map-site-marker--selectable');
    marker.classList.add('map-site-marker--unreachable');
    marker.disabled = true;
    if (dest.action.reason) marker.title = dest.action.reason;
    return marker;
  }

  marker.addEventListener('click', (e) => {
    e.stopPropagation();
    choose(dest);
  });
  marker.addEventListener('mouseenter', () => hover(p));
  marker.addEventListener('focus', () => hover(p));
  marker.addEventListener('mouseleave', () => hover(null));
  marker.addEventListener('blur', () => hover(null));
  return marker;
}

/** An SVG polyline through map-fraction points on the 0–100 viewBox. */
function polyline(points: ReadonlyArray<[number, number]>, className: string): SVGPolylineElement {
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('class', className);
  line.setAttribute('points', points.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(' '));
  line.setAttribute('fill', 'none');
  return line;
}

/** Text + region-type icons describing the typical routes to a destination. */
function buildRouteSummary(route: RoutePreview, target: PlacedDestination): HTMLElement {
  const box = document.createElement('div');
  box.className = 'map-picker-route-summary';

  const heading = document.createElement('div');
  heading.className = 'map-picker-route-heading';
  heading.textContent = 'Typical route';
  box.appendChild(heading);

  const row = (labelText: string, types: readonly RegionType[], detail?: string): void => {
    const el = document.createElement('div');
    el.className = 'map-picker-route-row';
    const labelEl = document.createElement('span');
    labelEl.textContent = labelText;
    el.appendChild(labelEl);
    for (const t of types) el.appendChild(createRegionTypeIcon(t, 14));
    if (detail) {
      const d = document.createElement('div');
      d.className = 'map-picker-route-detail';
      d.textContent = detail;
      el.appendChild(d);
    }
    box.appendChild(el);
  };

  if (route.starter) row('Starter:', route.starter);
  if (route.regions) {
    const n = route.regions.length;
    row(`Region (${n} region${n === 1 ? '' : 's'}):`, route.regionTypes, route.regions.join(' → '));
  }
  if (!route.starter && !route.regions) {
    const none = document.createElement('div');
    none.className = 'map-picker-route-detail';
    none.textContent = 'Reached by special movement';
    box.appendChild(none);
  }
  if (target.dest.inPlay) {
    const shared = document.createElement('div');
    shared.className = 'map-picker-route-detail';
    shared.textContent = 'Already in play at another of your companies';
    box.appendChild(shared);
  }
  return box;
}

/** The marker legend shown in a corner of the picker. */
function buildLegend(): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'map-picker-legend';
  const entries: Array<[string, string]> = [
    ['map-site-marker--origin', 'Current site'],
    ['map-site-marker--haven', 'Reachable haven'],
    ['map-site-marker--selectable', 'Reachable site'],
    ['map-site-marker--unreachable', 'Not reachable'],
  ];
  for (const [cls, text] of entries) {
    const item = document.createElement('div');
    item.className = 'map-picker-legend-item';
    const swatch = document.createElement('span');
    swatch.className = `map-site-marker map-site-marker--legend ${cls}`;
    item.appendChild(swatch);
    const t = document.createElement('span');
    t.textContent = text;
    item.appendChild(t);
    legend.appendChild(item);
  }
  const route = document.createElement('div');
  route.className = 'map-picker-legend-item';
  const swatch = document.createElement('span');
  swatch.className = 'map-picker-legend-route';
  route.appendChild(swatch);
  const t = document.createElement('span');
  t.textContent = 'Typical route';
  route.appendChild(t);
  legend.appendChild(route);
  return legend;
}
