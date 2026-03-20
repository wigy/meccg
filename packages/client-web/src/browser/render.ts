/**
 * @module render
 *
 * DOM rendering functions for the web client. Renders game state,
 * action buttons, draft info, and a message log.
 */

import type { PlayerView, GameAction, CardDefinition, CardDefinitionId } from '@meccg/shared';
import { describeAction, formatPlayerView, formatCardList, cardImageProxyPath } from '@meccg/shared';

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

/** Append a message to the log. Auto-scrolls to bottom. */
export function renderLog(message: string): void {
  const el = $('log');
  const line = document.createElement('div');
  line.innerHTML = ansiToHtml(`[${new Date().toLocaleTimeString()}] ${message}`);
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
