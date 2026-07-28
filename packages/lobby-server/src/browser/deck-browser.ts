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
import { showAlert, showConfirm } from './dialog.js';
import { apiGet, apiSend } from './api.js';
import { renderMarkdown } from './markdown.js';
import {
  parseGccgDeck, parseMeccgJsonDeck, parsedCardCount, readDeckFile, toFullDeck,
} from './deck-import.js';

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
  const playHeuristicAiBtn = document.getElementById('play-heuristic-ai-btn') as HTMLButtonElement | null;
  if (playHeuristicAiBtn) playHeuristicAiBtn.disabled = !hasDeck;
  const playRealAiBtn = document.getElementById('play-real-ai-btn') as HTMLButtonElement | null;
  if (playRealAiBtn) playRealAiBtn.disabled = !hasDeck;
  const playMcAiBtn = document.getElementById('play-mc-ai-btn') as HTMLButtonElement | null;
  if (playMcAiBtn) playMcAiBtn.disabled = !hasDeck;
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

/**
 * Label for a deck option in the deck dropdown. Prefixes a star for decks
 * a human has approved for AI use (see `DeckList.approved`) and a warning
 * sign for decks with cards missing from the pool.
 */
function deckSelectLabel(deck: FullDeck): string {
  let label = deck.name;
  if (deck.approved === true) label = `\u2605 ${label}`;
  if (missingCards(deck).length > 0) label = `\u26A0 ${label}`;
  return label;
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
  if (deck.notes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'compact-deck-notes';
    notesEl.innerHTML = renderMarkdown(deck.notes);
    container.appendChild(notesEl);
  }
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
    apiGet<FullDeck[]>('/api/decks'),
    apiGet<{ decks: FullDeck[]; currentDeck: string | null; currentFullDeck: FullDeck | null }>('/api/my-decks'),
  ]);
  const catalog = catalogResp.ok ? catalogResp.data : [];
  appState.cachedCatalog = catalog;
  const myData = myResp.ok
    ? myResp.data
    : { decks: [] as FullDeck[], currentDeck: null, currentFullDeck: null };
  const myDecks = myData.decks;
  appState.currentDeckId = myData.currentDeck;
  appState.currentFullDeck = myData.currentFullDeck ?? myDecks.find(d => d.id === appState.currentDeckId) ?? null;
  appState.ownedDeckIds = new Set(myDecks.map(d => d.id));
  updatePlayControls();

  // Wire the new-deck button once; loadDecks re-runs on every visit.
  const newDeckBtn = document.getElementById('new-deck-btn') as HTMLButtonElement | null;
  if (newDeckBtn && !newDeckBtn.dataset.bound) {
    newDeckBtn.dataset.bound = '1';
    newDeckBtn.addEventListener('click', showNewDeckDialog);
  }

  // Wire the import-deck button once: clicking opens a file picker.
  const importBtn = document.getElementById('import-deck-btn') as HTMLButtonElement | null;
  if (importBtn && !importBtn.dataset.bound) {
    importBtn.dataset.bound = '1';
    importBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.deck,.meccg-json';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file) void importDeckFile(file);
      });
      input.click();
    });
  }

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
          opt.textContent = deckSelectLabel(deck);
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
          opt.textContent = deckSelectLabel(deck);
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

  // Populate AI deck dropdown, preserving the user's current selection.
  // Only approved decks are offered: an unapproved deck may reach a state
  // the engine cannot continue from, which strands the game mid-play.
  const aiSelect = document.getElementById('ai-deck-select') as HTMLSelectElement | null;
  if (aiSelect) {
    const savedAiDeck = aiSelect.value;
    aiSelect.innerHTML = '';
    for (const deck of catalog.filter(d => d.approved === true)) {
      const opt = document.createElement('option');
      opt.value = deck.id;
      const missing = missingCards(deck);
      opt.textContent = missing.length > 0 ? `\u26A0 ${deck.name}` : deck.name;
      if (deck.id === savedAiDeck) opt.selected = true;
      aiSelect.appendChild(opt);
    }
  }
}

/** Set a deck as the player's current deck, then refresh. */
export async function selectDeck(deckId: string): Promise<void> {
  await apiSend('/api/my-decks/current', 'PUT', { deckId });
  await loadDecks();
}

/** Delete a deck from the player's collection, then refresh. */
export async function deleteDeck(deckId: string): Promise<void> {
  await apiSend(`/api/my-decks/${encodeURIComponent(deckId)}`, 'DELETE');
  await loadDecks();
}

/**
 * Import a deck file into the player's collection. A native `*.meccg-json`
 * file (valid JSON carrying our deck fields) is taken as it is, under a
 * fresh id. Anything else is parsed as a GCCG `*.deck` file: card names
 * are resolved against the pool and names that could not be matched are
 * reported and kept as missing-card entries. Either way the deck is saved,
 * selected, and opened in the editor.
 */
async function importDeckFile(file: File): Promise<void> {
  const text = await readDeckFile(file);
  const native = parseMeccgJsonDeck(text);
  if (native) {
    const deck = { ...native, id: newDeckId(native.name) };
    const resp = await apiSend('/api/my-decks', 'POST', deck);
    if (!resp.ok) {
      await showAlert(resp.error ?? 'Failed to save the imported deck');
      return;
    }
    await selectDeck(deck.id);
    await openDeckEditorFn?.(deck.id);
    return;
  }
  const parsed = parseGccgDeck(text, file.name.replace(/\.(deck|meccg-json)$/i, ''));
  if (parsedCardCount(parsed) === 0) {
    await showAlert(`No cards found in "${file.name}" — is it a .meccg-json or GCCG .deck file?`);
    return;
  }
  const deck = toFullDeck(parsed, newDeckId(parsed.name));
  const resp = await apiSend('/api/my-decks', 'POST', deck);
  if (!resp.ok) {
    await showAlert(resp.error ?? 'Failed to save the imported deck');
    return;
  }
  if (parsed.unmatched.length > 0) {
    await showAlert(
      `Imported "${deck.name}" (${parsed.alignment}) with ${parsed.unmatched.length} `
      + `unrecognized card name${parsed.unmatched.length > 1 ? 's' : ''}:\n`
      + parsed.unmatched.join(', '));
  }
  await selectDeck(deck.id);
  await openDeckEditorFn?.(deck.id);
}

/**
 * Add a catalog deck to the player's collection, then refresh. The copy is
 * editable, so it drops the catalog deck's `approved` flag: approval is
 * granted by hand per deck (see `DeckList.approved`) and does not survive
 * into a deck a player can change.
 */
export async function addDeckToCollection(deck: FullDeck): Promise<void> {
  const personalDeck = { ...deck, approved: undefined, id: `${appState.lobbyPlayerName}-${deck.id}` };
  const resp = await apiSend('/api/my-decks', 'POST', personalDeck);
  if (resp.ok) {
    await loadDecks();
  }
}

/** Map a deck alignment to the card-alignment tag carried by its site cards. */
const SITE_CARD_ALIGNMENTS: Record<string, string> = {
  hero: 'wizard',
  minion: 'ringwraith',
  'fallen-wizard': 'fallen-wizard',
  balrog: 'balrog',
};

/**
 * Build the initial sites section for a new deck: one copy of each unique
 * site of the alignment and four copies of each non-unique one (the havens).
 */
function initialSites(alignment: string): DeckListEntry[] {
  const cardAlignment = SITE_CARD_ALIGNMENTS[alignment];
  const entries: DeckListEntry[] = [];
  for (const [cardId, def] of Object.entries(cardPool)) {
    const d = def as unknown as { cardType: string; alignment?: string; unique?: boolean; name: string };
    if (!d.cardType.endsWith('-site') || d.alignment !== cardAlignment) continue;
    entries.push({ name: d.name, card: cardId, qty: d.unique ? 1 : 4 });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Derive a fresh deck id from the player's name and the deck name. */
function newDeckId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
  const base = `${appState.lobbyPlayerName}-${slug}`;
  let id = base;
  for (let n = 2; appState.ownedDeckIds.has(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Show the new-deck dialog: asks for a name and an alignment, then creates
 * an empty deck whose sites section is pre-filled for that alignment.
 */
function showNewDeckDialog(): void {
  const modal = document.createElement('div');
  modal.className = 'app-dialog';
  const backdrop = document.createElement('div');
  backdrop.className = 'app-dialog-backdrop';
  modal.appendChild(backdrop);
  const dialog = document.createElement('div');
  dialog.className = 'app-dialog-box';

  const msg = document.createElement('p');
  msg.className = 'app-dialog-message';
  msg.textContent = 'Create a new deck';
  dialog.appendChild(msg);

  const nameField = document.createElement('div');
  nameField.className = 'new-deck-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'lobby-select-label';
  nameLabel.textContent = 'Name';
  nameField.appendChild(nameLabel);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'lobby-deck-select';
  nameInput.placeholder = 'e.g. Riders of Rohan';
  nameField.appendChild(nameInput);
  dialog.appendChild(nameField);

  const alignField = document.createElement('div');
  alignField.className = 'new-deck-field';
  const alignLabel = document.createElement('label');
  alignLabel.className = 'lobby-select-label';
  alignLabel.textContent = 'Alignment';
  alignField.appendChild(alignLabel);
  const alignSelect = document.createElement('select');
  alignSelect.className = 'lobby-deck-select';
  for (const alignment of Object.keys(SITE_CARD_ALIGNMENTS)) {
    const opt = document.createElement('option');
    opt.value = alignment;
    opt.textContent = alignment;
    alignSelect.appendChild(opt);
  }
  alignField.appendChild(alignSelect);
  dialog.appendChild(alignField);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    modal.remove();
  };

  const create = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const deck: FullDeck = {
      id: newDeckId(name), name, alignment: alignSelect.value,
      pool: [], sites: initialSites(alignSelect.value), sideboard: [],
      deck: { characters: [], hazards: [], resources: [] },
    };
    close();
    void apiSend('/api/my-decks', 'POST', deck).then(async resp => {
      if (resp.ok) {
        await selectDeck(deck.id);
        await openDeckEditorFn?.(deck.id);
      } else {
        await showAlert(resp.error ?? 'Failed to create deck');
      }
    });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Enter') create();
      else close();
    }
  };

  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'app-dialog-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);
  actions.appendChild(cancelBtn);
  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create';
  createBtn.addEventListener('click', create);
  actions.appendChild(createBtn);
  dialog.appendChild(actions);

  modal.appendChild(dialog);
  document.body.appendChild(modal);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  nameInput.focus();
}
