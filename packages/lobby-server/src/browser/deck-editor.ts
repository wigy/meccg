/**
 * @module deck-editor
 *
 * Deck editor UI for viewing and modifying individual deck contents.
 * Renders card lists with request/certify buttons, handles hover previews,
 * and opens the editor screen for a given deck.
 */

import { cardImageProxyPath, getCardCss, CHARACTER_CARD_TYPES, type CardDefinition } from '@meccg/shared';
import {
  appState, cardPool, type FullDeck, type DeckListEntry,
  sortDeckEntries, EDITING_DECK_KEY, type ScreenId,
} from './app-state.js';
import { buildCardAttributes } from './render.js';
import { showAlert } from './dialog.js';

// Forward-declared showScreen, set by the lobby module at startup.
let showScreenFn: ((id: ScreenId) => void) | null = null;

/** Register the showScreen callback to break the circular dependency. */
export function setDeckEditorCallbacks(
  showScreen: (id: ScreenId) => void,
): void {
  showScreenFn = showScreen;
}

/** A deck section shown in the editor: a labelled list of card entries. */
interface DeckSection { id: string; label: string; entries: DeckListEntry[] }

// The deck currently open in the editor; mutated by the +/- quantity buttons.
let editingDeck: FullDeck | null = null;

/** Render one section's card list and its title with the card count. */
function renderSection(section: DeckSection, deckId: string): void {
  renderCardList(document.getElementById(`deck-editor-${section.id}`)!, section, deckId);
  const total = section.entries.reduce((sum, e) => sum + e.qty, 0);
  const titleEl = document.getElementById(`deck-editor-${section.id}-title`)!;
  titleEl.textContent = '';
  titleEl.classList.add('deck-editor-section-title');
  const label = document.createElement('span');
  label.textContent = `${section.label} (${total})`;
  titleEl.appendChild(label);
  if (section.id === 'characters' || section.id === 'pool') {
    const addBtn = document.createElement('button');
    addBtn.className = 'deck-editor-add-btn';
    addBtn.textContent = '+';
    addBtn.title = section.id === 'pool'
      ? 'Add a starting character or item'
      : 'Add a character card';
    // The pool holds the starting company: no avatars, but starting items.
    const includeAvatars = section.id === 'characters';
    // The toggles fully define the browsable categories; no extra base filter.
    addBtn.addEventListener('click', () => openCardBrowser(section, deckId, 'Add a card',
      () => true,
      characterToggles(editingDeck?.alignment ?? '', includeAvatars)));
    titleEl.appendChild(addBtn);
  }
}

/** A card category toggle shown as an icon button in the card browser. */
interface BrowserToggle {
  icon: string;
  title: string;
  match: (def: CardDefinition) => boolean;
  active: boolean;
  /** Render a vertical divider before this toggle, separating toggle groups. */
  separatorBefore?: boolean;
}

/** Extract loosely-typed filter traits from any card definition. */
const traits = (def: CardDefinition) => def as unknown as {
  cardType: string; race?: string; alignment?: string; keywords?: readonly string[];
  subtype?: string; marshallingPoints?: number;
};

/** Whether a card belongs to the starting-item category (see the `starting-item` keyword). */
function isStartingItem(def: CardDefinition): boolean {
  return (traits(def).keywords ?? []).includes('starting-item');
}

/**
 * Build the category toggles for the characters/pool card browser:
 * character categories plus starting items. The deck's alignment decides
 * which categories start enabled; the rest can be toggled on to browse
 * beyond the deck's own alignment. With `includeAvatars` false (the pool
 * browser), the avatar toggles start disabled.
 */
function characterToggles(alignment: string, includeAvatars = true): BrowserToggle[] {
  const isAgent = (def: CardDefinition) => (traits(def).keywords ?? []).includes('agent');
  // Avatars are identified by their race; everyone else is an ordinary character.
  const isAvatar = (def: CardDefinition) =>
    ['wizard', 'ringwraith', 'fallen-wizard', 'balrog'].includes(traits(def).race ?? '');
  // Unknown alignment: enable everything.
  const on = (...alignments: string[]) => alignments.includes(alignment)
    || !['hero', 'minion', 'fallen-wizard', 'balrog'].includes(alignment);
  return [
    { icon: '\u{1F9DD}', title: 'Hero characters', active: on('hero', 'fallen-wizard'),
      match: d => traits(d).cardType === 'hero-character' && !isAvatar(d) },
    { icon: '\u{1F479}', title: 'Minion characters (non-agent)', active: on('minion', 'fallen-wizard', 'balrog'),
      match: d => traits(d).cardType === 'minion-character' && !isAvatar(d) && !isAgent(d) },
    { icon: '\u{1F575}️', title: 'Agents', active: on('minion', 'fallen-wizard', 'balrog'),
      match: d => traits(d).cardType === 'minion-character' && isAgent(d) },
    { icon: '\u{1F9D9}', title: 'Wizards (hero avatars)', active: includeAvatars && on('hero'),
      match: d => traits(d).race === 'wizard' && traits(d).alignment === 'wizard' },
    { icon: '\u{1F47B}', title: 'Ringwraiths (minion avatars)', active: includeAvatars && on('minion'),
      match: d => traits(d).race === 'ringwraith' },
    { icon: '\u{1F52E}', title: 'Fallen-wizard avatars', active: includeAvatars && on('fallen-wizard'),
      match: d => traits(d).alignment === 'fallen-wizard' && CHARACTER_CARD_TYPES.has(traits(d).cardType) },
    { icon: '\u{1F525}', title: 'The Balrog (avatar)', active: includeAvatars && on('balrog'),
      match: d => traits(d).race === 'balrog' },
    { icon: '\u{1F6E1}️', title: 'Hero starting items', active: on('hero', 'fallen-wizard'),
      separatorBefore: true,
      match: d => isStartingItem(d) && traits(d).alignment === 'wizard' },
    { icon: '\u{1F5E1}️', title: 'Minion starting items', active: on('minion', 'fallen-wizard', 'balrog'),
      match: d => isStartingItem(d) && traits(d).alignment === 'ringwraith' },
    { icon: '\u{1FA84}', title: 'Fallen-wizard starting items', active: on('fallen-wizard'),
      match: d => isStartingItem(d) && traits(d).alignment === 'fallen-wizard' },
    ...resourceToggles(),
  ];
}

/** Whether a card is a ring item: a gold ring or an item with the ring keyword. */
function isRing(def: CardDefinition): boolean {
  return traits(def).cardType.endsWith('resource-item')
    && (traits(def).subtype === 'gold-ring' || (traits(def).keywords ?? []).includes('ring'));
}

/**
 * Resource category toggles (hero and minion versions side by side, then
 * the fallen-wizard pair). All start disabled in the characters/pool
 * browsers — they hold characters and starting cards, not deck resources.
 */
function resourceToggles(): BrowserToggle[] {
  // Hero/minion resources by card-type prefix; fallen-wizard stage resources
  // reuse hero card types, so exclude that alignment from the hero side.
  const res = (d: CardDefinition, side: 'hero' | 'minion', kind: string) =>
    traits(d).cardType === `${side}-resource-${kind}` && traits(d).alignment !== 'fallen-wizard';
  const hasMp = (d: CardDefinition) => (traits(d).marshallingPoints ?? 0) > 0;
  const fwResource = (d: CardDefinition) =>
    traits(d).alignment === 'fallen-wizard' && traits(d).cardType.includes('-resource-');
  return [
    { icon: '\u{1F48D}', title: 'Hero rings', active: false, separatorBefore: true,
      match: d => res(d, 'hero', 'item') && isRing(d) },
    { icon: '\u{1F9FF}', title: 'Minion rings', active: false,
      match: d => res(d, 'minion', 'item') && isRing(d) },
    { icon: '\u{1F48E}', title: 'Hero items (non-ring)', active: false,
      match: d => res(d, 'hero', 'item') && !isRing(d) },
    { icon: '\u{1FA93}', title: 'Minion items (non-ring)', active: false,
      match: d => res(d, 'minion', 'item') && !isRing(d) },
    { icon: '\u{1F6A9}', title: 'Hero factions', active: false,
      match: d => res(d, 'hero', 'faction') },
    { icon: '\u{1F3F4}', title: 'Minion factions', active: false,
      match: d => res(d, 'minion', 'faction') },
    { icon: '\u{1F434}', title: 'Hero allies', active: false,
      match: d => res(d, 'hero', 'ally') },
    { icon: '\u{1F43A}', title: 'Minion allies', active: false,
      match: d => res(d, 'minion', 'ally') },
    { icon: '\u{1F3C5}', title: 'Hero misc-point resources', active: false,
      match: d => res(d, 'hero', 'event') && hasMp(d) },
    { icon: '\u{1F396}️', title: 'Minion misc-point resources', active: false,
      match: d => res(d, 'minion', 'event') && hasMp(d) },
    { icon: '\u{1F4DC}', title: 'Hero events', active: false,
      match: d => res(d, 'hero', 'event') && !hasMp(d) },
    { icon: '\u{1F987}', title: 'Minion events', active: false,
      match: d => res(d, 'minion', 'event') && !hasMp(d) },
    { icon: '\u{1F3C6}', title: 'Fallen-wizard resources with marshalling points', active: false,
      match: d => fwResource(d) && hasMp(d) },
    { icon: '\u{1F56F}️', title: 'Fallen-wizard resources without marshalling points', active: false,
      match: d => fwResource(d) && !hasMp(d) },
  ];
}

/** Persist the deck currently being edited. Returns true on success. */
async function saveEditingDeck(): Promise<boolean> {
  if (!editingDeck) return false;
  const r = await fetch('/api/my-decks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(editingDeck),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({})) as { error?: string };
    await showAlert(data.error ?? 'Failed to save deck');
  }
  return r.ok;
}

/** Adjust an entry's quantity by delta, save the deck, and re-render the section. */
function changeQty(
  entry: DeckListEntry, delta: number, section: DeckSection, deckId: string, e: MouseEvent,
): void {
  const idx = section.entries.indexOf(entry);
  entry.qty += delta;
  const removed = entry.qty <= 0;
  if (removed) section.entries.splice(idx, 1);
  renderSection(section, deckId);
  refreshPreviewUnderCursor(e.clientX, e.clientY);
  void saveEditingDeck().then(ok => {
    if (!ok) {
      entry.qty -= delta;
      if (removed) section.entries.splice(idx, 0, entry);
      renderSection(section, deckId);
      refreshPreviewUnderCursor(e.clientX, e.clientY);
    }
  });
}

/** Add one copy of a card to a section (new entry if not present), save, and re-render. */
function addCardToSection(cardId: string, section: DeckSection, deckId: string): void {
  const def = cardPool[cardId];
  const existing = section.entries.find(en => en.card === cardId);
  if (existing) {
    existing.qty += 1;
  } else {
    section.entries.push({ name: def ? def.name : cardId, card: cardId, qty: 1 });
  }
  renderSection(section, deckId);
  void saveEditingDeck().then(ok => {
    if (!ok) {
      if (existing) {
        existing.qty -= 1;
      } else {
        const idx = section.entries.findIndex(en => en.card === cardId);
        if (idx >= 0) section.entries.splice(idx, 1);
      }
      renderSection(section, deckId);
    }
  });
}

/**
 * Open a modal card browser listing all pool cards accepted by cardFilter.
 * Hovering a card shows its preview; clicking adds one copy to the
 * section and closes the browser.
 */
function openCardBrowser(
  section: DeckSection, deckId: string, browserTitle: string,
  cardFilter: (def: CardDefinition) => boolean,
  toggles: BrowserToggle[] = [],
): void {
  const cards = Object.entries(cardPool)
    .filter(([, def]) => cardFilter(def))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));

  const modal = document.createElement('div');
  modal.className = 'app-dialog';

  const backdrop = document.createElement('div');
  backdrop.className = 'app-dialog-backdrop';
  modal.appendChild(backdrop);

  const dialog = document.createElement('div');
  dialog.className = 'app-dialog-box card-browser-box';

  const title = document.createElement('h3');
  title.className = 'card-browser-title';
  title.textContent = browserTitle;
  dialog.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'card-browser-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  dialog.appendChild(closeBtn);

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'card-browser-search';
  search.placeholder = 'Search by name, card text, or keyword…';
  dialog.appendChild(search);

  if (toggles.length > 0) {
    const togglesEl = document.createElement('div');
    togglesEl.className = 'card-browser-toggles';
    const toggleButtons: { toggle: BrowserToggle; btn: HTMLButtonElement }[] = [];
    for (const t of toggles) {
      if (t.separatorBefore) {
        const divider = document.createElement('span');
        divider.className = 'card-browser-toggle-divider';
        togglesEl.appendChild(divider);
      }
      const btn = document.createElement('button');
      btn.className = 'card-browser-toggle' + (t.active ? ' card-browser-toggle--active' : '');
      btn.textContent = t.icon;
      btn.title = t.title;
      btn.addEventListener('click', () => {
        t.active = !t.active;
        btn.classList.toggle('card-browser-toggle--active', t.active);
        renderList();
      });
      toggleButtons.push({ toggle: t, btn });
      togglesEl.appendChild(btn);
    }
    const clearBtn = document.createElement('button');
    clearBtn.className = 'card-browser-clear';
    const clearIcon = document.createElement('span');
    clearIcon.className = 'card-browser-clear-icon';
    clearIcon.textContent = '\u{1F5D1}\u{FE0F}';
    clearBtn.appendChild(clearIcon);
    clearBtn.title = 'Clear all filters';
    clearBtn.addEventListener('click', () => {
      for (const { toggle, btn } of toggleButtons) {
        toggle.active = false;
        btn.classList.remove('card-browser-toggle--active');
      }
      renderList();
    });
    togglesEl.appendChild(clearBtn);
    dialog.appendChild(togglesEl);
  }

  const body = document.createElement('div');
  body.className = 'card-browser-body';
  const list = document.createElement('div');
  list.className = 'card-browser-list';
  const previewPane = document.createElement('div');
  previewPane.className = 'card-browser-preview';
  body.appendChild(list);
  body.appendChild(previewPane);
  dialog.appendChild(body);

  modal.appendChild(dialog);
  document.body.appendChild(modal);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    modal.remove();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const showCardPreview = (cardId: string) => {
    previewPane.innerHTML = '';
    const def = cardPool[cardId];
    if (!def) return;
    const info = document.createElement('div');
    info.className = 'card-preview-info';
    const name = document.createElement('div');
    name.className = 'card-preview-name';
    name.textContent = def.name;
    info.appendChild(name);
    const imgPath = cardImageProxyPath(def);
    if (imgPath) {
      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      info.appendChild(img);
    }
    buildCardAttributes(info, def);
    previewPane.appendChild(info);
  };

  const matchesSearch = (def: CardDefinition, filter: string): boolean => {
    if (def.name.toLowerCase().includes(filter)) return true;
    const d = def as unknown as {
      text?: string; keywords?: readonly string[]; race?: string; skills?: readonly string[];
    };
    if (d.text?.toLowerCase().includes(filter)) return true;
    return [...(d.keywords ?? []), d.race, ...(d.skills ?? [])]
      .some(kw => kw?.toLowerCase().includes(filter));
  };

  const renderList = () => {
    list.innerHTML = '';
    const filter = search.value.trim().toLowerCase();
    for (const [cardId, def] of cards) {
      if (toggles.length > 0 && !toggles.some(t => t.active && t.match(def))) continue;
      if (filter && !matchesSearch(def, filter)) continue;
      const item = document.createElement('div');
      item.className = 'card-browser-item';
      item.textContent = def.name;
      const style = getCardCss(def) ?? '';
      if (style) item.setAttribute('style', style);
      item.addEventListener('mouseover', () => showCardPreview(cardId));
      item.addEventListener('click', () => {
        addCardToSection(cardId, section, deckId);
        close();
      });
      list.appendChild(item);
    }
    if (list.children.length === 0) {
      list.innerHTML = '<p class="lobby-empty">No matching cards</p>';
    }
  };

  search.addEventListener('input', renderList);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  renderList();
  search.focus();
}

/** Create a [+] or [-] quantity button for a card row. */
function makeQtyButton(label: string, title: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'deck-editor-qty-btn';
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return btn;
}

/** Render a list of card entries into a container element, sorted by card type then name. */
function renderCardList(container: HTMLElement, section: DeckSection, deckId: string): void {
  container.innerHTML = '';
  const sorted = sortDeckEntries(section.entries);
  for (const entry of sorted) {
    const row = document.createElement('div');
    row.className = 'deck-editor-card';
    const qtyEl = document.createElement('span');
    qtyEl.className = 'deck-editor-card-qty';
    qtyEl.textContent = String(entry.qty);
    const nameEl = document.createElement('span');
    nameEl.className = 'deck-editor-card-name';
    // Use official name and color from card pool if mapped
    const def = entry.card ? cardPool[entry.card] : undefined;
    const favStar = entry.favourite ? ' \u2605' : '';
    nameEl.textContent = (def ? def.name : entry.name) + favStar;
    const badge = document.createElement('span');
    badge.className = 'deck-editor-certified-badge';
    if (def) {
      const style = getCardCss(def) ?? '';
      if (style) nameEl.setAttribute('style', style);
      row.dataset.cardId = entry.card!;
      row.style.cursor = 'pointer';
      if ('certified' in def && (def as unknown as Record<string, unknown>).certified) {
        badge.textContent = '\u2605';
        badge.title = `Certified ${(def as unknown as Record<string, unknown>).certified as string}`;
      }
    }
    const actions = document.createElement('span');
    actions.className = 'deck-editor-card-actions';
    const qtyButtons = [
      makeQtyButton('+', 'Add one copy', (e) => changeQty(entry, 1, section, deckId, e)),
      makeQtyButton('−', 'Remove one copy', (e) => changeQty(entry, -1, section, deckId, e)),
    ];
    if (!def) {
      row.classList.add('deck-editor-card--unknown');
      const requestKey = `${deckId}:${entry.name}`;
      const btn = document.createElement('button');
      btn.className = 'deck-editor-request-btn';
      btn.title = 'Ask the server admin to add this card to the game data';
      if (appState.requestedCards.has(requestKey)) {
        btn.textContent = 'Requested';
        btn.disabled = true;
      } else {
        btn.textContent = 'Request';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Requested';
          appState.requestedCards.add(requestKey);
          void fetch('/api/card-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deckId, cardName: entry.name }),
          }).then(async r => {
            if (!r.ok) {
              const data = await r.json() as { error?: string };
              btn.disabled = false;
              btn.textContent = 'Request';
              appState.requestedCards.delete(requestKey);
              await showAlert(data.error ?? 'Request failed');
            }
          });
        });
      }
      row.appendChild(qtyEl);
      row.appendChild(badge);
      row.appendChild(nameEl);
      actions.appendChild(btn);
      for (const qtyBtn of qtyButtons) actions.appendChild(qtyBtn);
      row.appendChild(actions);
      container.appendChild(row);
      continue;
    }
    row.appendChild(qtyEl);
    row.appendChild(badge);
    row.appendChild(nameEl);
    if (def && !('certified' in def && (def as unknown as Record<string, unknown>).certified)) {
      const certBtn = document.createElement('button');
      certBtn.className = 'deck-editor-certify-btn';
      certBtn.title = 'Request certification for this card';
      if (appState.requestedCertifications.has(entry.card!)) {
        certBtn.textContent = 'Requested';
        certBtn.disabled = true;
      } else {
        certBtn.textContent = 'Certify';
        certBtn.addEventListener('click', () => {
          certBtn.disabled = true;
          certBtn.textContent = 'Requested';
          appState.requestedCertifications.add(entry.card!);
          void fetch('/api/certification-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cardId: entry.card }),
          }).then(async r => {
            if (!r.ok) {
              const data = await r.json() as { error?: string };
              certBtn.disabled = false;
              certBtn.textContent = 'Certify';
              appState.requestedCertifications.delete(entry.card!);
              await showAlert(data.error ?? 'Certification request failed');
            }
          });
        });
      }
      actions.appendChild(certBtn);
    }
    for (const qtyBtn of qtyButtons) actions.appendChild(qtyBtn);
    row.appendChild(actions);
    container.appendChild(row);
  }
}

/** Clear the deck editor's card preview. */
function clearDeckEditorPreview(): void {
  const preview = document.getElementById('deck-editor-preview')!;
  preview.innerHTML = '';
  preview.style.left = '';
}

/** Show the card preview for a deck editor card row. */
function showDeckEditorPreview(row: HTMLElement): void {
  const screen = document.getElementById('deck-editor-screen')!;
  const preview = document.getElementById('deck-editor-preview')!;
  const def = cardPool[row.dataset.cardId!];
  if (!def) return;

  // Position preview one column to the right of the hovered card;
  // Sideboard (4th) previews in Hazards column, Sites (5th) previews in Sideboard column.
  const section = row.closest('.deck-editor-section');
  const sections = [...screen.querySelectorAll('.deck-editor-section')];
  const sectionIdx = section ? sections.indexOf(section) : -1;
  // Section indices: 0=Pool/Characters, 1=Resources, 2=Hazards, 3=Sideboard, 4=Sites
  // Target columns:  0->1, 1->2, 2->3, 3->2 (Hazards), 4->3 (Sideboard)
  const targetCol = [1, 2, 3, 2, 3][sectionIdx] ?? 0;
  const targetSection = sections[targetCol] as HTMLElement | undefined;
  preview.className = 'deck-editor-preview';
  if (targetSection) {
    const targetRect = targetSection.getBoundingClientRect();
    preview.style.left = `${targetRect.left}px`;
    preview.style.right = '';
  }

  preview.innerHTML = '';
  const info = document.createElement('div');
  info.className = 'card-preview-info';

  const name = document.createElement('div');
  name.className = 'card-preview-name';
  name.textContent = def.name;
  info.appendChild(name);

  // Card image
  const imgPath = cardImageProxyPath(def);
  if (imgPath) {
    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    info.appendChild(img);
  }

  buildCardAttributes(info, def);
  preview.appendChild(info);
}

/**
 * Re-evaluate the preview after rows changed under the cursor: show the card
 * row now at (x, y), or clear the preview if there is none.
 */
function refreshPreviewUnderCursor(x: number, y: number): void {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const row = el?.closest<HTMLElement>('.deck-editor-card[data-card-id]') ?? null;
  if (row) showDeckEditorPreview(row);
  else clearDeckEditorPreview();
}

/** Set up hover preview for card rows in the deck editor. */
export function setupDeckEditorPreview(): void {
  const screen = document.getElementById('deck-editor-screen')!;

  screen.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.deck-editor-card[data-card-id]');
    if (!row) return;
    showDeckEditorPreview(row);
  });

  screen.addEventListener('mouseout', (e) => {
    const row = (e.target as HTMLElement).closest('.deck-editor-card[data-card-id]');
    if (!row) return;
    clearDeckEditorPreview();
  });
}

/** Set up hover preview for card entries on the decks overview screen. */
export function setupDecksPreview(): void {
  const screen = document.getElementById('decks-screen')!;
  const preview = document.getElementById('decks-preview')!;

  screen.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.compact-deck-entry[data-card-id]');
    if (!row) return;
    const def = cardPool[row.dataset.cardId!];
    if (!def) return;

    // Position preview over the middle column, offset to the right
    const columns = [...screen.querySelectorAll('.lobby-column')];
    const targetCol = columns[1] as HTMLElement | undefined;
    preview.className = 'deck-editor-preview';
    if (targetCol) {
      const targetRect = targetCol.getBoundingClientRect();
      preview.style.left = `${targetRect.left + targetRect.width * 0.25}px`;
      preview.style.right = '';
    }

    preview.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'card-preview-info';

    const name = document.createElement('div');
    name.className = 'card-preview-name';
    name.textContent = def.name;
    info.appendChild(name);

    const imgPath = cardImageProxyPath(def);
    if (imgPath) {
      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      info.appendChild(img);
    }

    buildCardAttributes(info, def);
    preview.appendChild(info);
  });

  screen.addEventListener('mouseout', (e) => {
    const row = (e.target as HTMLElement).closest('.compact-deck-entry[data-card-id]');
    if (!row) return;
    preview.innerHTML = '';
    preview.style.left = '';
  });
}

/** Open the deck editor for a given deck ID. */
export async function openDeckEditor(deckId: string): Promise<void> {
  const [decksResp, sentResp] = await Promise.all([
    fetch('/api/my-decks'),
    fetch('/api/mail/sent'),
  ]);
  if (!decksResp.ok) return;
  const data = await decksResp.json() as { decks: FullDeck[]; currentDeck: string | null };
  const deck = data.decks.find(d => d.id === deckId);
  if (!deck) return;

  // Load sent mails to mark already-requested cards and certifications
  appState.requestedCards = new Set<string>();
  appState.requestedCertifications = new Set<string>();
  if (sentResp.ok) {
    const sent = await sentResp.json() as { messages: { topic: string; status: string; keywords: Record<string, string> }[] };
    for (const msg of sent.messages) {
      const pending = msg.status !== 'processed';
      if (pending && msg.topic === 'card-request' && msg.keywords.deckId && msg.keywords.cardName) {
        appState.requestedCards.add(`${msg.keywords.deckId}:${msg.keywords.cardName}`);
      }
      if (pending && msg.topic === 'certification-request' && msg.keywords.cardId) {
        appState.requestedCertifications.add(msg.keywords.cardId);
      }
    }
  }

  sessionStorage.setItem(EDITING_DECK_KEY, deckId);
  document.getElementById('deck-editor-title')!.textContent = deck.name;
  editingDeck = deck;
  if (!deck.sideboard) deck.sideboard = [];
  const sections: DeckSection[] = [
    { id: 'pool', label: 'Pool', entries: deck.pool },
    { id: 'characters', label: 'Characters', entries: deck.deck.characters },
    { id: 'hazards', label: 'Hazards', entries: deck.deck.hazards },
    { id: 'resources', label: 'Resources', entries: deck.deck.resources },
    { id: 'sites', label: 'Sites', entries: deck.sites },
    { id: 'sideboard', label: 'Sideboard', entries: deck.sideboard },
  ];
  for (const s of sections) {
    renderSection(s, deckId);
  }
  showScreenFn?.('deck-editor-screen');
}
