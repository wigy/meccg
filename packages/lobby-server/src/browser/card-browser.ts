/**
 * @module card-browser
 *
 * Left pane of the deck editor: a filter bar and scrollable card grid.
 * Displays the full card pool with thumbnails; clicking adds a card to the
 * active deck and right-clicking removes one copy.
 */

import { cardImageProxyPath } from '@meccg/shared';
import type { CardDefinition } from '@meccg/shared';
import { showCardTooltip, hideCardTooltip } from './card-detail.js';

/** Active filter state for the card browser. */
export interface FilterState {
  name: string;
  sets: Set<string>;
  alignments: Set<string>;
  types: Set<string>;
  races: Set<string>;
  siteTypes: Set<string>;
}

/** Derive the set code from a card ID (e.g. "tw-156" → "TW"). */
function setFromId(id: string): string {
  return id.split('-')[0].toUpperCase();
}

/** Map a cardType string to the broad category used in filters. */
function broadType(cardType: string): string {
  if (cardType.includes('character')) return 'character';
  if (cardType.includes('site')) return 'site';
  if (cardType === 'hazard-creature') return 'creature';
  if (cardType.includes('hazard')) return 'hazard';
  if (cardType === 'region') return 'region';
  return 'resource';
}

/** Determine the deck section a card belongs to. */
export function deckSection(
  cardType: string,
): 'characters' | 'resources' | 'hazards' | 'sites' | null {
  if (cardType.includes('character')) return 'characters';
  if (cardType.includes('site')) return 'sites';
  if (cardType.includes('hazard') || cardType === 'hazard-creature') return 'hazards';
  if (cardType === 'region') return null;
  return 'resources';
}

/** Return true if a card matches the current filter state. */
function matches(def: CardDefinition, f: FilterState): boolean {
  const d = def as unknown as Record<string, unknown>;
  if (f.name) {
    if (!def.name.toLowerCase().includes(f.name.toLowerCase())) return false;
  }
  if (f.sets.size > 0 && !f.sets.has(setFromId(def.id as string))) return false;
  const align = typeof d.alignment === 'string' ? d.alignment : '';
  if (f.alignments.size > 0 && !f.alignments.has(align)) return false;
  const btype = broadType(def.cardType as string);
  if (f.types.size > 0 && !f.types.has(btype)) return false;
  const race = typeof d.race === 'string' ? d.race : '';
  if (f.races.size > 0 && !f.races.has(race)) return false;
  const siteType = typeof d.siteType === 'string' ? d.siteType : '';
  if (f.siteTypes.size > 0 && !f.siteTypes.has(siteType)) return false;
  return true;
}

/** Collect all unique races and site types from the card pool. */
function collectOptions(pool: Readonly<Record<string, CardDefinition>>): {
  races: string[];
  siteTypes: string[];
} {
  const races = new Set<string>();
  const siteTypes = new Set<string>();
  for (const def of Object.values(pool)) {
    const d = def as unknown as Record<string, unknown>;
    if (typeof d.race === 'string') races.add(d.race);
    if (typeof d.siteType === 'string') siteTypes.add(d.siteType);
  }
  return {
    races: [...races].sort(),
    siteTypes: [...siteTypes].sort(),
  };
}

/** Create a filter chip toggle button. */
function makeChip(
  label: string,
  value: string,
  active: boolean,
  onToggle: (value: string, active: boolean) => void,
): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'de-chip' + (active ? ' de-chip--active' : '');
  btn.textContent = label;
  btn.type = 'button';
  btn.addEventListener('click', () => {
    const isNowActive = !btn.classList.contains('de-chip--active');
    btn.classList.toggle('de-chip--active', isNowActive);
    onToggle(value, isNowActive);
  });
  return btn;
}

interface BrowserState {
  filter: FilterState;
  pool: Readonly<Record<string, CardDefinition>>;
  getDeckCount: (cardId: string) => number;
  onAdd: (def: CardDefinition) => void;
  onRemove: (def: CardDefinition) => void;
  gridEl: HTMLElement;
}

let state: BrowserState | null = null;

/** Render the card grid based on current filter. */
function renderGrid(): void {
  if (!state) return;
  const { filter, pool, getDeckCount, onAdd, onRemove, gridEl } = state;

  const filtered = Object.values(pool).filter(
    (def) => def.cardType !== 'region' && matches(def, filter),
  );

  // Sort: alphabetically by name.
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  gridEl.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'de-grid-empty';
    empty.textContent = 'No cards match the current filters.';
    gridEl.appendChild(empty);
    return;
  }

  // Loading skeleton while images load
  for (let i = 0; i < filtered.length; i++) {
    const def = filtered[i];
    const d = def as unknown as Record<string, unknown>;
    const cardId = def.id as string;
    const count = getDeckCount(cardId);
    const btype = broadType(def.cardType as string);

    const cell = document.createElement('div');
    cell.className = 'de-card-cell';
    cell.dataset.cardId = cardId;
    cell.style.animationDelay = `${Math.min(i, 30) * 20}ms`;
    if (count > 0) cell.classList.add('de-card-cell--in-deck');

    // Card art area
    const art = document.createElement('div');
    art.className = `de-card-art de-card-art--${btype}`;

    const imgPath = cardImageProxyPath(def);
    if (imgPath) {
      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      img.loading = 'lazy';
      img.className = 'de-card-img';
      art.appendChild(img);
    }

    // In-deck count badge
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'de-card-count';
      badge.textContent = String(count);
      art.appendChild(badge);
    }

    cell.appendChild(art);

    // Info strip
    const info = document.createElement('div');
    info.className = 'de-card-info';

    const namEl = document.createElement('div');
    namEl.className = 'de-card-name';
    namEl.textContent = def.name;
    info.appendChild(namEl);

    const tag = document.createElement('span');
    tag.className = `de-card-tag de-card-tag--${btype}`;
    tag.textContent = (typeof d.cardType === 'string' ? d.cardType : '').replace(/-/g, ' ');
    info.appendChild(tag);

    cell.appendChild(info);

    // Click: add; right-click: remove
    cell.addEventListener('click', (e) => {
      e.preventDefault();
      onAdd(def);
    });
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onRemove(def);
    });

    gridEl.appendChild(cell);
  }
}

/** Initialise the card browser in the given containers. */
export function initCardBrowser(
  filterContainer: HTMLElement,
  gridContainer: HTMLElement,
  pool: Readonly<Record<string, CardDefinition>>,
  getDeckCount: (cardId: string) => number,
  onAdd: (def: CardDefinition) => void,
  onRemove: (def: CardDefinition) => void,
): FilterState {
  const filter: FilterState = {
    name: '',
    sets: new Set(),
    alignments: new Set(),
    types: new Set(),
    races: new Set(),
    siteTypes: new Set(),
  };

  state = { filter, pool, getDeckCount, onAdd, onRemove, gridEl: gridContainer };

  const { races, siteTypes } = collectOptions(pool);

  // ----- Filter panel -----
  filterContainer.innerHTML = '';

  function section(title: string): HTMLElement {
    const sec = document.createElement('div');
    sec.className = 'de-filter-section';
    const h = document.createElement('div');
    h.className = 'de-filter-heading';
    h.textContent = title;
    sec.appendChild(h);
    return sec;
  }

  // Name search
  const searchSec = section('Search');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'de-search-input';
  input.placeholder = 'Card name…';
  input.addEventListener('input', () => {
    filter.name = input.value;
    renderGrid();
  });
  searchSec.appendChild(input);
  filterContainer.appendChild(searchSec);

  // Set filter
  const setSec = section('Set');
  const chips = document.createElement('div');
  chips.className = 'de-chips';
  for (const s of ['TW', 'AS', 'LE', 'DM', 'TD', 'WH', 'BA']) {
    chips.appendChild(makeChip(s, s, false, (val, active) => {
      if (active) filter.sets.add(val); else filter.sets.delete(val);
      renderGrid();
    }));
  }
  setSec.appendChild(chips);
  filterContainer.appendChild(setSec);

  // Alignment filter
  const alignSec = section('Alignment');
  const alignChips = document.createElement('div');
  alignChips.className = 'de-chips';
  for (const a of ['wizard', 'ringwraith', 'fallen-wizard', 'balrog']) {
    alignChips.appendChild(makeChip(a, a, false, (val, active) => {
      if (active) filter.alignments.add(val); else filter.alignments.delete(val);
      renderGrid();
    }));
  }
  alignSec.appendChild(alignChips);
  filterContainer.appendChild(alignSec);

  // Type filter
  const typeSec = section('Type');
  const typeChips = document.createElement('div');
  typeChips.className = 'de-chips';
  for (const [label, val] of [
    ['Character', 'character'],
    ['Resource', 'resource'],
    ['Hazard', 'hazard'],
    ['Creature', 'creature'],
    ['Site', 'site'],
  ] as [string, string][]) {
    typeChips.appendChild(makeChip(label, val, false, (v, active) => {
      if (active) filter.types.add(v); else filter.types.delete(v);
      renderGrid();
    }));
  }
  typeSec.appendChild(typeChips);
  filterContainer.appendChild(typeSec);

  // Race filter (characters only)
  if (races.length > 0) {
    const raceSec = section('Race');
    const raceChips = document.createElement('div');
    raceChips.className = 'de-chips';
    for (const r of races) {
      raceChips.appendChild(makeChip(r, r, false, (val, active) => {
        if (active) filter.races.add(val); else filter.races.delete(val);
        renderGrid();
      }));
    }
    raceSec.appendChild(raceChips);
    filterContainer.appendChild(raceSec);
  }

  // Site type filter
  if (siteTypes.length > 0) {
    const siteSec = section('Site Type');
    const siteChips = document.createElement('div');
    siteChips.className = 'de-chips';
    for (const st of siteTypes) {
      siteChips.appendChild(makeChip(st.replace(/-/g, ' '), st, false, (val, active) => {
        if (active) filter.siteTypes.add(val); else filter.siteTypes.delete(val);
        renderGrid();
      }));
    }
    siteSec.appendChild(siteChips);
    filterContainer.appendChild(siteSec);
  }

  // Clear filters button
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'de-clear-filters';
  clearBtn.textContent = 'Clear Filters';
  clearBtn.addEventListener('click', () => {
    filter.name = '';
    filter.sets.clear();
    filter.alignments.clear();
    filter.types.clear();
    filter.races.clear();
    filter.siteTypes.clear();
    input.value = '';
    for (const chip of filterContainer.querySelectorAll<HTMLElement>('.de-chip--active')) {
      chip.classList.remove('de-chip--active');
    }
    renderGrid();
  });
  filterContainer.appendChild(clearBtn);

  // Tooltip on hover
  gridContainer.addEventListener('mouseover', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.de-card-cell');
    if (!cell?.dataset.cardId) return;
    const def = pool[cell.dataset.cardId];
    if (def) showCardTooltip(def, cell);
  });
  gridContainer.addEventListener('mouseout', () => hideCardTooltip());

  // Keyboard shortcut: `/` focuses search
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
    } else if (e.key === 'Escape' && document.activeElement === input) {
      input.blur();
    }
  });

  renderGrid();
  return filter;
}

/** Redraw the card grid — call after deck changes to update count badges. */
export function refreshCardGrid(): void {
  renderGrid();
}

/** Apply filter state from URL search params. */
export function applyUrlFilters(params: URLSearchParams): void {
  if (!state) return;
  const { filter } = state;

  const name = params.get('q') ?? '';
  filter.name = name;

  for (const s of (params.get('sets') ?? '').split(',').filter(Boolean)) filter.sets.add(s);
  for (const a of (params.get('align') ?? '').split(',').filter(Boolean)) filter.alignments.add(a);
  for (const t of (params.get('type') ?? '').split(',').filter(Boolean)) filter.types.add(t);

  renderGrid();
}
