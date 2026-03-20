/**
 * @module render
 *
 * DOM rendering functions for the web client. Renders game state,
 * action buttons, draft info, and a message log.
 */

import type { PlayerView, GameAction, CardDefinition, CardDefinitionId } from '@meccg/shared';
import { describeAction, formatPlayerView, formatCardList, cardImageProxyPath, isCharacterCard, GENERAL_INFLUENCE } from '@meccg/shared';

/** Get an element by ID, throwing if not found. */
function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el;
}

/**
 * Maps ANSI SGR color codes to CSS color values.
 * Supports the codes used in format.ts: bold, dim, and 8 standard colors.
 */
const ANSI_TO_CSS: Record<string, string> = {
  '1': 'font-weight:bold',      // bold
  '2': 'opacity:0.6',           // dim
  '31': 'color:#e06060',        // red (hazard-creature)
  '32': 'color:#60c060',        // green (ally, resource-event)
  '33': 'color:#d0a040',        // yellow (item)
  '34': 'color:#6090e0',        // blue (character)
  '35': 'color:#c070c0',        // magenta (hazard-event, corruption)
  '36': 'color:#50b0b0',        // cyan (faction)
  '37': 'color:#d0d0d0',        // white (site)
  '90': 'color:#666',           // bright black / grey (unknown, debug)
  '93': 'color:#c07020',        // dark orange (balrog-site)
};

/** Convert a string containing ANSI escape codes to HTML with colored spans. */
function ansiToHtml(text: string): string {
  // Escape HTML entities first
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let result = '';
  let openSpans = 0;

  // Match ANSI escape sequences: ESC[ followed by semicolon-separated numbers, ending with 'm'
  // eslint-disable-next-line no-control-regex
  const parts = escaped.split(/\x1b\[([0-9;]*)m/);

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Text content — parse \x02id\x02name markers into data-card-id spans
      // eslint-disable-next-line no-control-regex
      result += parts[i].replace(/\x02([^\x02]+)\x02([^\x02]*)/g,
        (_m, id: string, name: string) =>
          `<span class="card-name" data-card-id="${id}">${name}</span>`);
    } else {
      // ANSI code(s)
      const codes = parts[i].split(';').filter(c => c !== '');
      for (const code of codes) {
        if (code === '0') {
          // Reset: close all open spans
          while (openSpans > 0) {
            result += '</span>';
            openSpans--;
          }
        } else {
          const css = ANSI_TO_CSS[code];
          if (css) {
            result += `<span style="${css}">`;
            openSpans++;
          }
        }
      }
    }
  }

  // Close any remaining open spans
  while (openSpans > 0) {
    result += '</span>';
    openSpans--;
  }

  return result;
}

// ---- Card image hover ----

/** Map from card definition ID to image proxy path. Built once from the card pool. */
let cardIdToImage: Map<string, string> | null = null;

/** Build (or return cached) card ID → image path map. */
function getCardIdToImage(cardPool: Readonly<Record<string, CardDefinition>>): Map<string, string> {
  if (cardIdToImage) return cardIdToImage;
  cardIdToImage = new Map();
  for (const card of Object.values(cardPool)) {
    const imgPath = cardImageProxyPath(card) ?? (card.image || undefined);
    if (imgPath) {
      cardIdToImage.set(card.id as string, imgPath);
    }
  }
  return cardIdToImage;
}

/**
 * Walk an element's .card-name spans (created by ansiToHtml from \x02 markers)
 * and resolve their data-card-id to an image proxy path for the hover handler.
 */
function tagCardImages(el: HTMLElement, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const map = getCardIdToImage(cardPool);
  const spans = el.querySelectorAll('.card-name[data-card-id]');
  for (const span of spans) {
    const id = (span as HTMLElement).dataset.cardId ?? '';
    const imgPath = map.get(id);
    if (imgPath) {
      (span as HTMLElement).dataset.cardImage = imgPath;
    }
  }
}

/** Floating image element for card hover preview. */
let hoverImg: HTMLImageElement | null = null;

function getHoverImg(): HTMLImageElement {
  if (hoverImg) return hoverImg;
  hoverImg = document.createElement('img');
  hoverImg.id = 'card-hover-img';
  document.body.appendChild(hoverImg);
  return hoverImg;
}

/** Set up global hover handlers for card name elements. */
document.addEventListener('mouseover', (e) => {
  const target = (e.target as HTMLElement).closest?.('[data-card-image]');
  if (!target) return;
  const img = getHoverImg();
  img.src = (target as HTMLElement).dataset.cardImage!;
  img.style.display = 'block';
});

document.addEventListener('mouseout', (e) => {
  const target = (e.target as HTMLElement).closest?.('[data-card-image]');
  if (!target) return;
  const img = getHoverImg();
  img.style.display = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!hoverImg || hoverImg.style.display === 'none') return;
  const imgW = hoverImg.offsetWidth || 350;
  const imgH = hoverImg.offsetHeight || 500;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x = e.clientX + 16;
  let y = e.clientY + 16;
  if (x + imgW > vw) x = e.clientX - imgW - 16;
  if (y + imgH > vh) y = vh - imgH;
  hoverImg.style.left = `${x}px`;
  hoverImg.style.top = `${y}px`;
});

/** Hide the hover image (e.g. when DOM is re-rendered and the hovered element disappears). */
function hideHoverImg(): void {
  if (hoverImg) hoverImg.style.display = 'none';
}

/** Render the game state using the shared ANSI formatter, converted to HTML. */
export function renderState(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  hideHoverImg();
  const el = $('state');
  el.innerHTML = ansiToHtml(formatPlayerView(view, cardPool));
  tagCardImages(el, cardPool);
}

/** Render draft-specific information with colored card names. */
export function renderDraft(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const section = $('draft-section');
  const el = $('draft');

  if (view.phaseState.phase !== 'setup' || view.phaseState.setupStep.step !== 'character-draft') {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const draft = view.phaseState.setupStep;
  const list = (ids: readonly CardDefinitionId[]) => formatCardList(ids, cardPool);

  const lines: string[] = [];
  lines.push(`Draft round: ${draft.round}`);
  lines.push(`Pool [0]: ${list(draft.draftState[0].pool)}`);
  lines.push(`Drafted [0]: ${list(draft.draftState[0].drafted)}`);
  lines.push(`Pool [1]: ${list(draft.draftState[1].pool)}`);
  lines.push(`Drafted [1]: ${list(draft.draftState[1].drafted)}`);
  if (draft.setAside.length > 0) {
    lines.push(`Set aside: ${list(draft.setAside)}`);
  }

  el.innerHTML = ansiToHtml(lines.join('\n'));
  tagCardImages(el, cardPool);
}

/** Render action buttons. */
export function renderActions(
  actions: readonly GameAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onClick: (action: GameAction) => void,
  instanceLookup?: Readonly<Record<string, CardDefinitionId>>,
): void {
  const el = $('actions');
  el.innerHTML = '';

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.innerHTML = ansiToHtml(describeAction(action, cardPool, instanceLookup));
    tagCardImages(btn, cardPool);
    btn.addEventListener('click', () => onClick(action));
    el.appendChild(btn);
  }
}

/** Get the list of card definition IDs to display in the hand arc. */
function getHandCards(view: PlayerView): CardDefinitionId[] {
  // During character draft, show the player's draft pool instead of hand
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    const selfIdx = getSelfDraftIndex(draft.draftState);
    return [...draft.draftState[selfIdx].pool];
  }
  // During character deck draft, show remaining pool characters
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-deck-draft') {
    const deckDraft = view.phaseState.setupStep.deckDraftState;
    // Self pool has real card IDs
    const selfIdx = deckDraft[0].remainingPool.length > 0
      && (deckDraft[0].remainingPool[0] as string) !== 'unknown-card' ? 0 : 1;
    return [...deckDraft[selfIdx].remainingPool];
  }
  // During item draft, show unassigned starting items
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'item-draft') {
    const itemDraft = view.phaseState.setupStep.itemDraftState;
    // Self items are in visibleInstances, opponent's are not
    const selfIdx = itemDraft[0].unassignedItems.length > 0
      && view.visibleInstances[itemDraft[0].unassignedItems[0] as string] ? 0 : 1;
    return itemDraft[selfIdx].unassignedItems.map(
      instId => view.visibleInstances[instId as string],
    ).filter((id): id is CardDefinitionId => id !== undefined);
  }
  return view.self.hand.map(c => c.definitionId);
}

/** Sum all marshalling point categories into a total score. */
function totalMP(mp: { character: number; item: number; faction: number; ally: number; kill: number; misc: number }): number {
  return mp.character + mp.item + mp.faction + mp.ally + mp.kill + mp.misc;
}

/** Render player names and scores in the visual view. */
export function renderPlayerNames(view: PlayerView): void {
  const selfEl = document.getElementById('self-name');
  const oppEl = document.getElementById('opponent-name');
  const selfScore = totalMP(view.self.marshallingPoints);
  const oppScore = totalMP(view.opponent.marshallingPoints);
  if (selfEl) {
    selfEl.innerHTML = `${view.self.name} <span class="score">${selfScore}</span>`;
  }
  if (oppEl) {
    oppEl.innerHTML = `${view.opponent.name} <span class="score">${oppScore}</span>`;
  }
}

/** Find which draft state index belongs to self (has real card IDs, not unknown-card). */
function getSelfDraftIndex(draftState: readonly [{ pool: readonly CardDefinitionId[] }, { pool: readonly CardDefinitionId[] }]): number {
  const hasRealCards = (pool: readonly CardDefinitionId[]) =>
    pool.length > 0 && (pool[0] as string) !== 'unknown-card';
  return hasRealCards(draftState[0].pool) ? 0
    : hasRealCards(draftState[1].pool) ? 1
    : 0;
}

/**
 * Find the legal action associated with a card in the hand arc, if any.
 *
 * Actions that need no extra parameters beyond identifying the card are
 * returned directly — clicking the card sends them immediately. Actions
 * that require additional arguments (e.g. assign-starting-item needs a
 * target character) return null for now; they'll need a separate target
 * selection step in the future.
 */
function findCardAction(defId: CardDefinitionId, legalActions: readonly GameAction[]): GameAction | null {
  for (const action of legalActions) {
    // Zero-parameter actions: clicking the card is sufficient
    if (action.type === 'draft-pick' && action.characterDefId === defId) return action;
    if (action.type === 'add-character-to-deck' && action.characterDefId === defId) return action;
    // Multi-parameter actions: card is playable (highlighted) but needs more info
    // For now, return the first matching action (e.g. first character target)
    if (action.type === 'assign-starting-item' && action.itemDefId === defId) return action;
  }
  return null;
}

/**
 * Returns instruction text for the current game phase, or null if none is needed.
 * Displayed in the center of the visual board to guide the player.
 */
function getInstructionText(view: PlayerView): string | null {
  if (view.phaseState.phase === 'setup') {
    switch (view.phaseState.setupStep.step) {
      case 'character-draft':
        return 'Character Draft — Pick a character from your pool. Both players reveal simultaneously. Collisions set the character aside.';
      case 'item-draft':
        return 'Starting Items — Assign your minor items to characters in your starting company.';
      case 'character-deck-draft':
        return 'Deck Building — Add remaining pool characters to your play deck, or pass to finish.';
      case 'starting-site-selection':
        return 'Site Selection — Choose your starting site from your site deck.';
      case 'character-placement':
        return 'Character Placement — Assign characters to your starting companies.';
      case 'initiative-roll':
        return 'Initiative — Roll dice to determine who goes first.';
    }
  }
  return null;
}

/** Render instruction text in the visual board. */
export function renderInstructions(view: PlayerView): void {
  const el = document.getElementById('instruction-text');
  if (!el) return;
  const text = getInstructionText(view);
  el.textContent = text ?? '';
}

/** Render drafted characters on the visual board during character draft. */
export function renderDrafted(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const selfEl = document.getElementById('drafted-self');
  const oppEl = document.getElementById('drafted-opponent');
  if (!selfEl || !oppEl) return;
  selfEl.innerHTML = '';
  oppEl.innerHTML = '';

  if (view.phaseState.phase !== 'setup' || view.phaseState.setupStep.step !== 'character-draft') return;

  const draft = view.phaseState.setupStep;
  const selfIdx = getSelfDraftIndex(draft.draftState);
  const oppIdx = 1 - selfIdx;

  function renderRow(el: HTMLElement, drafted: readonly CardDefinitionId[]): void {
    for (const defId of drafted) {
      const def = cardPool[defId as string];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;
      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      img.className = 'drafted-card';
      el.appendChild(img);
    }
  }

  renderRow(selfEl, draft.draftState[selfIdx].drafted);

  // Show total mind next to self drafted characters
  const selfMind = draft.draftState[selfIdx].drafted.reduce((sum, defId) => {
    const def = cardPool[defId as string];
    return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
  }, 0);
  if (draft.draftState[selfIdx].drafted.length > 0) {
    const badge = document.createElement('div');
    badge.className = 'mind-total';
    badge.innerHTML = `<span class="mind-total-label">Remaining GI</span>${GENERAL_INFLUENCE - selfMind}`;
    selfEl.appendChild(badge);
  }
  renderRow(oppEl, draft.draftState[oppIdx].drafted);

  // Show remaining GI for opponent
  const oppMind = draft.draftState[oppIdx].drafted.reduce((sum, defId) => {
    const def = cardPool[defId as string];
    return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
  }, 0);
  if (draft.draftState[oppIdx].drafted.length > 0) {
    const badge = document.createElement('div');
    badge.className = 'mind-total mind-total-opponent';
    badge.innerHTML = `<span class="mind-total-label">Remaining GI</span>${GENERAL_INFLUENCE - oppMind}`;
    oppEl.appendChild(badge);
  }
}

/** Render the player's hand (or draft pool) as an arc of card images in the visual view. */
export function renderHand(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  const el = document.getElementById('hand-arc');
  if (!el) return;
  el.innerHTML = '';

  const cards = getHandCards(view);
  const total = cards.length;
  el.style.setProperty('--total', String(total));
  // Overlap cards more when there are many
  const margin = total > 7 ? -4 : -2.5;
  el.style.setProperty('--card-margin', `${margin}vh`);

  for (let i = 0; i < total; i++) {
    const def = cardPool[cards[i] as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const action = findCardAction(cards[i], view.legalActions);
    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.className = action ? 'hand-card hand-card-playable' : 'hand-card hand-card-dimmed';
    img.style.setProperty('--i', String(i));
    if (action && onAction) {
      img.addEventListener('click', () => {
        // Calculate offset to fly toward screen center
        const rect = img.getBoundingClientRect();
        const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
        const dy = window.innerHeight * 0.35 - (rect.top + rect.height / 2);
        img.style.setProperty('--fly-x', `${dx}px`);
        img.style.setProperty('--fly-y', `${dy}px`);
        img.className = 'hand-card hand-card-played';
        img.addEventListener('animationend', () => onAction(action), { once: true });
      });
    }
    el.appendChild(img);
  }
}

/** Get the opponent's cards to display: draft pool during draft, card backs otherwise. */
function getOpponentCards(view: PlayerView): { cards: CardDefinitionId[]; hidden: boolean } {
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    // Opponent's pool has 'unknown-card' placeholders; self pool has real IDs
    const hasRealCards = (pool: readonly CardDefinitionId[]) =>
      pool.length > 0 && (pool[0] as string) !== 'unknown-card';
    const oppIdx = hasRealCards(draft.draftState[0].pool) ? 1 : 0;
    return { cards: [...draft.draftState[oppIdx].pool], hidden: true };
  }
  // Outside draft, show card backs for each card in opponent's hand
  const count = view.opponent.handSize;
  return { cards: new Array(count).fill('unknown-card' as CardDefinitionId), hidden: true };
}

/** Render the opponent's hand (or draft pool) as an arc at the top of the visual view. */
export function renderOpponentHand(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const el = document.getElementById('opponent-arc');
  if (!el) return;
  el.innerHTML = '';

  const { cards, hidden } = getOpponentCards(view);
  const total = cards.length;
  el.style.setProperty('--total', String(total));
  const margin = total > 7 ? -4 : -2.5;
  el.style.setProperty('--card-margin', `${margin}vh`);

  for (let i = 0; i < total; i++) {
    const img = document.createElement('img');
    if (hidden || (cards[i] as string) === 'unknown-card') {
      img.src = '/images/card-back.jpg';
      img.alt = 'Hidden card';
    } else {
      const def = cardPool[cards[i] as string];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;
      img.src = imgPath;
      img.alt = def.name;
    }
    img.className = 'opponent-card';
    img.style.setProperty('--i', String(i));
    el.appendChild(img);
  }
}

/** Append a message to the log. Auto-scrolls to bottom. */
export function renderLog(message: string, cardPool?: Readonly<Record<string, CardDefinition>>): void {
  const el = $('log');
  const line = document.createElement('div');
  line.innerHTML = ansiToHtml(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (cardPool) tagCardImages(line, cardPool);
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
