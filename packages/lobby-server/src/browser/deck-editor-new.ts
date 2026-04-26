/**
 * @module deck-editor-new
 *
 * Full-featured deck editor: a three-column layout (filter panel | card grid |
 * deck panel) with live validation and auto-save. Replaces the minimal viewer
 * in deck-editor.ts.
 */

import type { CardDefinition } from '@meccg/shared';
import { cardPool, type FullDeck, type DeckListEntry, type ScreenId } from './app-state.js';
import { initCardBrowser, refreshCardGrid, deckSection } from './card-browser.js';
import { renderDeckView, exportDeckText } from './deck-view.js';
import { showAlert, showConfirm } from './dialog.js';

// Forward-declared showScreen, set by the lobby module at startup.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback. */
export function setNewEditorCallbacks(showScreen: (id: ScreenId) => void): void {
  showScreenFn = showScreen;
}

// ----- Mutable editor state -----

let currentDeck: FullDeck | null = null;
let deckId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveIndicator: HTMLElement | null = null;

/** Compute a flattened count map for O(1) deck-count lookups in the card grid. */
function buildCountMap(deck: FullDeck): Map<string, number> {
  const m = new Map<string, number>();
  const all = [
    ...deck.pool,
    ...deck.deck.characters,
    ...deck.deck.resources,
    ...deck.deck.hazards,
    ...deck.sites,
    ...(deck.sideboard ?? []),
  ];
  for (const e of all) {
    if (e.card) m.set(e.card, (m.get(e.card) ?? 0) + e.qty);
  }
  return m;
}

let countMap = new Map<string, number>();

/** Get the number of copies of a card currently in the deck. */
function getDeckCount(cardId: string): number {
  return countMap.get(cardId) ?? 0;
}

// ----- Deck mutation helpers -----

/** Find or create an entry in a section. */
function upsertEntry(entries: DeckListEntry[], cardId: string, name: string): DeckListEntry {
  let entry = entries.find((e) => e.card === cardId);
  if (!entry) {
    entry = { name, card: cardId, qty: 0 };
    entries.push(entry);
  }
  return entry;
}

/** Remove an entry from a section, returning true if removed. */
function removeEntry(entries: DeckListEntry[], cardId: string): boolean {
  const idx = entries.findIndex((e) => e.card === cardId);
  if (idx === -1) return false;
  entries[idx].qty--;
  if (entries[idx].qty <= 0) entries.splice(idx, 1);
  return true;
}

/** Max copies allowed for this card. */
function maxCopies(def: CardDefinition): number {
  const d = def as unknown as { unique?: boolean };
  return d.unique ? 1 : 3;
}

/** Show a brief toast message at the bottom of the screen. */
function showToast(msg: string): void {
  const toast = document.createElement('div');
  toast.className = 'de-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('de-toast--show'));
  setTimeout(() => {
    toast.classList.remove('de-toast--show');
    setTimeout(() => toast.remove(), 300);
  }, 1600);
}

/** Add one copy of a card to the deck. */
function addCard(def: CardDefinition): void {
  if (!currentDeck) return;
  const cardId = def.id as string;
  const current = getDeckCount(cardId);
  const max = maxCopies(def);
  if (current >= max) {
    showToast(`Max ${max} cop${max === 1 ? 'y' : 'ies'} of "${def.name}"`);
    return;
  }
  const section = deckSection(def.cardType as string);
  if (!section) return;
  if (section === 'characters') {
    upsertEntry(currentDeck.pool, cardId, def.name).qty++;
  } else if (section === 'resources') {
    upsertEntry(currentDeck.deck.resources, cardId, def.name).qty++;
  } else if (section === 'hazards') {
    upsertEntry(currentDeck.deck.hazards, cardId, def.name).qty++;
  } else if (section === 'sites') {
    upsertEntry(currentDeck.sites, cardId, def.name).qty++;
  }
  countMap.set(cardId, current + 1);
  scheduleAutoSave();
  refreshAfterChange();
}

/** Remove one copy of a card from the deck (from any section that has it). */
function removeCardById(cardId: string): void {
  if (!currentDeck) return;
  const removed =
    removeEntry(currentDeck.pool, cardId) ||
    removeEntry(currentDeck.deck.characters, cardId) ||
    removeEntry(currentDeck.deck.resources, cardId) ||
    removeEntry(currentDeck.deck.hazards, cardId) ||
    removeEntry(currentDeck.sites, cardId) ||
    removeEntry(currentDeck.sideboard ?? [], cardId);
  if (removed) {
    const newCount = Math.max(0, (countMap.get(cardId) ?? 1) - 1);
    if (newCount === 0) countMap.delete(cardId); else countMap.set(cardId, newCount);
    scheduleAutoSave();
    refreshAfterChange();
  }
}

/** Remove from a specific section (called from deck-view). */
function removeFromSection(
  cardId: string,
  section: 'pool' | 'characters' | 'resources' | 'hazards' | 'sites' | 'sideboard',
): void {
  if (!currentDeck) return;
  const target =
    section === 'pool' ? currentDeck.pool :
    section === 'characters' ? currentDeck.deck.characters :
    section === 'resources' ? currentDeck.deck.resources :
    section === 'hazards' ? currentDeck.deck.hazards :
    section === 'sites' ? currentDeck.sites :
    (currentDeck.sideboard ?? []);
  const removed = removeEntry(target, cardId);
  if (removed) {
    const newCount = Math.max(0, (countMap.get(cardId) ?? 1) - 1);
    if (newCount === 0) countMap.delete(cardId); else countMap.set(cardId, newCount);
    scheduleAutoSave();
    refreshAfterChange();
  }
}

// ----- Rendering -----

let deckViewContainer: HTMLElement | null = null;
let statsEl: HTMLElement | null = null;

function refreshAfterChange(): void {
  if (!currentDeck) return;
  refreshCardGrid();
  if (deckViewContainer) {
    renderDeckView(deckViewContainer, currentDeck, cardPool, removeFromSection, clearDeck, doExport);
  }
  updateStats();
}

function updateStats(): void {
  if (!currentDeck || !statsEl) return;
  const all = [
    ...currentDeck.pool,
    ...currentDeck.deck.characters,
    ...currentDeck.deck.resources,
    ...currentDeck.deck.hazards,
  ];
  const total = all.reduce((s, e) => s + e.qty, 0);
  const chars = (currentDeck.pool.length + currentDeck.deck.characters.length) > 0
    ? [...currentDeck.pool, ...currentDeck.deck.characters].reduce((s, e) => s + e.qty, 0)
    : 0;
  const res = currentDeck.deck.resources.reduce((s, e) => s + e.qty, 0);
  const haz = currentDeck.deck.hazards.reduce((s, e) => s + e.qty, 0);
  statsEl.innerHTML = '';
  for (const [label, val, cls] of [
    ['Total', total, ''],
    ['Chars', chars, 'de-stat--char'],
    ['Res', res, 'de-stat--res'],
    ['Haz', haz, 'de-stat--haz'],
  ] as [string, number, string][]) {
    const span = document.createElement('span');
    span.className = `de-stat ${cls}`.trim();
    span.textContent = `${val} ${label}`;
    statsEl.appendChild(span);
  }
}

function clearDeck(): void {
  if (!currentDeck) return;
  void showConfirm('Remove all cards from the deck?').then((ok) => {
    if (!ok || !currentDeck) return;
    currentDeck.pool = [];
    currentDeck.deck.characters = [];
    currentDeck.deck.resources = [];
    currentDeck.deck.hazards = [];
    currentDeck.sites = [];
    currentDeck.sideboard = [];
    countMap.clear();
    scheduleAutoSave();
    refreshAfterChange();
  });
}

function doExport(): void {
  if (!currentDeck) return;
  const text = exportDeckText(currentDeck);
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentDeck.name.replace(/[^a-z0-9]/gi, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ----- Auto-save -----

function setSaveStatus(status: 'saved' | 'saving' | 'error'): void {
  if (!saveIndicator) return;
  saveIndicator.textContent = status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : 'Error';
  saveIndicator.className = `de-save-status de-save-status--${status}`;
}

function scheduleAutoSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  setSaveStatus('saving');
  saveTimer = setTimeout(() => { void persistDeck(); }, 800);
}

async function persistDeck(): Promise<void> {
  if (!currentDeck || !deckId) return;
  try {
    const resp = await fetch(`/api/my-decks/${encodeURIComponent(deckId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentDeck),
    });
    if (resp.ok) {
      setSaveStatus('saved');
    } else {
      setSaveStatus('error');
    }
  } catch {
    setSaveStatus('error');
  }
}

// ----- Entry point -----

/** Open the full deck editor for `id`. */
export async function openNewDeckEditor(id: string): Promise<void> {
  const resp = await fetch(`/api/my-decks/${encodeURIComponent(id)}`);
  if (!resp.ok) {
    await showAlert('Failed to load deck');
    return;
  }
  const deck = await resp.json() as FullDeck;

  deckId = id;
  currentDeck = {
    ...deck,
    pool: [...(deck.pool ?? [])],
    deck: {
      characters: [...(deck.deck?.characters ?? [])],
      resources: [...(deck.deck?.resources ?? [])],
      hazards: [...(deck.deck?.hazards ?? [])],
    },
    sites: [...(deck.sites ?? [])],
    sideboard: [...(deck.sideboard ?? [])],
  };
  countMap = buildCountMap(currentDeck);

  const screen = document.getElementById('deck-editor-screen')!;

  // Deck name
  const nameInput = screen.querySelector<HTMLInputElement>('#de-deck-name');
  if (nameInput) {
    nameInput.value = currentDeck.name;
    nameInput.addEventListener('input', () => {
      if (currentDeck) {
        currentDeck.name = nameInput.value;
        scheduleAutoSave();
      }
    });
  }

  // Save indicator
  saveIndicator = screen.querySelector('#de-save-indicator');
  setSaveStatus('saved');

  // Stats
  statsEl = screen.querySelector('#de-stats');

  // Back button
  const backBtn = screen.querySelector<HTMLButtonElement>('#de-back-btn');
  if (backBtn) {
    backBtn.onclick = () => showScreenFn?.('decks-screen');
  }

  // Manual save button
  const saveBtn = screen.querySelector<HTMLButtonElement>('#de-save-btn');
  if (saveBtn) {
    saveBtn.onclick = () => { void persistDeck(); };
  }

  // Init card browser
  const filterEl = screen.querySelector<HTMLElement>('#de-filter-panel');
  const gridEl = screen.querySelector<HTMLElement>('#de-card-grid');
  if (filterEl && gridEl) {
    initCardBrowser(filterEl, gridEl, cardPool, getDeckCount, addCard, (def) => {
      removeCardById(def.id as string);
    });
  }

  // Init deck view
  deckViewContainer = screen.querySelector('#de-deck-panel');
  if (deckViewContainer) {
    renderDeckView(deckViewContainer, currentDeck, cardPool, removeFromSection, clearDeck, doExport);
  }

  updateStats();
  showScreenFn?.('deck-editor-screen');
}
