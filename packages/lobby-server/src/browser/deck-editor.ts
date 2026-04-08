/**
 * @module deck-editor
 *
 * Deck editor UI for viewing and modifying individual deck contents.
 * Renders card lists with request/certify buttons, handles hover previews,
 * and opens the editor screen for a given deck.
 */

import { cardImageProxyPath, getCardCss } from '@meccg/shared';
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

/** Render a list of card entries into a container element, sorted by card type then name. */
function renderCardList(container: HTMLElement, entries: DeckListEntry[], deckId: string): void {
  container.innerHTML = '';
  const sorted = sortDeckEntries(entries);
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
    } else {
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
      row.appendChild(btn);
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
      row.appendChild(certBtn);
    }
    container.appendChild(row);
  }
}

/** Set up hover preview for card rows in the deck editor. */
export function setupDeckEditorPreview(): void {
  const screen = document.getElementById('deck-editor-screen')!;
  const preview = document.getElementById('deck-editor-preview')!;

  screen.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.deck-editor-card[data-card-id]');
    if (!row) return;
    const def = cardPool[row.dataset.cardId!];
    if (!def) return;

    // Position preview on a specific column based on card type:
    // Characters -> col 2, Resources -> col 1, Hazards -> col 4, Sites -> col 3
    const section = row.closest('.deck-editor-section');
    const sections = [...screen.querySelectorAll('.deck-editor-section')];
    const sectionIdx = section ? sections.indexOf(section) : -1;
    // Section indices: 0=Pool/Characters, 1=Resources, 2=Hazards, 3=Sites
    // Target columns:  0->1 (col 2),       1->0 (col 1),  2->3 (col 4), 3->2 (col 3)
    const targetCol = [1, 0, 3, 2][sectionIdx] ?? 0;
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
  });

  screen.addEventListener('mouseout', (e) => {
    const row = (e.target as HTMLElement).closest('.deck-editor-card[data-card-id]');
    if (!row) return;
    preview.innerHTML = '';
    preview.style.left = '';
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
  renderCardList(document.getElementById('deck-editor-pool')!, deck.pool, deckId);
  renderCardList(document.getElementById('deck-editor-characters')!, deck.deck.characters, deckId);
  renderCardList(document.getElementById('deck-editor-hazards')!, deck.deck.hazards, deckId);
  renderCardList(document.getElementById('deck-editor-resources')!, deck.deck.resources, deckId);
  renderCardList(document.getElementById('deck-editor-sites')!, deck.sites, deckId);
  renderCardList(document.getElementById('deck-editor-sideboard')!, deck.sideboard ?? [], deckId);
  showScreenFn?.('deck-editor-screen');
}
