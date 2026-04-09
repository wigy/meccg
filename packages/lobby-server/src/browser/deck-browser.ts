/**
 * @module deck-browser
 *
 * Deck browsing and management UI for the lobby. Renders the player's
 * deck collection, the shared catalog, compact deck previews, and handles
 * deck CRUD operations (select, delete, add/copy).
 */

import { getCardCss } from '@meccg/shared';
import {
  appState, cardPool, type FullDeck, type DeckListEntry,
  missingCards, uncertifiedCards, sortDeckEntries,
} from './app-state.js';
import { showConfirm } from './dialog.js';

// Forward-declared function references, set by the lobby module at startup.
let openDeckEditorFn: ((deckId: string) => Promise<void>) | null = null;

/** Register the openDeckEditor callback to break the circular dependency. */
export function setDeckBrowserCallbacks(
  openDeckEditor: (deckId: string) => Promise<void>,
): void {
  openDeckEditorFn = openDeckEditor;
}

/** Show or hide play controls depending on whether a deck is selected. */
export function updatePlayControls(): void {
  const hasDeck = appState.currentDeckId !== null;
  const notice = document.getElementById('no-deck-notice');
  if (notice) notice.classList.toggle('hidden', hasDeck);
  const playSmartAiBtn = document.getElementById('play-smart-ai-btn') as HTMLButtonElement | null;
  if (playSmartAiBtn) playSmartAiBtn.disabled = !hasDeck;
  const aiDeckSelect = document.getElementById('ai-deck-select') as HTMLSelectElement | null;
  if (aiDeckSelect) aiDeckSelect.disabled = !hasDeck;
  // Disable challenge buttons on online player list
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.lobby-player-item button')) {
    btn.disabled = !hasDeck;
  }
  const acceptBtn = document.getElementById('accept-challenge-btn') as HTMLButtonElement | null;
  if (acceptBtn) acceptBtn.disabled = !hasDeck;
}

/** Render a deck item row for "My Decks" -- click to select as current. */
function renderMyDeckItem(deck: FullDeck, isCurrent: boolean): HTMLElement {
  const missing = missingCards(deck);
  const item = document.createElement('div');
  item.className = 'lobby-deck-item lobby-deck-item--owned' + (isCurrent ? ' lobby-deck-item--current' : '');
  const info = document.createElement('div');
  info.className = 'lobby-deck-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'lobby-deck-name';
  nameEl.textContent = deck.name;
  const meta = document.createElement('span');
  meta.className = 'lobby-deck-meta';
  meta.textContent = deck.alignment + (isCurrent ? ' \u2014 selected' : '');
  info.appendChild(nameEl);
  info.appendChild(meta);
  if (missing.length > 0) {
    const warn = document.createElement('span');
    warn.className = 'lobby-deck-warning';
    warn.textContent = `\u26A0 ${missing.length} missing card${missing.length > 1 ? 's' : ''}`;
    warn.title = missing.join(', ');
    info.appendChild(warn);
  }
  const uncertified = uncertifiedCards(deck);
  if (uncertified.length > 0) {
    const warn = document.createElement('span');
    warn.className = 'lobby-deck-warning lobby-deck-warning--uncertified';
    warn.textContent = `\u26A0 ${uncertified.length} uncertified card${uncertified.length > 1 ? 's' : ''}`;
    warn.title = uncertified.join(', ');
    info.appendChild(warn);
  }
  item.appendChild(info);
  const btns = document.createElement('div');
  btns.style.display = 'flex';
  btns.style.gap = '0.4rem';
  if (isCurrent) {
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      void openDeckEditorFn?.(deck.id);
    });
    btns.appendChild(editBtn);
  } else {
    const selectBtn = document.createElement('button');
    selectBtn.textContent = 'Select';
    selectBtn.addEventListener('click', () => {
      void selectDeck(deck.id);
    });
    btns.appendChild(selectBtn);
  }
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'lobby-delete-btn';
  deleteBtn.addEventListener('click', () => {
    void showConfirm(`Delete deck "${deck.name}"?`).then((ok) => {
      if (ok) void deleteDeck(deck.id);
    });
  });
  btns.appendChild(deleteBtn);
  item.appendChild(btns);
  return item;
}

/** Render a deck item row for the catalog -- "Add" or "Owned". */
function renderCatalogDeckItem(deck: FullDeck, owned: boolean, onAdd: () => void): HTMLElement {
  const missing = missingCards(deck);
  const item = document.createElement('div');
  item.className = 'lobby-deck-item';
  const info = document.createElement('div');
  info.className = 'lobby-deck-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'lobby-deck-name';
  nameEl.textContent = deck.name;
  const meta = document.createElement('span');
  meta.className = 'lobby-deck-meta';
  meta.textContent = deck.alignment;
  info.appendChild(nameEl);
  info.appendChild(meta);
  if (missing.length > 0) {
    const warn = document.createElement('span');
    warn.className = 'lobby-deck-warning';
    warn.textContent = `\u26A0 ${missing.length} missing card${missing.length > 1 ? 's' : ''}`;
    warn.title = missing.join(', ');
    info.appendChild(warn);
  }
  const uncertified = uncertifiedCards(deck);
  if (uncertified.length > 0) {
    const warn = document.createElement('span');
    warn.className = 'lobby-deck-warning lobby-deck-warning--uncertified';
    warn.textContent = `\u26A0 ${uncertified.length} uncertified card${uncertified.length > 1 ? 's' : ''}`;
    warn.title = uncertified.join(', ');
    info.appendChild(warn);
  }
  item.appendChild(info);
  const btn = document.createElement('button');
  if (owned) {
    btn.textContent = 'Owned';
    btn.disabled = true;
  } else {
    btn.textContent = 'Copy';
    btn.title = 'Make a copy for yourself to edit';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Copying...';
      onAdd();
    });
  }
  item.appendChild(btn);
  return item;
}

/** Render a compact, read-only listing of a deck in a 3-column grid. */
export function renderCompactDeck(container: HTMLElement, deck: FullDeck): void {
  const sections: { label: string; entries: DeckListEntry[] }[][] = [
    [
      { label: 'Pool', entries: deck.pool },
      { label: 'Characters', entries: deck.deck.characters },
    ],
    [{ label: 'Resources', entries: deck.deck.resources }],
    [{ label: 'Hazards', entries: deck.deck.hazards }],
    [{ label: 'Sideboard', entries: deck.sideboard ?? [] }],
    [{ label: 'Sites', entries: deck.sites }],
  ];
  const nameEl = document.createElement('div');
  nameEl.className = 'compact-deck-name';
  nameEl.textContent = deck.name;
  container.appendChild(nameEl);
  const alignEl = document.createElement('div');
  alignEl.className = 'compact-deck-alignment';
  alignEl.textContent = deck.alignment;
  container.appendChild(alignEl);
  const grid = document.createElement('div');
  grid.className = 'compact-deck-grid';
  for (const group of sections) {
    const col = document.createElement('div');
    col.className = 'compact-deck-section';
    for (const section of group) {
      if (section.entries.length === 0) continue;
      const heading = document.createElement('div');
      heading.className = 'compact-deck-heading';
      heading.textContent = section.label;
      col.appendChild(heading);
      for (const entry of sortDeckEntries(section.entries)) {
        const row = document.createElement('div');
        row.className = 'compact-deck-entry' + (entry.card === null ? ' compact-deck-entry--missing' : '');
        const star = entry.favourite ? ' \u2605' : '';
        row.textContent = (entry.qty > 1 ? `${entry.qty}\u00d7 ${entry.name}` : entry.name) + star;
        if (entry.card) {
          row.dataset.cardId = entry.card;
          const def = cardPool[entry.card];
          const style = def ? getCardCss(def) : undefined;
          if (style) row.setAttribute('style', style);
        }
        col.appendChild(row);
      }
    }
    if (col.children.length > 0) grid.appendChild(col);
  }
  container.appendChild(grid);
}

/** Fetch deck catalog and player's decks, then render both lists. */
export async function loadDecks(): Promise<void> {
  const [catalogResp, myResp] = await Promise.all([
    fetch('/api/decks'),
    fetch('/api/my-decks'),
  ]);
  const catalog = catalogResp.ok ? await catalogResp.json() as FullDeck[] : [];
  appState.cachedCatalog = catalog;
  const myData = myResp.ok
    ? await myResp.json() as { decks: FullDeck[]; currentDeck: string | null; currentFullDeck: FullDeck | null }
    : { decks: [] as FullDeck[], currentDeck: null, currentFullDeck: null };
  const myDecks = myData.decks;
  appState.currentDeckId = myData.currentDeck;
  appState.currentFullDeck = myData.currentFullDeck ?? myDecks.find(d => d.id === appState.currentDeckId) ?? null;
  appState.ownedDeckIds = new Set(myDecks.map(d => d.id));
  updatePlayControls();

  // Render my decks
  const myContainer = document.getElementById('my-decks')!;
  myContainer.innerHTML = '';
  if (myDecks.length === 0) {
    myContainer.innerHTML = '<p class="lobby-empty">No decks yet \u2014 add one from the catalog below</p>';
  } else {
    for (const deck of myDecks) {
      myContainer.appendChild(renderMyDeckItem(deck, deck.id === appState.currentDeckId));
    }
  }

  // Render catalog
  const catContainer = document.getElementById('deck-catalog')!;
  catContainer.innerHTML = '';
  if (catalog.length === 0) {
    catContainer.innerHTML = '<p class="lobby-empty">No decks available</p>';
  } else {
    for (const deck of catalog) {
      catContainer.appendChild(renderCatalogDeckItem(deck, appState.ownedDeckIds.has(`${appState.lobbyPlayerName}-${deck.id}`), () => {
        void addDeckToCollection(deck);
      }));
    }
  }

  // Render current deck compact preview
  const previewContainer = document.getElementById('current-deck-preview');
  if (previewContainer) {
    previewContainer.innerHTML = '';
    if (appState.currentFullDeck) {
      renderCompactDeck(previewContainer, appState.currentFullDeck);
    } else {
      previewContainer.innerHTML = '<p class="lobby-empty">No deck selected</p>';
    }
  }

  // Populate my deck dropdown (personal decks + catalog decks)
  const mySelect = document.getElementById('my-deck-select') as HTMLSelectElement | null;
  if (mySelect) {
    mySelect.innerHTML = '';
    const allDecks = myDecks.length + catalog.length;
    if (allDecks === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No decks available';
      opt.disabled = true;
      mySelect.appendChild(opt);
    } else {
      if (myDecks.length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'My Decks';
        for (const deck of myDecks) {
          const opt = document.createElement('option');
          opt.value = deck.id;
          const missing = missingCards(deck);
          const uncert = uncertifiedCards(deck);
          let label = deck.name;
          if (missing.length > 0) label = `\u26A0 ${label}`;
          if (uncert.length > 0) label = `\u2606 ${label}`;
          opt.textContent = label;
          opt.selected = deck.id === appState.currentDeckId;
          group.appendChild(opt);
        }
        mySelect.appendChild(group);
      }
      if (catalog.length > 0) {
        const group = document.createElement('optgroup');
        group.label = 'Stock Decks';
        for (const deck of catalog) {
          const opt = document.createElement('option');
          opt.value = deck.id;
          const missing = missingCards(deck);
          const uncert = uncertifiedCards(deck);
          let label = deck.name;
          if (missing.length > 0) label = `\u26A0 ${label}`;
          if (uncert.length > 0) label = `\u2606 ${label}`;
          opt.textContent = label;
          opt.selected = deck.id === appState.currentDeckId;
          group.appendChild(opt);
        }
        mySelect.appendChild(group);
      }
    }
    if (!appState.myDeckSelectInstalled) {
      appState.myDeckSelectInstalled = true;
      mySelect.addEventListener('change', () => {
        if (mySelect.value) void selectDeck(mySelect.value);
      });
    }
  }

  // Populate AI deck dropdown
  const aiSelect = document.getElementById('ai-deck-select') as HTMLSelectElement | null;
  if (aiSelect) {
    aiSelect.innerHTML = '';
    for (const deck of catalog) {
      const opt = document.createElement('option');
      opt.value = deck.id;
      const missing = missingCards(deck);
      opt.textContent = missing.length > 0 ? `\u26A0 ${deck.name}` : deck.name;
      if (deck.id === 'development-proto-hero') opt.selected = true;
      aiSelect.appendChild(opt);
    }
  }
}

/** Set a deck as the player's current deck, then refresh. */
export async function selectDeck(deckId: string): Promise<void> {
  await fetch('/api/my-decks/current', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckId }),
  });
  await loadDecks();
}

/** Delete a deck from the player's collection, then refresh. */
export async function deleteDeck(deckId: string): Promise<void> {
  await fetch(`/api/my-decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
  await loadDecks();
}

/** Add a catalog deck to the player's collection, then refresh. */
export async function addDeckToCollection(deck: FullDeck): Promise<void> {
  const personalDeck = { ...deck, id: `${appState.lobbyPlayerName}-${deck.id}` };
  const resp = await fetch('/api/my-decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(personalDeck),
  });
  if (resp.ok) {
    await loadDecks();
  }
}
