/**
 * @module deck-editor
 *
 * Deck editor UI for viewing and modifying individual deck contents.
 * Renders card lists with request/certify buttons, handles hover previews,
 * and opens the editor screen for a given deck.
 */

import {
  getCardCss, validateDeck, CHARACTER_CARD_TYPES,
  type CardDefinition, type DeckList,
} from '@meccg/shared';
import {
  appState, cardPool, type FullDeck, type DeckListEntry,
  sortDeckEntries, EDITING_DECK_KEY, type ScreenId,
} from './app-state.js';
import { buildCardPreviewInfo } from './render.js';
import { showAlert, showConfirm } from './dialog.js';
import { apiSend } from './api.js';
import { renderMarkdown } from './markdown.js';

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

/**
 * Editor-only check (not a deck-construction rule): one marker per card whose
 * definition has not been certified (its effects implemented and verified by a
 * card test — such cards lack the `certified` date field). Returned in the same
 * shape as validation errors so the editor can render the same per-card marker.
 */
function collectUncertifiedCards(deck: FullDeck): { section: string; message: string; card: string }[] {
  const sections: [DeckListEntry[], string][] = [
    [deck.pool, 'pool'],
    [deck.deck.characters, 'characters'],
    [deck.deck.hazards, 'hazards'],
    [deck.deck.resources, 'resources'],
    [deck.sites, 'sites'],
    [deck.sideboard ?? [], 'sideboard'],
    [deck.antiFwSideboard ?? [], 'anti-fw-sideboard'],
  ];
  const out: { section: string; message: string; card: string }[] = [];
  const seen = new Set<string>();
  for (const [entries, section] of sections) {
    for (const e of entries) {
      if (!e.card || seen.has(`${section}:${e.card}`)) continue;
      const def = cardPool[e.card] as { name?: string; certified?: string } | undefined;
      if (!def || def.certified) continue;
      seen.add(`${section}:${e.card}`);
      out.push({ section, message: `card "${def.name ?? e.card}" is not yet certified`, card: e.card });
    }
  }
  return out;
}

/**
 * Re-run deck validation and refresh the error display: general errors go
 * to the common area above the sections, card-specific errors put a warning
 * marker (with the messages as tooltip) on every row showing that card.
 * Uncertified-card markers are an editor-only overlay, not rule violations.
 */
function refreshValidation(): void {
  const box = document.getElementById('deck-editor-errors');
  if (!editingDeck || !box) return;
  const errors = [
    ...validateDeck(editingDeck as unknown as DeckList, cardPool),
    ...collectUncertifiedCards(editingDeck),
  ];
  const general = errors.filter(e => !e.card);
  const cardErrorCount = errors.length - general.length;
  box.textContent = '';
  box.classList.toggle('hidden', errors.length === 0);
  const addLine = (text: string) => {
    const line = document.createElement('div');
    line.className = 'deck-editor-error';
    line.textContent = text.charAt(0).toUpperCase() + text.slice(1);
    box.appendChild(line);
  };
  // The section label already says where the error is; drop the message's
  // own "play deck:" / "pool:" style prefix to avoid stating it twice.
  const stripPrefix = (m: string) => m.replace(/^(?:[\w-]+ deck|pool|sideboard): /, '');
  for (const err of general) {
    addLine(err.section === 'general' ? err.message : `${err.section}: ${stripPrefix(err.message)}`);
  }
  if (cardErrorCount > 0) {
    addLine(`other: there are ${cardErrorCount} card specific error${cardErrorCount === 1 ? '' : 's'}`);
  }
  const byCard = new Map<string, string[]>();
  for (const err of errors) {
    if (err.card) byCard.set(err.card, [...(byCard.get(err.card) ?? []), err.message]);
  }
  const screen = document.getElementById('deck-editor-screen')!;
  for (const marker of screen.querySelectorAll('.deck-editor-card-error')) marker.remove();
  for (const row of screen.querySelectorAll<HTMLElement>('.deck-editor-card[data-card-id]')) {
    const messages = byCard.get(row.dataset.cardId!);
    if (!messages) continue;
    const marker = document.createElement('span');
    marker.className = 'deck-editor-card-error';
    marker.textContent = '⚠';
    marker.title = messages.join('\n');
    row.querySelector('.deck-editor-card-name')?.after(marker);
  }
}

/** Render one section's card list and its title with the card count. */
function renderSection(section: DeckSection, deckId: string): void {
  renderCardList(document.getElementById(`deck-editor-${section.id}`)!, section, deckId);
  refreshValidation();
  const total = section.entries.reduce((sum, e) => sum + e.qty, 0);
  const titleEl = document.getElementById(`deck-editor-${section.id}-title`)!;
  titleEl.textContent = '';
  titleEl.classList.add('deck-editor-section-title');
  const label = document.createElement('span');
  label.textContent = `${section.label} (${total})`;
  titleEl.appendChild(label);
  const browsable: Record<string, { preset: TogglePreset; title: string }> = {
    characters: { preset: 'characters', title: 'Add a character card' },
    pool: { preset: 'pool', title: 'Add a starting character or item' },
    resources: { preset: 'resources', title: 'Add a resource card' },
    hazards: { preset: 'hazards', title: 'Add a hazard card' },
    sideboard: { preset: 'sideboard', title: 'Add a sideboard card' },
    'anti-fw-sideboard': { preset: 'sideboard', title: 'Add a card to the FW Sideboard' },
    sites: { preset: 'sites', title: 'Add a site card' },
  };
  const actions = document.createElement('span');
  actions.className = 'deck-editor-section-actions';
  const browse = browsable[section.id];
  if (browse) {
    const addBtn = document.createElement('button');
    addBtn.className = 'deck-editor-add-btn';
    addBtn.textContent = '+';
    addBtn.title = browse.title;
    // The toggles fully define the browsable categories; no extra base filter.
    addBtn.addEventListener('click', () => openCardBrowser(section, deckId, `Add a card to ${section.label}`,
      () => true,
      browserToggles(editingDeck?.alignment ?? '', browse.preset)));
    actions.appendChild(addBtn);
  }
  const clearBtn = document.createElement('button');
  clearBtn.className = 'deck-editor-clear-btn';
  const clearIcon = document.createElement('span');
  clearIcon.className = 'card-browser-clear-icon';
  clearIcon.textContent = '\u{1F5D1}\u{FE0F}';
  clearBtn.appendChild(clearIcon);
  clearBtn.title = `Remove all cards from ${section.label}`;
  clearBtn.addEventListener('click', () => clearSection(section, deckId));
  actions.appendChild(clearBtn);
  titleEl.appendChild(actions);
}

/**
 * Clear all entries from a section after confirmation, save, and
 * re-render. Restores the entries if saving fails.
 */
function clearSection(section: DeckSection, deckId: string): void {
  const total = section.entries.reduce((sum, e) => sum + e.qty, 0);
  if (total === 0) return;
  void showConfirm(`Remove all ${total} cards from ${section.label}?`).then(ok => {
    if (!ok) return;
    const removed = section.entries.splice(0, section.entries.length);
    renderSection(section, deckId);
    void saveEditingDeck().then(saved => {
      if (!saved) {
        section.entries.push(...removed);
        renderSection(section, deckId);
      }
    });
  });
}

/** A card category toggle shown as an icon button in the card browser. */
interface BrowserToggle {
  icon: string;
  title: string;
  match: (def: CardDefinition) => boolean;
  active: boolean;
  /**
   * Which selector group the toggle belongs to. Groups combine with AND:
   * a card must match an active toggle in every group that has any active
   * toggles; a fully inactive group imposes no constraint.
   */
  group: 'alignment' | 'type';
  /** Render a vertical divider before this toggle, separating toggle groups. */
  separatorBefore?: boolean;
}

/** Extract loosely-typed filter traits from any card definition. */
const traits = (def: CardDefinition) => def as unknown as {
  cardType: string; race?: string; alignment?: string; keywords?: readonly string[];
  subtype?: string; marshallingPoints?: number; siteType?: string;
};

/** Which deck section a card browser was opened from; decides toggle defaults. */
type TogglePreset = 'characters' | 'pool' | 'resources' | 'hazards' | 'sideboard' | 'sites';

/**
 * Build the category toggles for the card browser as two orthogonal groups:
 * alignment selectors (hero/minion/fallen-wizard/balrog) and card-type
 * selectors. The deck's alignment decides which alignment selectors start
 * enabled and the preset decides which type selectors start enabled; the
 * rest can be toggled on to browse beyond the defaults.
 */
function browserToggles(alignment: string, preset: TogglePreset): BrowserToggle[] {
  return [...alignmentToggles(alignment), ...typeToggles(preset)];
}

/**
 * Alignment selectors matching each card's own alignment tag. The deck's
 * alignment decides the initial set: fallen-wizard decks also draw on hero
 * and minion cards, and balrog decks on minion cards. An unknown deck
 * alignment enables every selector. Cards without an alignment tag
 * (hazards) are alignment-neutral and pass every selector.
 */
function alignmentToggles(alignment: string): BrowserToggle[] {
  const deckCardAlignments: Record<string, string[]> = {
    hero: ['wizard'],
    minion: ['ringwraith'],
    'fallen-wizard': ['wizard', 'ringwraith', 'fallen-wizard'],
    balrog: ['ringwraith', 'balrog'],
  };
  const enabled = deckCardAlignments[alignment];
  // Stage resources (alignment 'stage') are Fallen-wizard-only cards, and 'dual'
  // cards are playable by either minion or Fallen-wizard players — so the
  // Fallen-wizard selector also matches stage/dual cards, and the minion
  // selector also matches dual cards. Otherwise the bulk of Fallen-wizard
  // resources (the stage cards) would be hidden from a Fallen-wizard deck.
  const toggle = (icon: string, title: string, cardAlignment: string, alsoMatch: readonly string[] = []): BrowserToggle => ({
    icon, title, group: 'alignment',
    active: enabled?.includes(cardAlignment) ?? true,
    match: d => {
      const a = traits(d).alignment;
      return a === undefined || a === cardAlignment || alsoMatch.includes(a);
    },
  });
  return [
    toggle('\u{1F9DD}', 'Hero cards', 'wizard'),
    toggle('\u{1F479}', 'Minion cards', 'ringwraith', ['dual']),
    toggle('\u{1F52E}', 'Fallen-wizard cards', 'fallen-wizard', ['stage', 'dual']),
    toggle('\u{1F525}', 'Balrog cards', 'balrog'),
  ];
}

/**
 * Card-type selectors, one per category regardless of alignment. The preset
 * decides the initial set: the characters section starts with the character
 * categories (avatars included), the pool with starting-company categories
 * (characters and starting items), the resources section with the resource
 * categories, and the hazards section with the hazard categories. The
 * sideboard holds anything but sites, so it enables every category.
 */
function typeToggles(preset: TogglePreset): BrowserToggle[] {
  const isAgent = (def: CardDefinition) => (traits(def).keywords ?? []).includes('agent');
  // Avatars are identified by their race; everyone else is an ordinary character.
  const isAvatar = (def: CardDefinition) =>
    ['wizard', 'ringwraith', 'fallen-wizard', 'balrog'].includes(traits(def).race ?? '');
  const isCharacter = (def: CardDefinition) => CHARACTER_CARD_TYPES.has(traits(def).cardType);
  const isItem = (def: CardDefinition) => traits(def).cardType.endsWith('-resource-item');
  const isEvent = (def: CardDefinition) => traits(def).cardType.endsWith('-resource-event');
  const hasMp = (def: CardDefinition) => (traits(def).marshallingPoints ?? 0) > 0;
  const sbOn = preset === 'sideboard';
  const charsOn = preset === 'characters' || preset === 'pool' || sbOn;
  const resOn = preset === 'resources' || sbOn;
  const hazOn = preset === 'hazards' || sbOn;
  return [
    { icon: '\u{1F464}', title: 'Characters', group: 'type', active: charsOn,
      separatorBefore: true,
      match: d => isCharacter(d) && !isAvatar(d) && !isAgent(d) },
    { icon: '\u{1F575}️', title: 'Agents', group: 'type', active: charsOn,
      match: d => isCharacter(d) && isAgent(d) && !isAvatar(d) },
    { icon: '\u{1F9D9}', title: 'Avatars', group: 'type', active: preset === 'characters' || sbOn,
      match: d => isCharacter(d) && isAvatar(d) },
    // Legitimate starting cards (events included) are explicitly marked
    // with the starting-item keyword; other minor items don't qualify.
    { icon: '\u{1F6E1}\u{FE0F}', title: 'Starting items', group: 'type', active: preset === 'pool' || sbOn,
      separatorBefore: true,
      match: d => (traits(d).keywords ?? []).includes('starting-item') },
    { icon: '\u{1F48D}', title: 'Rings', group: 'type', active: resOn,
      match: d => isRing(d) },
    { icon: '\u{1F48E}', title: 'Items (non-ring)', group: 'type', active: resOn,
      match: d => isItem(d) && !isRing(d) },
    { icon: '\u{1F6A9}', title: 'Factions', group: 'type', active: resOn,
      match: d => traits(d).cardType.endsWith('-resource-faction') },
    { icon: '\u{1F434}', title: 'Allies', group: 'type', active: resOn,
      match: d => traits(d).cardType.endsWith('-resource-ally') },
    { icon: '\u{1F3C5}', title: 'Misc marshalling points', group: 'type', active: resOn,
      match: d => isEvent(d) && hasMp(d) },
    { icon: '\u{1F4DC}', title: 'Resource events', group: 'type', active: resOn,
      match: d => isEvent(d) && !hasMp(d) },
    { icon: '\u{1F409}', title: 'Creatures', group: 'type', active: hazOn,
      separatorBefore: true,
      match: d => traits(d).cardType === 'hazard-creature' },
    { icon: '\u{26A1}', title: 'Hazard events', group: 'type', active: hazOn,
      match: d => traits(d).cardType === 'hazard-event' },
    ...siteTypeToggles(preset),
  ];
}

/**
 * Site selectors, one per site type. The sites section enables all of
 * them; in any other browser they start inactive and can be toggled on.
 */
function siteTypeToggles(preset: TogglePreset): BrowserToggle[] {
  const toggle = (icon: string, title: string, siteType: string, separatorBefore?: boolean): BrowserToggle => ({
    icon, title, group: 'type', active: preset === 'sites', ...(separatorBefore ? { separatorBefore } : {}),
    match: d => traits(d).siteType === siteType,
  });
  return [
    toggle('\u{1F3F0}', 'Havens', 'haven', true),
    toggle('\u{1F3D8}\u{FE0F}', 'Free-holds', 'free-hold'),
    toggle('\u{1F3EF}', 'Border-holds', 'border-hold'),
    toggle('\u{1F3DA}\u{FE0F}', 'Ruins and lairs', 'ruins-and-lairs'),
    toggle('\u{1F573}\u{FE0F}', 'Shadow-holds', 'shadow-hold'),
    toggle('\u{1F30B}', 'Dark-holds', 'dark-hold'),
  ];
}

/** Whether a card is a ring item: a gold ring or an item with the ring keyword. */
function isRing(def: CardDefinition): boolean {
  return traits(def).cardType.endsWith('resource-item')
    && (traits(def).subtype === 'gold-ring' || (traits(def).keywords ?? []).includes('ring'));
}

/**
 * Render the deck title: the deck name with an edit icon, or — in edit
 * mode — a name input with Save/Cancel (Enter saves, Escape cancels).
 * Saving persists the whole deck; a failed save restores the old name.
 */
function renderTitle(editing = false): void {
  const titleEl = document.getElementById('deck-editor-title');
  if (!titleEl || !editingDeck) return;
  const deck = editingDeck;
  titleEl.textContent = '';

  if (!editing) {
    const name = document.createElement('span');
    name.textContent = deck.name;
    titleEl.appendChild(name);
    const editBtn = document.createElement('button');
    editBtn.className = 'deck-editor-title-edit-btn';
    editBtn.textContent = '\u{270F}\u{FE0F}';
    editBtn.title = 'Rename this deck';
    editBtn.addEventListener('click', () => renderTitle(true));
    titleEl.appendChild(editBtn);
    return;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'deck-editor-title-input';
  input.value = deck.name;
  input.maxLength = 60;
  titleEl.appendChild(input);

  const commit = () => {
    const name = input.value.trim();
    if (!name || name === deck.name) {
      renderTitle();
      return;
    }
    const prev = deck.name;
    deck.name = name;
    renderTitle();
    void saveEditingDeck().then(ok => {
      if (!ok) {
        deck.name = prev;
        renderTitle();
      }
    });
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      renderTitle();
    }
  });

  const actions = document.createElement('span');
  actions.className = 'deck-editor-title-actions';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.title = 'Save the new deck name';
  saveBtn.addEventListener('click', commit);
  actions.appendChild(saveBtn);
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'deck-editor-title-btn--cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => renderTitle());
  actions.appendChild(cancelBtn);
  titleEl.appendChild(actions);

  input.focus();
  input.select();
}

/**
 * Render the deck notes panel: a collapsible block showing the deck's
 * Markdown notes with an edit mode (textarea + Save/Cancel). Saving
 * persists the whole deck; a failed save restores the previous notes.
 */
function renderNotes(editing = false): void {
  const box = document.getElementById('deck-editor-notes') as HTMLDetailsElement | null;
  if (!box || !editingDeck) return;
  const deck = editingDeck;
  const wasOpen = box.open;
  box.textContent = '';
  const summary = document.createElement('summary');
  summary.className = 'deck-editor-notes-summary';
  summary.textContent = deck.notes || editing ? 'Notes' : 'Notes (empty)';
  box.appendChild(summary);
  box.open = wasOpen || editing;

  if (editing) {
    const textarea = document.createElement('textarea');
    textarea.className = 'deck-editor-notes-input';
    textarea.placeholder = 'Notes about this deck, in Markdown…';
    textarea.value = deck.notes ?? '';
    // Grow the textarea to fit its content so editing never scrolls inside it.
    const autoGrow = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight + 2}px`;
    };
    textarea.addEventListener('input', autoGrow);
    box.appendChild(textarea);
    autoGrow();
    const actions = document.createElement('div');
    actions.className = 'deck-editor-notes-actions';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const prev = deck.notes;
      const text = textarea.value.trim();
      deck.notes = text || undefined;
      void saveEditingDeck().then(ok => {
        if (!ok) deck.notes = prev;
        renderNotes(!ok);
      });
    });
    actions.appendChild(saveBtn);
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'deck-editor-notes-btn--cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => renderNotes());
    actions.appendChild(cancelBtn);
    box.appendChild(actions);
    textarea.focus();
    return;
  }

  const view = document.createElement('div');
  view.className = 'deck-editor-notes-view';
  if (deck.notes) {
    view.innerHTML = renderMarkdown(deck.notes);
  } else {
    view.innerHTML = '<p class="lobby-empty">No notes yet.</p>';
  }
  box.appendChild(view);
  const actions = document.createElement('div');
  actions.className = 'deck-editor-notes-actions';
  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.title = 'Edit the deck notes';
  editBtn.addEventListener('click', () => renderNotes(true));
  actions.appendChild(editBtn);
  box.appendChild(actions);
}

/** Persist the deck currently being edited. Returns true on success. */
async function saveEditingDeck(): Promise<boolean> {
  if (!editingDeck) return false;
  const r = await apiSend('/api/my-decks', 'POST', editingDeck);
  if (!r.ok) {
    await showAlert(r.error ?? 'Failed to save deck');
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

/**
 * Add one copy of each card to a section (new entries if not present),
 * save once, and re-render. Restores the previous entries if saving fails.
 */
function addCardsToSection(cardIds: readonly string[], section: DeckSection, deckId: string): void {
  if (cardIds.length === 0) return;
  const before = section.entries.map(e => ({ ...e }));
  for (const cardId of cardIds) {
    const def = cardPool[cardId];
    const existing = section.entries.find(en => en.card === cardId);
    if (existing) {
      existing.qty += 1;
    } else {
      section.entries.push({ name: def ? def.name : cardId, card: cardId, qty: 1 });
    }
  }
  renderSection(section, deckId);
  void saveEditingDeck().then(ok => {
    if (!ok) {
      section.entries.splice(0, section.entries.length, ...before);
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
  search.placeholder = 'Search by name, card text, keyword, or skill…';
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
    const addAllBtn = document.createElement('button');
    addAllBtn.className = 'card-browser-add-all';
    addAllBtn.textContent = 'Add All';
    addAllBtn.title = 'Add one copy of every listed card';
    addAllBtn.addEventListener('click', () => {
      addCardsToSection(visibleCards().map(([cardId]) => cardId), section, deckId);
      close();
    });
    togglesEl.appendChild(addAllBtn);
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
    previewPane.appendChild(buildCardPreviewInfo(def));
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

  // Toggle groups AND together; within a group active toggles OR, and a
  // group with nothing active imposes no constraint.
  const matchesToggles = (def: CardDefinition): boolean =>
    (['alignment', 'type'] as const).every(group => {
      const active = toggles.filter(t => t.group === group && t.active);
      return active.length === 0 || active.some(t => t.match(def));
    });

  /** The cards currently visible in the list: passing both toggles and search. */
  const visibleCards = (): [string, CardDefinition][] => {
    const filter = search.value.trim().toLowerCase();
    return cards.filter(([, def]) => matchesToggles(def) && (!filter || matchesSearch(def, filter)));
  };

  const renderList = () => {
    list.innerHTML = '';
    for (const [cardId, def] of visibleCards()) {
      const item = document.createElement('div');
      item.className = 'card-browser-item';
      item.textContent = def.name;
      const style = getCardCss(def) ?? '';
      if (style) item.setAttribute('style', style);
      item.addEventListener('mouseover', () => showCardPreview(cardId));
      item.addEventListener('click', () => {
        addCardsToSection([cardId], section, deckId);
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
  preview.appendChild(buildCardPreviewInfo(def));
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
    preview.appendChild(buildCardPreviewInfo(def));
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
      // A request is still "pending" (its card/cert chip stays marked) until it
      // reaches a terminal state. `processed` means the work is done and its PR
      // is awaiting a merge/close decision; `success`/`failed` are the final
      // verdicts — none of these should re-mark the card as still-requested.
      const pending = msg.status !== 'processed' && msg.status !== 'success' && msg.status !== 'failed';
      if (pending && msg.topic === 'card-request' && msg.keywords.deckId && msg.keywords.cardName) {
        appState.requestedCards.add(`${msg.keywords.deckId}:${msg.keywords.cardName}`);
      }
      if (pending && msg.topic === 'certification-request' && msg.keywords.cardId) {
        appState.requestedCertifications.add(msg.keywords.cardId);
      }
    }
  }

  sessionStorage.setItem(EDITING_DECK_KEY, deckId);
  editingDeck = deck;
  renderTitle();
  if (!deck.sideboard) deck.sideboard = [];
  if (!deck.antiFwSideboard) deck.antiFwSideboard = [];
  const sections: DeckSection[] = [
    { id: 'pool', label: 'Pool', entries: deck.pool },
    { id: 'characters', label: 'Characters', entries: deck.deck.characters },
    { id: 'hazards', label: 'Hazards', entries: deck.deck.hazards },
    { id: 'resources', label: 'Resources', entries: deck.deck.resources },
    { id: 'sites', label: 'Sites', entries: deck.sites },
    { id: 'sideboard', label: 'Sideboard', entries: deck.sideboard },
    { id: 'anti-fw-sideboard', label: 'FW Sideboard', entries: deck.antiFwSideboard },
  ];
  for (const s of sections) {
    renderSection(s, deckId);
  }
  // Notes start collapsed each time a deck is opened.
  const notesBox = document.getElementById('deck-editor-notes') as HTMLDetailsElement | null;
  if (notesBox) notesBox.open = false;
  renderNotes();
  showScreenFn?.('deck-editor-screen');
}
