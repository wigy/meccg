/**
 * @module render-text-format
 *
 * Low-level text and HTML formatting helpers shared across render modules.
 * Includes HTML escaping, card-marker-to-HTML conversion, collapsible JSON
 * rendering for the debug view, and post-processing passes that inject
 * tooltips, dice markers, and styled frames into formatted game state text.
 */

import type { CardDefinition, CardDefinitionId, CardInstanceId, MarshallingPointTotals } from '@meccg/shared';
import { cardImageProxyPath, buildInstanceLookup, getCardCss, computeTournamentScore } from '@meccg/shared';
import { createMiniDie } from './dice.js';

// ---- HTML escaping and card marker conversion ----

/** Escape HTML special characters for safe insertion into innerHTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convert plain text with embedded \x02id\x02name\x02 card markers to HTML.
 * Card markers become `<span class="card-name" data-card-id="id">name</span>`.
 */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text);
  // eslint-disable-next-line no-control-regex
  return escaped.replace(/\x02([^\x02]+)\x02([^\x02]*)\x02/g,
    (_m, id: string, name: string) =>
      `<span class="card-name" data-card-id="${id}">${name}</span>`);
}

// ---- Card image tagging ----

/** Map from card definition ID to image proxy path. Built once from the card pool. */
let cardIdToImage: Map<string, string> | null = null;

/** Build (or return cached) card ID -> image path map. */
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
 * Walk an element's .card-name spans (created by textToHtml from \x02 markers)
 * and resolve their data-card-id to an image proxy path and card-type color.
 */
export function tagCardImages(el: HTMLElement, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const map = getCardIdToImage(cardPool);
  const spans = el.querySelectorAll('.card-name[data-card-id]');
  for (const span of spans) {
    const id = (span as HTMLElement).dataset.cardId ?? '';
    const imgPath = map.get(id);
    if (imgPath) {
      (span as HTMLElement).dataset.cardImage = imgPath;
    }
    const def = cardPool[id];
    const css = def ? getCardCss(def) : undefined;
    if (css) {
      (span as HTMLElement).style.cssText += css;
    }
  }
}

// ---- Collapsible JSON rendering ----

/** Auto-incrementing counter for unique collapsible JSON node IDs. */
let jsonNodeCounter = 0;
/** Cached instance lookup, set before rendering collapsible JSON and used throughout. */
let cachedInstanceLookup: ReturnType<typeof buildInstanceLookup> = () => undefined;

/** Reset the JSON node counter (called before rendering a new state). */
export function resetJsonNodeCounter(): void {
  jsonNodeCounter = 0;
}

/** Set the cached instance lookup (called before rendering a new state). */
export function setCachedInstanceLookup(lookup: ReturnType<typeof buildInstanceLookup>): void {
  cachedInstanceLookup = lookup;
}

/** Get the current cached instance lookup function. */
export function getCachedInstanceLookup(): ReturnType<typeof buildInstanceLookup> {
  return cachedInstanceLookup;
}

/**
 * Render a JSON value as HTML with collapsible objects/arrays.
 * Primitives render inline; objects and arrays are collapsed by default
 * with a "+" toggle to expand.
 */
export function renderCollapsibleJson(value: unknown, indent: string): string {
  if (value === null) return '<span style="color:#888">null</span>';
  if (typeof value === 'boolean') return `<span style="color:#c4a35a">${value}</span>`;
  if (typeof value === 'number') return `<span style="color:#6c9">${value}</span>`;
  if (typeof value === 'string') {
    // Card definition ID (e.g. "tw-123", "le-24")
    if (/^[a-z]{2}-\d+$/.test(value)) {
      return `<span class="card-name" data-card-id="${escapeHtml(value)}" style="color:#e8a">"${escapeHtml(value)}"</span>`;
    }
    // Card instance ID (e.g. "i-123") — resolve via instance lookup
    if (/^i-\d+$/.test(value)) {
      const defId = cachedInstanceLookup(value as CardInstanceId);
      if (defId) {
        return `<span class="card-name" data-card-id="${escapeHtml(defId as string)}" style="color:#e8a">"${escapeHtml(value)}"</span>`;
      }
    }
    return `<span style="color:#e8a">"${escapeHtml(value)}"</span>`;
  }

  const isAtom = (v: unknown): boolean =>
    v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

  const nextIndent = indent + '  ';

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // All-atom short arrays render inline
    if (value.every(isAtom) && value.length <= 6) {
      return `[${value.map(v => renderCollapsibleJson(v, indent)).join(', ')}]`;
    }
    const id = `json-node-${++jsonNodeCounter}`;
    const preview = `[${value.length}]`;
    const items = value.map((v, i) =>
      `${nextIndent}${renderCollapsibleJson(v, nextIndent)}${i < value.length - 1 ? ',' : ''}`,
    ).join('\n');
    return `<span class="pile-toggle" style="width:auto;padding:0 0.3em" onclick="const t=document.getElementById('${id}');t.classList.toggle('hidden');this.textContent=this.textContent.startsWith('+')?'− ${preview}':'+ ${preview}'">+ ${preview}</span>`
      + `<span id="${id}" class="hidden">[\n${items}\n${indent}]</span>`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    // Show all keys: atomic values inline, complex values as "+" toggle
    const lines: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      const comma = i < entries.length - 1 ? ',' : '';
      const keySpan = `<span style="color:#8bf">"${escapeHtml(k)}"</span>`;
      if (isAtom(v) || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0)) {
        lines.push(`${nextIndent}${keySpan}: ${renderCollapsibleJson(v, nextIndent)}${comma}`);
      } else {
        const id = `json-node-${++jsonNodeCounter}`;
        const rendered = renderCollapsibleJson(v, nextIndent);
        lines.push(
          `${nextIndent}${keySpan}: <span class="pile-toggle" style="width:auto;padding:0 0.3em" onclick="const t=document.getElementById('${id}');t.classList.toggle('hidden');this.style.display='none'">+</span>`
          + `<span id="${id}" class="hidden">${rendered}</span>${comma}`,
        );
      }
    }
    return `{\n${lines.join('\n')}\n${indent}}`;
  }

  return `<span style="color:#888">${escapeHtml(typeof value)}</span>`;
}

// ---- Post-processing passes ----

/**
 * Wrap comma-separated card lists in a collapsible toggle.
 * Matches patterns like "[card1, card2, card3]" inside formatted output
 * and replaces them with a clickable "N cards" toggle.
 */
export function makeCardListsCollapsible(html: string): string {
  // Match spans of card-name elements separated by commas, wrapped in brackets
  const pattern = /\[(<span class="card-name"[^>]*>[^<]+<\/span>(?:, <span class="card-name"[^>]*>[^<]+<\/span>)*)\]/g;
  return html.replace(pattern, (_match, inner: string) => {
    const count = (inner.match(/<span class="card-name"/g) ?? []).length;
    if (count <= 3) return `[${inner}]`;
    const id = `card-list-${++jsonNodeCounter}`;
    return `<span class="pile-toggle" style="width:auto;padding:0 0.3em" onclick="const t=document.getElementById('${id}');t.classList.toggle('hidden');this.textContent=this.textContent.startsWith('+')?'− [${count} cards]':'+ [${count} cards]'">+ [${count} cards]</span>`
      + `<span id="${id}" class="hidden">[${inner}]</span>`;
  });
}

/**
 * Wrap MP values in styled tooltips that show the breakdown on hover.
 * Parses «MP:{JSON}» markers emitted by the shared formatter and replaces
 * them with an empty string (the score is rendered inline after the marker).
 * The tooltip table is injected around the following score text.
 */
export function injectMPTooltips(html: string): string {
  return html.replace(
    /«MP:(\{[^»]+\})»(-?\d+) MP/g,
    (_m, json: string, score: string) => {
      try {
        const data = JSON.parse(json) as {
          selfName: string; oppName: string;
          selfRaw: MarshallingPointTotals; oppRaw: MarshallingPointTotals;
          selfAdj: MarshallingPointTotals; oppAdj: MarshallingPointTotals;
        };
        const cats: { key: keyof MarshallingPointTotals; label: string }[] = [
          { key: 'character', label: 'Chars' },
          { key: 'item', label: 'Items' },
          { key: 'faction', label: 'Factions' },
          { key: 'ally', label: 'Allies' },
          { key: 'kill', label: 'Kill' },
          { key: 'misc', label: 'Misc' },
        ];
        const selfTotal = computeTournamentScore(data.selfRaw, data.oppRaw);
        const oppTotal = computeTournamentScore(data.oppRaw, data.selfRaw);
        let rows = '';
        for (const { key, label } of cats) {
          const s = data.selfAdj[key] !== data.selfRaw[key]
            ? `${data.selfAdj[key]} (${data.selfRaw[key]})` : `${data.selfRaw[key]}`;
          const o = data.oppAdj[key] !== data.oppRaw[key]
            ? `${data.oppAdj[key]} (${data.oppRaw[key]})` : `${data.oppRaw[key]}`;
          rows += `<tr><td class="mp-label">${label}</td><td class="mp-value">${s}</td><td class="mp-value">${o}</td></tr>`;
        }
        const tooltip = `<table class="mp-tooltip-table">
          <thead><tr><th></th><th>${data.selfName}</th><th>${data.oppName}</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${selfTotal}</td><td class="mp-value mp-total">${oppTotal}</td></tr></tfoot>
        </table>`;
        return `<span class="mp-badge">${score} MP<span class="mp-tooltip">${tooltip}</span></span>`;
      } catch {
        return `${score} MP`;
      }
    },
  );
}

/**
 * Replace «DICE:d1,d2,variant» markers with placeholder spans that will be
 * hydrated into 3D dice. The markers are generated by the shared formatter
 * for dice roll results.
 */
export function injectDiceMarkers(html: string): string {
  return html.replace(/«DICE:(\d),(\d),(black|red)»/g, (_match, d1, d2, variant) => {
    return `<span class="dice-placeholder" data-d1="${d1}" data-d2="${d2}" data-variant="${variant}"></span>`;
  });
}

/** Replace dice placeholder spans with actual 3D mini-dice DOM elements. */
export function hydrateDicePlaceholders(container: HTMLElement): void {
  for (const placeholder of container.querySelectorAll('.dice-placeholder')) {
    const d1 = parseInt(placeholder.getAttribute('data-d1')!, 10);
    const d2 = parseInt(placeholder.getAttribute('data-d2')!, 10);
    const variant = placeholder.getAttribute('data-variant') as 'black' | 'red';
    const pair = document.createElement('span');
    pair.className = 'dice-pair';
    pair.appendChild(createMiniDie(d1, variant));
    pair.appendChild(createMiniDie(d2, variant));
    placeholder.replaceWith(pair);
  }
}

/**
 * Wrap lines between «ACTIVE-START» and «ACTIVE-END» markers in a styled div
 * with a coloured border to highlight the active player's section.
 */
export function injectActivePlayerFrame(html: string): string {
  return html.replace(
    /«ACTIVE-START»\n?([\s\S]*?)«ACTIVE-END»\n?/g,
    '<div class="active-player-frame">$1</div>',
  );
}

/**
 * Wrap lines between «COMBAT-START» and «COMBAT-END» markers in a styled div
 * with a red border and tint to highlight the combat section.
 */
export function injectCombatFrame(html: string): string {
  return html.replace(
    /«COMBAT-START»\n?([\s\S]*?)«COMBAT-END»\n?/g,
    '<div class="combat-frame">$1</div>',
  );
}

/**
 * Wrap lines between «CHAIN-START» and «CHAIN-END» markers in a styled div
 * with a yellow border and tint to highlight the active chain.
 */
export function injectChainFrame(html: string): string {
  return html.replace(
    /«CHAIN-START»\n?([\s\S]*?)«CHAIN-END»\n?/g,
    '<div class="chain-frame">$1</div>',
  );
}

// ---- Card image hover (debug view) ----

/** Floating image element for card hover preview. */
let hoverImg: HTMLImageElement | null = null;
/** Floating JSON panel shown next to the hover image in debug view. */
let hoverJson: HTMLPreElement | null = null;
/** Card pool reference set by {@link setDebugCardPool}, used by the debug hover. */
let debugCardPool: Readonly<Record<string, CardDefinition>> | null = null;

/** Set the card pool reference for the debug hover JSON panel. */
export function setDebugCardPool(pool: Readonly<Record<string, CardDefinition>>): void {
  debugCardPool = pool;
}

function getHoverImg(): HTMLImageElement {
  if (hoverImg) return hoverImg;
  hoverImg = document.createElement('img');
  hoverImg.id = 'card-hover-img';
  document.body.appendChild(hoverImg);
  return hoverImg;
}

function getHoverJson(): HTMLPreElement {
  if (hoverJson) return hoverJson;
  hoverJson = document.createElement('pre');
  hoverJson.id = 'card-hover-json';
  document.body.appendChild(hoverJson);
  return hoverJson;
}

/** Set up global hover handlers for card name elements. */
document.addEventListener('mouseover', (e) => {
  const target = (e.target as HTMLElement).closest?.('[data-card-image]');
  if (!target) return;
  const img = getHoverImg();
  img.src = (target as HTMLElement).dataset.cardImage!;
  img.style.display = 'block';

  // Show JSON panel with card data
  const cardId = (target as HTMLElement).dataset.cardId;
  const def = cardId && debugCardPool ? debugCardPool[cardId] : undefined;
  if (def) {
    const json = getHoverJson();
    json.textContent = JSON.stringify(def, null, 2);
    json.style.display = 'block';
  }
});

document.addEventListener('mouseout', (e) => {
  const target = (e.target as HTMLElement).closest?.('[data-card-image]');
  if (!target) return;
  const img = getHoverImg();
  img.style.display = 'none';
  const json = getHoverJson();
  json.style.display = 'none';
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

  // Position JSON panel next to the image
  if (hoverJson && hoverJson.style.display !== 'none') {
    const jsonW = hoverJson.offsetWidth || 300;
    const jsonH = hoverJson.offsetHeight || 400;
    let jx = x + imgW + 8;
    if (jx + jsonW > vw) jx = x - jsonW - 8;
    let jy = y;
    if (jy + jsonH > vh) jy = vh - jsonH;
    if (jy < 0) jy = 0;
    hoverJson.style.left = `${jx}px`;
    hoverJson.style.top = `${jy}px`;
  }
});

/** Hide the hover image (e.g. when DOM is re-rendered and the hovered element disappears). */
export function hideHoverImg(): void {
  if (hoverImg) hoverImg.style.display = 'none';
  if (hoverJson) hoverJson.style.display = 'none';
}

// ---- Shared icon maps ----

/** Map region type codes to icon file names for inline path display. */
export const REGION_ICON_CODES: Record<string, string> = {
  wilderness: 'w', shadow: 's', dark: 'd', coastal: 'c', free: 'f', border: 'b',
};

/** Map site type codes to icon file names for inline display. */
export const SITE_ICON_CODES: Record<string, string> = {
  'haven': 'haven', 'free-hold': 'free-hold', 'border-hold': 'border-hold',
  'ruins-and-lairs': 'ruins-and-lairs', 'shadow-hold': 'shadow-hold', 'dark-hold': 'dark-hold',
};

/** Find the non-viable reason for a card by definition ID from the evaluated actions. */
export function findNonViableReason(
  defId: CardDefinitionId,
  evaluated: readonly { viable: boolean; reason?: string; action: { type: string; characterInstanceId?: CardInstanceId; itemDefId?: CardDefinitionId; siteInstanceId?: CardInstanceId; cardInstanceId?: CardInstanceId } }[],
  instanceLookup?: (id: CardInstanceId) => CardDefinitionId | undefined,
): string | undefined {
  for (const ea of evaluated) {
    if (ea.viable) continue;
    const a = ea.action;
    if (a.type === 'draft-pick' && instanceLookup
      && instanceLookup(a.characterInstanceId!) === defId) return ea.reason;
    if (a.type === 'add-character-to-deck' && instanceLookup
      && instanceLookup(a.characterInstanceId!) === defId) return ea.reason;
    if (a.type === 'assign-starting-item' && a.itemDefId === defId) return ea.reason;
    if (a.type === 'select-starting-site' && instanceLookup
      && instanceLookup(a.siteInstanceId!) === defId) return ea.reason;
    if (a.type === 'play-character' && instanceLookup
      && instanceLookup(a.characterInstanceId!) === defId) return ea.reason;
    if (a.type === 'not-playable' && instanceLookup
      && instanceLookup(a.cardInstanceId!) === defId) return ea.reason;
    // Generic fallback: match any non-viable action whose cardInstanceId resolves to this card
    if (a.cardInstanceId && instanceLookup
      && instanceLookup(a.cardInstanceId) === defId) return ea.reason;
  }
  return undefined;
}
