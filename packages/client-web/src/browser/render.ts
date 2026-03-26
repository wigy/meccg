/**
 * @module render
 *
 * DOM rendering functions for the web client. Renders game state,
 * action buttons, draft info, and a message log.
 */

import type { PlayerView, GameAction, EvaluatedAction, CardDefinition, CardDefinitionId, CardInstanceId, CharacterInPlay, SiteInPlay, ChainEntry } from '@meccg/shared';
import { describeAction, formatPlayerView, formatCardList, cardImageProxyPath, isCharacterCard, GENERAL_INFLUENCE, getAlignmentRules, viableActions, formatSignedNumber, Phase, computeTournamentScore, computeTournamentBreakdown } from '@meccg/shared';
import type { MarshallingPointTotals } from '@meccg/shared';
import { $, createCardImage, createFaceDownCard, appendItemCards } from './render-utils.js';
import { createMiniDie, seedDiceFromState, restoreDice } from './dice.js';

/**
 * Find the non-viable reason for a card by definition ID from the evaluated actions.
 * Returns the reason string or undefined if the card is viable or not found.
 */
function findNonViableReason(
  defId: CardDefinitionId,
  evaluated: readonly EvaluatedAction[],
  visibleInstances?: Readonly<Record<string, CardDefinitionId>>,
): string | undefined {
  for (const ea of evaluated) {
    if (ea.viable) continue;
    const a = ea.action;
    if (a.type === 'draft-pick' && visibleInstances
      && visibleInstances[a.characterInstanceId as string] === defId) return ea.reason;
    if (a.type === 'add-character-to-deck' && visibleInstances
      && visibleInstances[a.characterInstanceId as string] === defId) return ea.reason;
    if (a.type === 'assign-starting-item' && a.itemDefId === defId) return ea.reason;
    if (a.type === 'select-starting-site' && visibleInstances
      && visibleInstances[a.siteInstanceId as string] === defId) return ea.reason;
    if (a.type === 'play-character' && visibleInstances
      && visibleInstances[a.characterInstanceId as string] === defId) return ea.reason;
    if (a.type === 'not-playable' && visibleInstances
      && visibleInstances[a.cardInstanceId as string] === defId) return ea.reason;
  }
  return undefined;
}

/**
 * Targeting instruction text displayed when the player is in a two-step
 * selection flow (item draft, play-character, move-to-influence).
 * Takes priority over phase-based instructions when set.
 */
let targetingInstruction: string | null = null;

/**
 * Set or clear the targeting instruction displayed in the center of the board.
 * Called from within render.ts and by external modules (e.g. company-view)
 * when entering/exiting two-step selection flows.
 */
export function setTargetingInstruction(text: string | null): void {
  targetingInstruction = text;
  const el = document.getElementById('instruction-text');
  if (!el) return;
  el.textContent = text ?? '';
}

/**
 * Module-level state for the item draft two-step selection flow.
 * When a player clicks an item in the hand arc, it becomes "selected" and
 * valid target characters are highlighted on the table. Clicking a target
 * character sends the assign-starting-item action.
 */
let selectedItemDefId: CardDefinitionId | null = null;

/** Cached arguments for re-rendering during item draft target selection. */
let itemDraftRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Re-render hand and drafted areas using cached state (for item draft selection flow). */
function reRenderItemDraft(): void {
  if (!itemDraftRenderCache) return;
  const { view, cardPool, onAction } = itemDraftRenderCache;
  renderHand(view, cardPool, onAction);
  renderDrafted(view, cardPool, onAction);
}

/**
 * Module-level state for the play-character two-step selection flow.
 * When a player clicks a playable character in the hand arc, the character
 * instance ID is stored here and the company view highlights valid targets.
 */
let selectedCharacterInstanceId: CardInstanceId | null = null;

/** Cached arguments for re-rendering during character play target selection. */
let playCharacterRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Returns the currently selected character instance ID for the play-character flow. */
export function getSelectedCharacterForPlay(): CardInstanceId | null {
  return selectedCharacterInstanceId;
}

/** Clear the play-character selection (called by company-view after action is sent). */
export function clearCharacterPlaySelection(): void {
  selectedCharacterInstanceId = null;
  setTargetingInstruction(null);
}

/** Re-render hand and company views using cached state (for character play selection flow). */
function reRenderCharacterPlay(): void {
  if (!playCharacterRenderCache) return;
  const { view, cardPool, onAction } = playCharacterRenderCache;
  renderHand(view, cardPool, onAction);
  // Import is circular-safe since renderCompanyViews is called as a function reference
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
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
/** Escape HTML special characters for safe insertion into innerHTML. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Auto-incrementing counter for unique collapsible JSON node IDs. */
let jsonNodeCounter = 0;
/** Visible instances map, set before rendering collapsible JSON. */
let jsonVisibleInstances: Readonly<Record<string, CardDefinitionId>> = {};

/**
 * Render a JSON value as HTML with collapsible objects/arrays.
 * Primitives render inline; objects and arrays are collapsed by default
 * with a "+" toggle to expand.
 */
function renderCollapsibleJson(value: unknown, indent: string): string {
  if (value === null) return '<span style="color:#888">null</span>';
  if (typeof value === 'boolean') return `<span style="color:#c4a35a">${value}</span>`;
  if (typeof value === 'number') return `<span style="color:#6c9">${value}</span>`;
  if (typeof value === 'string') {
    // Card definition ID (e.g. "tw-123", "le-24")
    if (/^[a-z]{2}-\d+$/.test(value)) {
      return `<span class="card-name" data-card-id="${escapeHtml(value)}" style="color:#e8a">"${escapeHtml(value)}"</span>`;
    }
    // Card instance ID (e.g. "i-123") — resolve via visibleInstances
    if (/^i-\d+$/.test(value)) {
      const defId = jsonVisibleInstances[value];
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
/** Floating JSON panel shown next to the hover image in debug view. */
let hoverJson: HTMLPreElement | null = null;
/** Card pool reference set by {@link setupCardPreview}, used by the debug hover. */
let debugCardPool: Readonly<Record<string, CardDefinition>> | null = null;

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
function hideHoverImg(): void {
  if (hoverImg) hoverImg.style.display = 'none';
  if (hoverJson) hoverJson.style.display = 'none';
}

/**
 * Post-process rendered state HTML to wrap card-list lines (starting with "    ·")
 * under Deck/Sites/Discard headings into collapsible sections with a "+" toggle button.
 */
function makeCardListsCollapsible(html: string): string {
  const lines = html.split('\n');
  const result: string[] = [];
  const PILE_RE = /^( {2})(Deck|Sites|Discard|Pool|Kill pile|Eliminated|Sideboard): (\d+)/;
  const CARD_LINE = '    ·';

  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(PILE_RE);
    if (match) {
      // Collect card lines that follow
      const cardLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith(CARD_LINE)) {
        cardLines.push(lines[j]);
        j++;
      }
      if (cardLines.length > 0) {
        // Render the heading with a toggle button and the card list hidden.
        // The hidden span is on the same line so no blank line appears when collapsed.
        const id = `pile-${i}`;
        result.push(
          `${lines[i]} <span class="pile-toggle" data-target="${id}" onclick="this.parentElement.querySelector('#${id}').classList.toggle('hidden');this.textContent=this.textContent==='+'?'−':'+'">+</span>`
          + `<span id="${id}" class="hidden">\n${cardLines.join('\n')}</span>`
        );
      } else {
        result.push(lines[i]);
      }
      i = j;
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  return result.join('\n');
}

/**
 * Replace «MP:JSON» markers in HTML with interactive tooltip spans.
 * The marker embeds both players' raw and adjusted MP breakdowns.
 */
function injectMPTooltips(html: string): string {
  return html.replace(/«MP:(\{[^»]*\})»(\d+) MP/g, (_match, json, total) => {
    try {
      const data = JSON.parse(json as string) as {
        selfName: string; oppName: string;
        selfRaw: MarshallingPointTotals; oppRaw: MarshallingPointTotals;
        selfAdj: MarshallingPointTotals; oppAdj: MarshallingPointTotals;
      };
      const tooltip = buildMPTooltip(
        data.selfName, data.selfRaw, data.selfAdj,
        data.oppName, data.oppRaw, data.oppAdj,
      );
      return `<span class="debug-score">${total} MP<span class="mp-tooltip mp-tooltip--below">${tooltip}</span></span>`;
    } catch {
      return `${total} MP`;
    }
  });
}

/**
 * Replace «DICE:d1,d2,variant» markers with placeholder spans, then inject
 * actual 3D mini-dice elements into those placeholders.
 */
function injectDiceMarkers(html: string): string {
  return html.replace(/«DICE:(\d),(\d),(black|red)»/g, (_match, d1, d2, variant) => {
    return `<span class="dice-placeholder" data-d1="${d1}" data-d2="${d2}" data-variant="${variant}"></span>`;
  });
}

/** Replace dice placeholder spans with actual 3D mini-dice DOM elements. */
function hydrateDicePlaceholders(container: HTMLElement): void {
  for (const placeholder of container.querySelectorAll('.dice-placeholder')) {
    const d1 = parseInt(placeholder.getAttribute('data-d1')!, 10);
    const d2 = parseInt(placeholder.getAttribute('data-d2')!, 10);
    const variant = placeholder.getAttribute('data-variant') as 'black' | 'red';
    const pair = document.createElement('span');
    pair.className = 'dice-inline-pair';
    pair.appendChild(createMiniDie(d1, variant));
    pair.appendChild(createMiniDie(d2, variant));
    placeholder.replaceWith(pair);
  }
}

/**
 * Wrap lines between «ACTIVE-START» and «ACTIVE-END» markers in a styled div
 * so the active player's entire block is visually framed.
 */
function injectActivePlayerFrame(html: string): string {
  return html.replace(
    /«ACTIVE-START»\n?([\s\S]*?)«ACTIVE-END»\n?/g,
    '<div class="active-player-frame">$1</div>',
  );
}

/**
 * Wrap lines between «COMBAT-START» and «COMBAT-END» markers in a styled div
 * with a red border and tint to highlight active combat.
 */
function injectCombatFrame(html: string): string {
  return html.replace(
    /«COMBAT-START»\n?([\s\S]*?)«COMBAT-END»\n?/g,
    '<div class="combat-frame">$1</div>',
  );
}

/**
 * Wrap lines between «CHAIN-START» and «CHAIN-END» markers in a styled div
 * with a yellow border and tint to highlight the active chain.
 */
function injectChainFrame(html: string): string {
  return html.replace(
    /«CHAIN-START»\n?([\s\S]*?)«CHAIN-END»\n?/g,
    '<div class="chain-frame">$1</div>',
  );
}

/** Render the game state using the shared ANSI formatter, converted to HTML. */
export function renderState(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  hideHoverImg();
  const el = $('state');
  const formatted = injectChainFrame(injectCombatFrame(injectActivePlayerFrame(injectDiceMarkers(injectMPTooltips(makeCardListsCollapsible(ansiToHtml(formatPlayerView(view, cardPool))))))));
  jsonNodeCounter = 0;
  jsonVisibleInstances = view.visibleInstances;
  const jsonId = 'raw-state-json';
  const rawJson = `\n\n<span class="pile-toggle" style="width:auto;padding:0 0.4em" onclick="const t=document.getElementById('${jsonId}');t.classList.toggle('hidden');this.textContent=this.textContent==='+ Raw JSON'?'− Raw JSON':'+ Raw JSON'">+ Raw JSON</span>`
    + `<span id="${jsonId}" class="hidden">\n${renderCollapsibleJson(view, '')}</span>`;
  el.innerHTML = formatted + rawJson;
  hydrateDicePlaceholders(el);
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
  const resolve = (ids: readonly CardInstanceId[]) =>
    ids.map(id => view.visibleInstances[id as string] ?? id as unknown as CardDefinitionId);
  const list = (ids: readonly CardInstanceId[]) => formatCardList(resolve(ids), cardPool);

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

/** Render Movement/Hazard phase information with key state details. */
export function renderMHInfo(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyNames: Readonly<Record<string, string>>,
): void {
  const section = $('mh-section');
  const el = $('mh-info');

  if (view.phaseState.phase !== Phase.MovementHazard) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const mh = view.phaseState;
  const lines: string[] = [];

  lines.push(`Step: ${mh.step}`);

  // Active company
  const selfIsResource = view.activePlayer === view.self.id;
  const resourceCompanies = selfIsResource ? view.self.companies : view.opponent.companies;
  if (mh.step !== 'select-company' && mh.activeCompanyIndex < resourceCompanies.length) {
    const activeCompany = resourceCompanies[mh.activeCompanyIndex];
    const name = companyNames[activeCompany.id as string] ?? `company #${mh.activeCompanyIndex}`;
    lines.push(`Active company: ${name}`);
  }

  // Handled companies
  if (mh.handledCompanyIds.length > 0) {
    const names = mh.handledCompanyIds.map(id => companyNames[id as string] ?? id).join(', ');
    lines.push(`Handled: ${names}`);
  }

  // Movement info
  if (mh.maxRegionDistance) {
    lines.push(`Max regions: ${mh.maxRegionDistance}`);
  }
  if (mh.movementType) {
    lines.push(`Movement type: ${mh.movementType}`);
  }
  if (mh.declaredRegionPath && mh.declaredRegionPath.length > 0) {
    const regionNames = mh.declaredRegionPath.map(id => {
      const def = cardPool[id as string];
      return def?.name ?? `${id}`;
    });
    lines.push(`Region path: ${regionNames.join(' → ')}`);
  }
  if (mh.resolvedSitePathNames.length > 0) {
    lines.push(`Site path: ${mh.resolvedSitePathNames.join(' → ')}`);
  }
  if (mh.destinationSiteName) {
    lines.push(`Destination: ${mh.destinationSiteName} (${mh.destinationSiteType ?? '?'})`);
  }

  // Hazard tracking
  const remaining = mh.hazardLimit - mh.hazardsPlayedThisCompany;
  lines.push(`Hazard limit: ${mh.hazardsPlayedThisCompany}/${mh.hazardLimit} played (${remaining} remaining)`);

  // Draw tracking
  lines.push(`Draws: resource ${mh.resourceDrawCount}/${mh.resourceDrawMax}, hazard ${mh.hazardDrawCount}/${mh.hazardDrawMax}`);

  // Pass state
  const passInfo: string[] = [];
  if (mh.resourcePlayerPassed) passInfo.push('resource');
  if (mh.hazardPlayerPassed) passInfo.push('hazard');
  if (passInfo.length > 0) {
    lines.push(`Passed: ${passInfo.join(', ')}`);
  }

  // Flags
  if (mh.onGuardPlacedThisCompany) lines.push('On-guard card placed');
  if (mh.returnedToOrigin) lines.push('Returned to origin');

  el.innerHTML = ansiToHtml(lines.join('\n'));
}

/** Render site phase debug info panel (step, active company, handled companies, flags). */
export function renderSiteInfo(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyNames: Readonly<Record<string, string>>,
): void {
  const section = $('site-section');
  const el = $('site-info');

  if (view.phaseState.phase !== Phase.Site) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const site = view.phaseState;
  const lines: string[] = [];

  lines.push(`Step: ${site.step}`);

  // Active company
  const selfIsResource = view.activePlayer === view.self.id;
  const resourceCompanies = selfIsResource ? view.self.companies : view.opponent.companies;
  if (site.step !== 'select-company' && site.activeCompanyIndex < resourceCompanies.length) {
    const activeCompany = resourceCompanies[site.activeCompanyIndex];
    const name = companyNames[activeCompany.id as string] ?? `company #${site.activeCompanyIndex}`;
    lines.push(`Active company: ${name}`);
  }

  // Handled companies
  if (site.handledCompanyIds.length > 0) {
    const names = site.handledCompanyIds.map(id => companyNames[id as string] ?? id).join(', ');
    lines.push(`Handled: ${names}`);
  }

  // Entry and resource flags
  if (site.siteEntered) lines.push('Site entered');
  if (site.resourcePlayed) lines.push('Resource played');
  if (site.minorItemAvailable) lines.push('Minor item available');

  // Declared attacks
  if (site.declaredOnGuardAttacks.length > 0) {
    lines.push(`On-guard attacks: ${site.declaredOnGuardAttacks.length}`);
  }
  if (site.declaredAgentAttack) {
    lines.push(`Agent attack declared`);
  }

  // Auto-attacks
  if (site.automaticAttacksResolved > 0) {
    lines.push(`Auto-attacks resolved: ${site.automaticAttacksResolved}`);
  }

  el.innerHTML = ansiToHtml(lines.join('\n'));
}

/** Render action buttons (viable actions clickable, non-viable shown disabled with reason). */
export function renderActions(
  evaluated: readonly EvaluatedAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onClick: (action: GameAction) => void,
  instanceLookup?: Readonly<Record<string, CardDefinitionId>>,
  companyNames?: Readonly<Record<string, string>>,
): void {
  const el = $('actions');
  el.innerHTML = '';

  /** Create a "+" toggle that reveals the raw JSON of an action. */
  function addJsonToggle(container: HTMLElement, action: GameAction): void {
    const toggle = document.createElement('span');
    toggle.className = 'action-json-toggle';
    toggle.textContent = '+';
    toggle.title = 'Show JSON';
    const pre = document.createElement('pre');
    pre.className = 'action-json hidden';
    pre.textContent = JSON.stringify(action, null, 2);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      pre.classList.toggle('hidden');
      const nowVisible = !pre.classList.contains('hidden');
      toggle.textContent = nowVisible ? '−' : '+';
      toggle.title = nowVisible ? 'Hide JSON' : 'Show JSON';
    });
    container.appendChild(toggle);
    container.appendChild(pre);
  }

  // Viable actions first — clickable (pass first, regressive actions shown lighter)
  const viable = evaluated.filter(e => e.viable);
  viable.sort((a, b) => {
    const aPass = a.action.type === 'pass' || a.action.type === 'draft-stop' ? 0 : 1;
    const bPass = b.action.type === 'pass' || b.action.type === 'draft-stop' ? 0 : 1;
    return aPass - bPass;
  });
  for (const ea of viable) {
    const btn = document.createElement('button');
    const isRegress = 'regress' in ea.action && ea.action.regress;
    if (isRegress) btn.classList.add('action-regress');
    btn.innerHTML = ansiToHtml(describeAction(ea.action, cardPool, instanceLookup, companyNames));
    tagCardImages(btn, cardPool);
    addJsonToggle(btn, ea.action);
    btn.addEventListener('click', () => onClick(ea.action));
    el.appendChild(btn);
  }

  // Non-viable actions — disabled with reason
  const nonViable = evaluated.filter(e => !e.viable);
  if (nonViable.length > 0) {
    for (const ea of nonViable) {
      const btn = document.createElement('button');
      btn.disabled = true;
      btn.title = ea.reason ?? '';
      btn.innerHTML = ansiToHtml(describeAction(ea.action, cardPool, instanceLookup, companyNames))
        + (ea.reason ? ` <span class="action-reason">— ${ea.reason}</span>` : '');
      tagCardImages(btn, cardPool);
      addJsonToggle(btn, ea.action);
      el.appendChild(btn);
    }
  }
}

/** Get the list of card definition IDs to display in the hand arc. */
/** A card in the hand arc with definition and optional instance ID. */
interface HandCard {
  defId: CardDefinitionId;
  instanceId: CardInstanceId | null;
}

function getHandCards(view: PlayerView): HandCard[] {
  // During character draft, show the player's draft pool instead of hand
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    const selfIdx = findSelfIndex(draft.draftState[0].pool, draft.draftState[1].pool);
    return draft.draftState[selfIdx].pool.map(instId => {
      const defId = view.visibleInstances[instId as string];
      return { defId: defId ?? instId as unknown as CardDefinitionId, instanceId: instId };
    });
  }
  // During character deck draft, show remaining pool characters
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-deck-draft') {
    const deckDraft = view.phaseState.setupStep.deckDraftState;
    const selfIdx = findSelfIndex(deckDraft[0].remainingPool, deckDraft[1].remainingPool);
    return deckDraft[selfIdx].remainingPool.map(instId => {
      const defId = view.visibleInstances[instId as string];
      return { defId: defId ?? instId as unknown as CardDefinitionId, instanceId: instId };
    });
  }
  // During item draft, show remaining pool (undrafted characters) + unassigned items
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'item-draft') {
    const cards: HandCard[] = [];

    const step = view.phaseState.setupStep;
    // Remaining pool: undrafted characters (shown dimmed as non-items)
    const selfPoolIdx = findSelfIndex(step.remainingPool[0], step.remainingPool[1]);
    for (const instId of step.remainingPool[selfPoolIdx]) {
      const defId = view.visibleInstances[instId as string];
      if (defId) cards.push({ defId, instanceId: instId });
    }

    // Unassigned items (assigned items are removed from pool)
    const selfItemIdx = step.itemDraftState[0].unassignedItems.length > 0
      && view.visibleInstances[step.itemDraftState[0].unassignedItems[0] as string] ? 0 : 1;
    for (const instId of step.itemDraftState[selfItemIdx].unassignedItems) {
      const defId = view.visibleInstances[instId as string];
      if (defId) cards.push({ defId, instanceId: instId });
    }

    return cards;
  }
  // During site selection, hand arc is empty — sites are shown in the site deck viewer
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'starting-site-selection') {
    return [];
  }
  // During character placement and deck shuffle, no hand cards
  if (view.phaseState.phase === 'setup'
    && (view.phaseState.setupStep.step === 'character-placement'
      || view.phaseState.setupStep.step === 'deck-shuffle')) {
    return [];
  }
  return view.self.hand.map(c => ({ defId: c.definitionId, instanceId: c.instanceId }));
}

/**
 * Build the HTML for the MP breakdown tooltip table.
 * Shows raw and adjusted values per category for both players.
 */
function buildMPTooltip(
  selfName: string,
  selfRaw: MarshallingPointTotals,
  selfAdj: MarshallingPointTotals,
  oppName: string,
  oppRaw: MarshallingPointTotals,
  oppAdj: MarshallingPointTotals,
): string {
  const categories: { key: keyof MarshallingPointTotals; label: string }[] = [
    { key: 'character', label: 'Character' },
    { key: 'item', label: 'Item' },
    { key: 'faction', label: 'Faction' },
    { key: 'ally', label: 'Ally' },
    { key: 'kill', label: 'Kill' },
    { key: 'misc', label: 'Misc' },
  ];

  const selfTotal = selfAdj.character + selfAdj.item + selfAdj.faction + selfAdj.ally + selfAdj.kill + selfAdj.misc;
  const oppTotal = oppAdj.character + oppAdj.item + oppAdj.faction + oppAdj.ally + oppAdj.kill + oppAdj.misc;

  const formatCell = (raw: number, adj: number): string => {
    if (raw === adj) return `${adj}`;
    return `<span class="mp-adjusted">${adj}</span> <span class="mp-raw">(${raw})</span>`;
  };

  let rows = '';
  for (const { key, label } of categories) {
    rows += `<tr>
      <td class="mp-label">${label}</td>
      <td class="mp-value">${formatCell(selfRaw[key], selfAdj[key])}</td>
      <td class="mp-value">${formatCell(oppRaw[key], oppAdj[key])}</td>
    </tr>`;
  }

  return `<table class="mp-tooltip-table">
    <thead><tr>
      <th></th>
      <th class="mp-header">${selfName}</th>
      <th class="mp-header">${oppName}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td class="mp-label">Total</td>
      <td class="mp-value mp-total">${selfTotal}</td>
      <td class="mp-value mp-total">${oppTotal}</td>
    </tr></tfoot>
  </table>`;
}

/**
 * Build a tooltip listing characters under general influence, sorted by mind (descending).
 * Wizards (mind === null) are excluded since they don't cost GI.
 */
function buildGITooltip(
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const entries: { name: string; mind: number }[] = [];
  for (const char of Object.values(characters)) {
    if (char.controlledBy !== 'general') continue;
    const def = cardPool[char.definitionId as string];
    if (!def || !('mind' in def) || def.mind === null) continue;
    entries.push({ name: def.name, mind: def.mind });
  }
  entries.sort((a, b) => b.mind - a.mind);

  if (entries.length === 0) return '<div class="gi-tooltip-empty">No characters under GI</div>';

  let rows = '';
  for (const e of entries) {
    rows += `<tr><td class="mp-label">${e.name}</td><td class="mp-value">${e.mind}</td></tr>`;
  }
  const total = entries.reduce((sum, e) => sum + e.mind, 0);
  return `<table class="mp-tooltip-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${total}</td></tr></tfoot>
  </table>`;
}

/**
 * Build a GI tooltip from drafted character definition IDs (used during character draft).
 * Lists each drafted character with mind cost, sorted by mind descending.
 */
function buildDraftGITooltip(
  drafted: readonly CardDefinitionId[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const entries: { name: string; mind: number }[] = [];
  for (const defId of drafted) {
    const def = cardPool[defId as string];
    if (!def || !isCharacterCard(def) || def.mind === null) continue;
    entries.push({ name: def.name, mind: def.mind });
  }
  entries.sort((a, b) => b.mind - a.mind);

  if (entries.length === 0) return '<div class="gi-tooltip-empty">No characters drafted</div>';

  let rows = '';
  for (const e of entries) {
    rows += `<tr><td class="mp-label">${e.name}</td><td class="mp-value">${e.mind}</td></tr>`;
  }
  const total = entries.reduce((sum, e) => sum + e.mind, 0);
  return `<table class="mp-tooltip-table">
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="mp-label">Total</td><td class="mp-value mp-total">${total}</td></tr></tfoot>
  </table>`;
}

/** Render player names and scores in the visual view. */
export function renderPlayerNames(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  document.getElementById('self-deck-box')?.classList.remove('hidden');
  document.getElementById('opponent-deck-box')?.classList.remove('hidden');
  const selfEl = document.getElementById('self-name');
  const oppEl = document.getElementById('opponent-name');
  const selfRaw = view.self.marshallingPoints;
  const oppRaw = view.opponent.marshallingPoints;
  const selfAdj = computeTournamentBreakdown(selfRaw, oppRaw);
  const oppAdj = computeTournamentBreakdown(oppRaw, selfRaw);
  const selfScore = computeTournamentScore(selfRaw, oppRaw);
  const oppScore = computeTournamentScore(oppRaw, selfRaw);
  const tooltip = buildMPTooltip(view.self.name, selfRaw, selfAdj, view.opponent.name, oppRaw, oppAdj);
  if (selfEl) { selfEl.textContent = view.self.name; selfEl.title = view.self.name; }
  if (oppEl) { oppEl.textContent = view.opponent.name; oppEl.title = view.opponent.name; }

  // During character draft, compute GI from drafted characters instead of in-play characters
  let selfGI: number;
  let oppGI: number;
  let selfGITooltip: string;
  let oppGITooltip: string;
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    const selfIdx = draft.draftState[0].pool.length > 0
      && (draft.draftState[0].pool[0] as string) !== 'unknown-instance' ? 0 : 1;
    const oppIdx = 1 - selfIdx;
    const resolveDraft = (ids: readonly CardInstanceId[]): CardDefinitionId[] =>
      ids.map(id => view.visibleInstances[id as string]).filter((d): d is CardDefinitionId => d !== undefined);
    const selfDrafted = resolveDraft(draft.draftState[selfIdx].drafted);
    const oppDrafted = resolveDraft(draft.draftState[oppIdx].drafted);
    const selfMind = sumDraftedMind(selfDrafted, cardPool);
    const oppMind = sumDraftedMind(oppDrafted, cardPool);
    selfGI = GENERAL_INFLUENCE - selfMind;
    oppGI = GENERAL_INFLUENCE - oppMind;
    selfGITooltip = buildDraftGITooltip(selfDrafted, cardPool);
    oppGITooltip = buildDraftGITooltip(oppDrafted, cardPool);
  } else {
    selfGI = GENERAL_INFLUENCE - view.self.generalInfluenceUsed;
    oppGI = GENERAL_INFLUENCE - view.opponent.generalInfluenceUsed;
    selfGITooltip = buildGITooltip(view.self.characters, cardPool);
    oppGITooltip = buildGITooltip(view.opponent.characters, cardPool);
  }

  const selfScoreEl = document.getElementById('self-score');
  if (selfScoreEl) {
    selfScoreEl.innerHTML = `<span class="score">${selfScore}<span class="mp-tooltip mp-tooltip--above">${tooltip}</span></span>`
      + `<span class="score">${selfGI}<span class="mp-tooltip mp-tooltip--above">${selfGITooltip}</span></span>`;
  }
  const oppScoreEl = document.getElementById('opponent-score');
  if (oppScoreEl) {
    oppScoreEl.innerHTML = `<span class="score">${oppScore}<span class="mp-tooltip mp-tooltip--below">${tooltip}</span></span>`
      + `<span class="score">${oppGI}<span class="mp-tooltip mp-tooltip--below">${oppGITooltip}</span></span>`;
  }

  // Seed the dice animation system from game state and restore floating dice
  // if the visual view is active (e.g. after page refresh or load).
  seedDiceFromState(view);
  const visualView = document.getElementById('visual-view');
  if (visualView && !visualView.classList.contains('hidden')) {
    restoreDice();
  }
}

/**
 * Render a draw deck as a single card-back image with a count badge.
 */
function fillDeckPile(el: HTMLElement, deckSize: number, backImage = '/images/card-back.jpg', title?: string): void {
  el.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'deck-pile-wrapper';

  const img = document.createElement('img');
  img.src = backImage;
  img.alt = `Deck (${deckSize})`;
  img.className = deckSize === 0 ? 'deck-pile-card deck-pile-card--empty' : 'deck-pile-card';
  img.style.position = 'relative';
  if (title) wrapper.title = title;
  wrapper.appendChild(img);

  const label = document.createElement('div');
  label.className = 'deck-pile-label';
  label.textContent = String(deckSize);
  wrapper.appendChild(label);

  el.appendChild(wrapper);
}


/** Reset all deck piles to empty (dimmed placeholder with 0). */
export function resetDeckPiles(): void {
  const deckIds = ['self-deck-pile', 'opponent-deck-pile'];
  const siteIds = ['self-site-pile', 'opponent-site-pile'];
  const sideboardIds = ['self-sideboard-pile', 'opponent-sideboard-pile'];
  const discardIds = ['self-discard-pile', 'opponent-discard-pile'];
  for (const id of deckIds) {
    const el = document.getElementById(id);
    if (el) fillDeckPile(el, 0, '/images/card-back.jpg', 'Play Deck');
  }
  for (const id of siteIds) {
    const el = document.getElementById(id);
    if (el) fillDeckPile(el, 0, '/images/site-back.jpg', 'Site Deck');
  }
  for (const id of sideboardIds) {
    const el = document.getElementById(id);
    if (el) fillDeckPile(el, 0, '/images/card-back.jpg', 'Sideboard');
  }
  for (const id of discardIds) {
    const el = document.getElementById(id);
    if (el) fillDeckPile(el, 0, '/images/card-back.jpg', 'Discard Pile');
  }
}

/** Render both players' draw deck, site deck, sideboard, and discard piles. */
export function renderDeckPiles(view: PlayerView, cardPool?: Readonly<Record<string, CardDefinition>>): void {
  const selfEl = document.getElementById('self-deck-pile');
  if (selfEl) fillDeckPile(selfEl, view.self.playDeckSize, '/images/card-back.jpg', 'Play Deck');

  const oppEl = document.getElementById('opponent-deck-pile');
  if (oppEl) fillDeckPile(oppEl, view.opponent.playDeckSize, '/images/card-back.jpg', 'Play Deck');

  const selfSiteEl = document.getElementById('self-site-pile');
  if (selfSiteEl) fillDeckPile(selfSiteEl, view.self.siteDeck.length, '/images/site-back.jpg', 'Site Deck');

  const oppSiteEl = document.getElementById('opponent-site-pile');
  if (oppSiteEl) fillDeckPile(oppSiteEl, view.opponent.siteDeckSize, '/images/site-back.jpg', 'Site Deck');

  const selfSideboardEl = document.getElementById('self-sideboard-pile');
  if (selfSideboardEl) fillDeckPile(selfSideboardEl, view.self.sideboard.length, '/images/card-back.jpg', 'Sideboard');

  const oppSideboardEl = document.getElementById('opponent-sideboard-pile');
  if (oppSideboardEl) fillDeckPile(oppSideboardEl, 0, '/images/card-back.jpg', 'Sideboard');

  const selfDiscardEl = document.getElementById('self-discard-pile');
  if (selfDiscardEl) fillDeckPile(selfDiscardEl, view.self.discardPile.length, '/images/card-back.jpg', 'Discard Pile');

  const oppDiscardEl = document.getElementById('opponent-discard-pile');
  if (oppDiscardEl) fillDeckPile(oppDiscardEl, view.opponent.discardPile.length, '/images/card-back.jpg', 'Discard Pile');

  // Cache site deck for the modal viewer
  cachedSiteDeck = view.self.siteDeck;
  if (cardPool) cachedCardPool = cardPool;
  installSiteDeckViewer();
}

// ---- Site deck viewer modal ----

/** Cached site deck for the modal viewer. */
let cachedSiteDeck: PlayerView['self']['siteDeck'] = [];
let cachedCardPool: Readonly<Record<string, CardDefinition>> | null = null;
let siteDeckListenerInstalled = false;

/** Cached site selection state for interactive site selection in the viewer. */
let siteSelectionActions: EvaluatedAction[] = [];
let siteSelectionCallback: ((action: GameAction) => void) | null = null;
/** Matches a site deck entry to its evaluated action for the current selection mode. */
let siteSelectionMatcher: ((card: { instanceId: CardInstanceId }) => EvaluatedAction | undefined) | null = null;

/** Populate the site deck grid, optionally with interactive site selection. */
function populateSiteDeckGrid(): void {
  const grid = document.getElementById('site-deck-grid');
  const modal = document.getElementById('site-deck-modal');
  if (!grid || !modal || !cachedCardPool || cachedSiteDeck.length === 0) return;

  grid.innerHTML = '';
  const isSelecting = siteSelectionActions.length > 0;

  for (const card of cachedSiteDeck) {
    const def = cachedCardPool[card.definitionId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.dataset.cardId = card.definitionId as string;

    if (isSelecting) {
      const ea = siteSelectionMatcher?.(card);
      if (ea && ea.viable) {
        img.classList.add('site-selectable');
        if (siteSelectionCallback) {
          const action = ea.action;
          img.addEventListener('click', () => {
            siteSelectionCallback!(action);
            closeSelectionViewer();
          });
        }
      } else if (ea && !ea.viable) {
        img.classList.add('site-dimmed');
        if (ea.reason) img.title = ea.reason;
      } else {
        // Site not in legal actions at all — dim it
        img.classList.add('site-dimmed');
      }
    }

    grid.appendChild(img);
  }
  modal.classList.remove('hidden');
}

/** Install click handler on the self site pile to open the site deck modal. */
function installSiteDeckViewer(): void {
  if (siteDeckListenerInstalled) return;
  siteDeckListenerInstalled = true;

  const pile = document.getElementById('self-site-pile');
  const modal = document.getElementById('site-deck-modal');
  const backdrop = document.getElementById('site-deck-backdrop');
  if (!pile || !modal || !backdrop) return;

  pile.addEventListener('click', () => {
    populateSiteDeckGrid();
  });

  backdrop.addEventListener('click', () => {
    closeSelectionViewer();
  });
}

/**
 * Prepare site selection state and highlight the site deck pile.
 * Called during the starting-site-selection setup step. Does not auto-open
 * the modal — the player clicks the highlighted pile to open it.
 */
export function prepareSiteSelection(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  cachedSiteDeck = view.self.siteDeck;
  cachedCardPool = cardPool;
  siteSelectionActions = view.legalActions.filter(
    ea => ea.action.type === 'select-starting-site',
  );
  siteSelectionMatcher = (card) => siteSelectionActions.find(
    a => a.action.type === 'select-starting-site'
      && a.action.siteInstanceId === card.instanceId,
  );
  siteSelectionCallback = onAction;
  installSiteDeckViewer();

  // Highlight the site deck pile when there are viable selections
  const pile = document.getElementById('self-site-pile');
  if (pile && siteSelectionActions.some(ea => ea.viable)) {
    pile.classList.add('site-pile--active');
  }
}

/**
 * Open the site deck viewer highlighting valid movement destinations for a company.
 * Called when the player clicks a highlighted (movable) site in the company view.
 */
export function openMovementViewer(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  companyId: string,
  onAction: (action: GameAction) => void,
): void {
  cachedSiteDeck = view.self.siteDeck;
  cachedCardPool = cardPool;
  siteSelectionActions = view.legalActions.filter(
    ea => ea.action.type === 'plan-movement' && (ea.action.companyId as string) === companyId,
  );
  // Multiple plan-movement actions may target the same site (different paths).
  // Pick the first viable one per destination site.
  siteSelectionMatcher = (card) => siteSelectionActions.find(
    a => a.action.type === 'plan-movement'
      && a.action.destinationSite === card.instanceId,
  );
  siteSelectionCallback = onAction;
  installSiteDeckViewer();
  populateSiteDeckGrid();
}

/** Close the site selection / movement viewer and clear selection state. */
export function closeSelectionViewer(): void {
  siteSelectionActions = [];
  siteSelectionCallback = null;
  siteSelectionMatcher = null;
  const modal = document.getElementById('site-deck-modal');
  if (modal) modal.classList.add('hidden');
  const pile = document.getElementById('self-site-pile');
  if (pile) pile.classList.remove('site-pile--active');
}

/** @deprecated Use closeSelectionViewer instead. */
export function clearSiteSelection(): void {
  closeSelectionViewer();
}

/** Check whether a card list contains real card IDs (not 'unknown-card' placeholders). */
function hasRealCards(cards: readonly { toString(): string }[]): boolean {
  return cards.length > 0
    && (cards[0] as string) !== 'unknown-card'
    && (cards[0] as string) !== 'unknown-instance';
}

/**
 * Given two card lists (one per player), return the index whose cards are real
 * (not redacted to placeholders). Defaults to 0 when both are empty.
 */
function findSelfIndex(a: readonly { toString(): string }[], b: readonly { toString(): string }[]): number {
  return hasRealCards(a) ? 0 : hasRealCards(b) ? 1 : 0;
}

/**
 * Find the legal action associated with a card in the hand arc, if any.
 *
 * Actions that need no extra parameters beyond identifying the card are
 * returned directly — clicking the card sends them immediately.
 */
function findCardAction(
  defId: CardDefinitionId,
  legalActions: readonly GameAction[],
  visibleInstances?: Readonly<Record<string, CardDefinitionId>>,
): GameAction | null {
  for (const action of legalActions) {
    if (action.type === 'draft-pick' && visibleInstances
      && visibleInstances[action.characterInstanceId as string] === defId) return action;
    if (action.type === 'add-character-to-deck' && visibleInstances
      && visibleInstances[action.characterInstanceId as string] === defId) return action;
    if (action.type === 'select-starting-site' && visibleInstances
      && visibleInstances[action.siteInstanceId as string] === defId) return action;
    if (action.type === 'play-permanent-event' && visibleInstances
      && visibleInstances[action.cardInstanceId as string] === defId) return action;
    if (action.type === 'play-long-event' && visibleInstances
      && visibleInstances[action.cardInstanceId as string] === defId) return action;
  }
  return null;
}

/**
 * Find all play-short-event actions for a given card instance.
 * Returns the list of matching actions (may have multiple targets).
 */
function findShortEventActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'play-short-event' && a.cardInstanceId === instanceId,
  );
}

/**
 * Find all play-hero-resource or play-minor-item actions for a given card instance.
 * Items have one action per eligible character target.
 */
function findResourcePlayActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => (a.type === 'play-hero-resource' || a.type === 'play-minor-item')
      && a.cardInstanceId === instanceId,
  );
}

/**
 * Find all play-hazard actions for a given card instance.
 * Creatures may have multiple entries with different keying methods.
 */
function findHazardActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'play-hazard' && a.cardInstanceId === instanceId,
  );
}


/**
 * Check whether a card in the hand arc has assign-starting-item actions
 * (needs the two-step target selection flow).
 */
function isItemDraftCard(defId: CardDefinitionId, legalActions: readonly GameAction[]): boolean {
  return legalActions.some(a => a.type === 'assign-starting-item' && a.itemDefId === defId);
}

/**
 * Show a disambiguation tooltip near the clicked short-event card
 * when there are multiple valid targets. Each button names a target
 * environment; clicking it sends the corresponding action.
 */
function showShortEventTargetMenu(
  event: MouseEvent,
  actions: readonly GameAction[],
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  // Remove any existing tooltip
  document.querySelector('.chain-target-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'chain-target-backdrop';
  backdrop.addEventListener('click', () => backdrop.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'chain-target-tooltip';
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;

  for (const action of actions) {
    if (action.type !== 'play-short-event') continue;
    const targetDefId = view.visibleInstances[action.targetInstanceId as string];
    const targetDef = targetDefId ? cardPool[targetDefId as string] : undefined;
    const targetName = targetDef ? targetDef.name : '?';

    // Find the chain entry owner for this target
    const chainEntry = view.chain?.entries.find(e => e.cardInstanceId === action.targetInstanceId);
    const ownerName = chainEntry
      ? (chainEntry.declaredBy === view.self.id ? 'You' : view.opponent.name)
      : null;
    const label = ownerName ? `Cancel ${targetName} (${ownerName})` : `Cancel ${targetName}`;

    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      backdrop.remove();
      onAction(action);
    });
    tooltip.appendChild(btn);
  }

  backdrop.appendChild(tooltip);
  document.body.appendChild(backdrop);
}

/**
 * Show a disambiguation tooltip for creature hazards with multiple keying
 * methods. Each button describes a keying match; clicking it sends the action.
 */
function showHazardKeyingMenu(
  event: MouseEvent,
  actions: readonly GameAction[],
  onAction: (action: GameAction) => void,
): void {
  document.querySelector('.chain-target-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'chain-target-backdrop';
  backdrop.addEventListener('click', () => backdrop.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'chain-target-tooltip';
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;

  for (const action of actions) {
    if (action.type !== 'play-hazard' || !action.keyedBy) continue;
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = `Keyed by ${action.keyedBy.method}: ${action.keyedBy.value}`;
    btn.addEventListener('click', () => {
      backdrop.remove();
      onAction(action);
    });
    tooltip.appendChild(btn);
  }

  backdrop.appendChild(tooltip);
  document.body.appendChild(backdrop);
}

/**
 * Show a disambiguation tooltip for resource plays with multiple character targets.
 * Each button names the target character; clicking sends the action.
 */
function showResourceTargetMenu(
  event: MouseEvent,
  actions: readonly GameAction[],
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  document.querySelector('.chain-target-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'chain-target-backdrop';
  backdrop.addEventListener('click', () => backdrop.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'chain-target-tooltip';
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;

  for (const action of actions) {
    const charId = action.type === 'play-hero-resource' ? action.attachToCharacterId
      : action.type === 'play-minor-item' ? action.attachToCharacterId
        : undefined;
    if (!charId) continue;
    const charDefId = view.visibleInstances[charId as string];
    const charDef = charDefId ? cardPool[charDefId as string] : undefined;
    const charName = charDef ? charDef.name : (charId as string);

    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = `Play on ${charName}`;
    btn.addEventListener('click', () => {
      backdrop.remove();
      onAction(action);
    });
    tooltip.appendChild(btn);
  }

  backdrop.appendChild(tooltip);
  document.body.appendChild(backdrop);
}

/**
 * Check whether a card in the hand arc has viable play-character actions
 * (needs the two-step company target selection flow).
 */
function isPlayCharacterCard(
  defId: CardDefinitionId,
  legalActions: readonly GameAction[],
  visibleInstances?: Readonly<Record<string, CardDefinitionId>>,
): boolean {
  return visibleInstances !== undefined && legalActions.some(
    a => a.type === 'play-character' && visibleInstances[a.characterInstanceId as string] === defId,
  );
}

/** Map region type codes to icon file names for inline path display. */
const REGION_ICON_CODES: Record<string, string> = {
  wilderness: 'w', shadow: 's', dark: 'd', coastal: 'c', free: 'f', border: 'b',
};

/**
 * Build an HTML snippet describing the movement path for the active company.
 * Returns something like "Starter: Arthedain [W] Rhudaur [S]" or null if not moving.
 */
function buildMovementPathHtml(
  mh: { movementType?: string | null; resolvedSitePathNames?: readonly string[]; resolvedSitePath?: readonly string[] },
): string | null {
  if (!mh.movementType) return 'Not moving.';
  const names = mh.resolvedSitePathNames ?? [];
  const types = mh.resolvedSitePath ?? [];
  if (names.length === 0) return null;
  const isRegion = mh.movementType !== 'starter';
  const label = isRegion ? 'Region Movement:' : 'Starter:';
  const parts: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const code = REGION_ICON_CODES[types[i] ?? ''];
    const icon = code
      ? `<img src="/images/regions/${code}.png" alt="${types[i]}" width="32" height="32" style="vertical-align:middle;position:relative;top:-5px">`
      : '';
    parts.push(`${names[i]} ${icon}`);
  }
  return `${label} ${parts.join(' ')}`;
}

/**
 * Returns instruction text for the current game phase, or null if none is needed.
 * Displayed in the center of the visual board to guide the player.
 * May contain HTML (e.g. inline region type icons).
 */
function getInstructionText(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string | null {
  if (view.phaseState.phase === 'setup') {
    switch (view.phaseState.setupStep.step) {
      case 'character-draft':
        return 'Character Draft — Pick a character from your pool. Both players reveal simultaneously. Collisions set the character aside.';
      case 'item-draft':
        return 'Starting Items — Assign your minor items to characters in your starting company.';
      case 'character-deck-draft':
        return 'Add remaining pool characters to your play deck, or pass to finish.';
      case 'starting-site-selection': {
        const plural = getAlignmentRules(view.self.alignment).maxStartingSites > 1;
        return `Site Selection — Choose your starting site${plural ? 's' : ''} from your site deck.`;
      }
      case 'character-placement':
        return 'Character Placement — Assign characters to your starting companies.';
      case 'deck-shuffle':
        return 'Shuffle — Shuffling play decks.';
      case 'initial-draw':
        return 'Draw — Drawing initial hand.';
      case 'initiative-roll':
        return 'Initiative — Roll dice to determine who goes first.';
    }
  }

  // Combat sub-state instructions
  if (view.combat) {
    const iAmDefender = view.self.id === view.combat.defendingPlayerId;
    if (view.combat.phase === 'assign-strikes') {
      const isMyTurn = (view.combat.assignmentPhase === 'defender' && iAmDefender)
        || (view.combat.assignmentPhase === 'attacker' && !iAmDefender);
      return isMyTurn
        ? 'Combat — Click a character to assign a strike, or pass.'
        : 'Combat — Opponent is assigning strikes.';
    }
    if (view.combat.phase === 'resolve-strike') {
      return iAmDefender
        ? 'Combat — Choose Tapped (fight normally) or Untapped (-3 prowess to stay untapped).'
        : 'Combat — Opponent is resolving a strike.';
    }
    if (view.combat.phase === 'body-check') {
      return !iAmDefender
        ? 'Combat — Roll the body check.'
        : 'Combat — Opponent rolls the body check.';
    }
  }

  // Chain of effects: show priority/mode context
  if (view.chain) {
    const isSelf = view.chain.priority === view.self.id;
    if (view.chain.mode === 'declaring') {
      return isSelf
        ? 'Chain of Effects — You have priority. Play a response or pass.'
        : 'Chain of Effects — Waiting for opponent to respond or pass.';
    }
    return 'Chain of Effects — Resolving...';
  }

  // M/H phase steps
  if (view.phaseState.phase === Phase.MovementHazard) {
    const isSelf = view.activePlayer === view.self.id;
    switch (view.phaseState.step) {
      case 'select-company':
        return 'Movement/Hazard — Select a company to resolve its movement.';
      case 'reveal-new-site':
        return 'Movement/Hazard — Revealing destination site.';
      case 'set-hazard-limit':
        return 'Movement/Hazard — Computing hazard limit for this company.';
      case 'order-effects':
        return isSelf
          ? 'Movement/Hazard — Order ongoing effects for this company.'
          : 'Movement/Hazard — Opponent is ordering ongoing effects.';
      case 'draw-cards':
        return 'Movement/Hazard — Drawing cards for movement.';
      case 'play-hazards': {
        const mh = view.phaseState;
        const pathDesc = buildMovementPathHtml(mh);
        if (isSelf) {
          return pathDesc
            ? `Movement/Hazard — Play hazards or pass.<br>${pathDesc}`
            : 'Movement/Hazard — Play hazards or pass.';
        }
        return pathDesc
          ? `Movement/Hazard — You may play hazards.<br>${pathDesc}`
          : 'Movement/Hazard — You may play hazards.';
      }
      case 'reset-hand':
        return 'Movement/Hazard — Resetting hand size.';
    }
  }

  // Site phase steps
  if (view.phaseState.phase === Phase.Site) {
    const isSelf = view.activePlayer === view.self.id;
    switch (view.phaseState.step) {
      case 'select-company':
        return 'Site — Select a company to resolve its site phase.';
      case 'enter-or-skip':
        return isSelf
          ? 'Site — Enter the site or skip.'
          : 'Site — Opponent deciding whether to enter site.';
      case 'reveal-on-guard-attacks':
        return isSelf
          ? 'Site — Opponent may reveal on-guard cards.'
          : 'Site — Reveal on-guard cards or pass.';
      case 'automatic-attacks':
        return 'Site — Facing automatic attacks.';
      case 'declare-agent-attack':
        return isSelf
          ? 'Site — Opponent may declare an agent attack.'
          : 'Site — Declare an agent attack or pass.';
      case 'resolve-attacks':
        return 'Site — Resolving attacks.';
      case 'play-resources':
        return isSelf
          ? 'Site — Play a resource or pass.'
          : 'Site — Opponent may play a resource.';
      case 'play-minor-item':
        return isSelf
          ? 'Site — Play an additional minor item or pass.'
          : 'Site — Opponent may play a minor item.';
    }
  }

  // Long-event phase
  if (view.phaseState.phase === Phase.LongEvent) {
    const isSelf = view.activePlayer === view.self.id;
    if (isSelf) {
      return 'Long-event — Play a long-event card or continue to Movement/Hazard phase.';
    }
    return 'Long-event — Waiting for opponent.';
  }

  // End-of-turn phase steps
  if (view.phaseState.phase === Phase.EndOfTurn) {
    switch (view.phaseState.step) {
      case 'discard':
        return 'End of Turn — Discard a card from hand or pass.';
      case 'reset-hand':
        return 'End of Turn — Resetting hand to base size.';
      case 'signal-end':
        return 'End of Turn — Confirm end of turn.';
    }
  }

  // Organization phase
  if (view.phaseState.phase === Phase.Organization && view.phaseState.pendingCorruptionCheck === null) {
    const isSelf = view.activePlayer === view.self.id;
    if (isSelf) {
      return 'Organization — Plan movement, reorganize companies, and play characters.';
    }
    return 'Organization — Waiting for opponent to organize.';
  }

  // Pending corruption check after item transfer
  if (view.phaseState.phase === Phase.Organization && view.phaseState.pendingCorruptionCheck !== null) {
    const checkAction = view.legalActions.find(ea => ea.viable && ea.action.type === 'corruption-check');
    if (checkAction && checkAction.action.type === 'corruption-check') {
      const charId = checkAction.action.characterId as string;
      const defId = view.visibleInstances[charId];
      const def = defId ? cardPool[defId as string] : undefined;
      const charName = def && isCharacterCard(def) ? def.name : '?';
      const cp = checkAction.action.corruptionPoints;
      const mod = checkAction.action.corruptionModifier;
      const modStr = mod !== 0 ? ` (${mod >= 0 ? '+' : ''}${mod} modifier)` : '';
      return `Corruption Check — ${charName} must roll against ${cp} corruption point${cp !== 1 ? 's' : ''}${modStr}.`;
    }
  }

  return null;
}

/** Render instruction text in the visual board. Targeting instructions take priority. */
export function renderInstructions(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const el = document.getElementById('instruction-text');
  if (!el) return;
  const text = targetingInstruction ?? getInstructionText(view, cardPool) ?? '';
  // Use innerHTML to support inline region icons; all content comes from
  // card pool data (no user input), so this is safe.
  el.innerHTML = text;
}

/** Render the pass/stop button in the visual view if a pass-like action is available. */
export function renderPassButton(view: PlayerView, onAction: (action: GameAction) => void): void {
  const btn = document.getElementById('pass-btn') as HTMLButtonElement | null;
  if (!btn) return;

  // Find a viable pass-like or single-step action (including chain priority pass)
  const passEval = view.legalActions.find(ea =>
    ea.viable && (ea.action.type === 'pass' || ea.action.type === 'draft-stop'
    || ea.action.type === 'shuffle-play-deck' || ea.action.type === 'draw-cards'
    || ea.action.type === 'roll-initiative' || ea.action.type === 'corruption-check'
    || ea.action.type === 'pass-chain-priority' || ea.action.type === 'body-check-roll'));
  const passAction = passEval?.action;
  if (!passAction) {
    btn.classList.add('hidden');
    return;
  }

  // Choose label based on action type and phase
  let label = 'Done';
  if (passAction.type === 'pass-chain-priority') {
    label = 'Pass Priority';
  } else if (passAction.type === 'draft-stop') {
    label = 'Done';
  } else if (passAction.type === 'shuffle-play-deck') {
    label = 'Shuffle';
  } else if (passAction.type === 'draw-cards') {
    label = 'Draw';
  } else if (passAction.type === 'roll-initiative') {
    label = 'Roll';
  } else if (passAction.type === 'corruption-check') {
    label = 'Roll';
  } else if (passAction.type === 'body-check-roll') {
    label = 'Body Check';
  } else if (view.phaseState.phase === Phase.Untap) {
    label = 'Organization';
  } else if (view.phaseState.phase === Phase.Organization) {
    label = 'Long-event';
  } else if (view.phaseState.phase === Phase.LongEvent) {
    label = 'Movement/Hazard';
  } else if (view.phaseState.phase === Phase.MovementHazard) {
    switch (view.phaseState.step) {
      case 'set-hazard-limit': label = 'Continue'; break;
      case 'draw-cards': label = 'Continue'; break;
      case 'play-hazards': label = 'Pass'; break;
      case 'reset-hand': label = 'Continue'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.Site) {
    switch (view.phaseState.step) {
      case 'enter-or-skip': label = 'Skip'; break;
      case 'play-resources': label = 'Pass'; break;
      case 'play-minor-item': label = 'Pass'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === Phase.EndOfTurn) {
    switch (view.phaseState.step) {
      case 'discard': label = 'Done'; break;
      case 'signal-end': label = 'Finished'; break;
      default: label = 'Continue';
    }
  } else if (view.phaseState.phase === 'setup') {
    const step = view.phaseState.setupStep.step;
    if (step === 'item-draft') label = 'Continue';
    else if (step === 'character-deck-draft') label = 'Done';
    else if (step === 'starting-site-selection') label = 'Continue';
    else if (step === 'character-placement') label = 'Done';
    else label = 'Pass';
  }

  btn.textContent = label;
  btn.classList.remove('hidden');
  btn.onclick = () => onAction(passAction);

  // When the primary button is a non-pass action (e.g. Draw) and a pass action
  // also exists, show a secondary Pass button so both options are available.
  const existingSecondaryPass = document.getElementById('secondary-pass-btn');
  if (existingSecondaryPass) existingSecondaryPass.remove();
  if (passAction.type !== 'pass' && passAction.type !== 'pass-chain-priority') {
    const secondaryPass = view.legalActions.find(ea => ea.viable && ea.action.type === 'pass');
    if (secondaryPass) {
      const passBtn2 = document.createElement('button');
      passBtn2.id = 'secondary-pass-btn';
      passBtn2.className = 'enter-site-btn'; // reuse same styling
      passBtn2.textContent = 'Pass';
      passBtn2.onclick = () => onAction(secondaryPass.action);
      btn.parentElement?.insertBefore(passBtn2, btn.nextSibling);
    }
  }

  // During enter-or-skip, add an "Enter" button for the enter-site action
  const existingEnterBtn = document.getElementById('enter-site-btn');
  if (existingEnterBtn) existingEnterBtn.remove();
  if (view.phaseState.phase === Phase.Site && view.phaseState.step === 'enter-or-skip') {
    const enterEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'enter-site');
    if (enterEval) {
      const enterBtn = document.createElement('button');
      enterBtn.id = 'enter-site-btn';
      enterBtn.className = 'enter-site-btn';
      enterBtn.textContent = 'Enter';
      enterBtn.onclick = () => onAction(enterEval.action);
      btn.parentElement?.insertBefore(enterBtn, btn);
    }
  }
}

/** Create an img element for a card with standard attributes. */

/** Sum the mind values of drafted characters for GI calculation. */
function sumDraftedMind(drafted: readonly CardDefinitionId[], cardPool: Readonly<Record<string, CardDefinition>>): number {
  return drafted.reduce((sum, defId) => {
    const def = cardPool[defId as string];
    return sum + (isCharacterCard(def) && def.mind !== null ? def.mind : 0);
  }, 0);
}

/** Render a row of card images from definition IDs. */
function renderCardRow(el: HTMLElement, defIds: readonly CardDefinitionId[], cardPool: Readonly<Record<string, CardDefinition>>): void {
  for (const defId of defIds) {
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;
    el.appendChild(createCardImage(defId as string, def, imgPath));
  }
}

/** Render company characters with their items displayed to the right of each character. */
function renderCharactersWithItems(
  el: HTMLElement,
  charInstIds: readonly { toString(): string }[],
  view: PlayerView,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  for (const charInstId of charInstIds) {
    const defId = view.visibleInstances[charInstId as string];
    if (!defId) continue;
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const char = characters[charInstId as string];
    const hasItems = char && char.items.length > 0;

    const img = createCardImage(defId as string, def, imgPath, 'drafted-card', charInstId as string);
    if (!hasItems) {
      el.appendChild(img);
      continue;
    }

    const group = document.createElement('div');
    group.className = 'drafted-card-group';
    group.appendChild(img);
    appendItemCards(group, char, cardPool);
    el.appendChild(group);
  }
}


/** Render companies with their sites, characters, and items on the table. */
function renderCompanies(
  el: HTMLElement,
  companies: readonly { characters: readonly CardInstanceId[]; currentSite: SiteInPlay | null }[],
  view: PlayerView,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const siteIds = company.currentSite ? [company.currentSite.instanceId] : [];
    if (i > 0 && (siteIds.length > 0 || company.characters.length > 0)) {
      const spacer = document.createElement('div');
      spacer.className = 'drafted-spacer';
      el.appendChild(spacer);
    }
    renderSitesAndCharacters(el, siteIds, company.characters, view, characters, cardPool);
  }
}

/**
 * Render self companies during character placement with clickable characters.
 * Each character with a place-character action gets a golden highlight and
 * clicking it directly moves the character to the other company.
 */
function renderPlacementCompanies(
  el: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  for (let i = 0; i < view.self.companies.length; i++) {
    const company = view.self.companies[i];
    if (i > 0) {
      const spacer = document.createElement('div');
      spacer.className = 'drafted-spacer';
      el.appendChild(spacer);
    }

    // Render site card
    if (company.currentSite) {
      const siteDefId = view.visibleInstances[company.currentSite.instanceId as string];
      if (siteDefId) renderCardRow(el, [siteDefId], cardPool);
    }

    // Render characters — clickable to move to the other company
    for (const charInstId of company.characters) {
      const defId = view.visibleInstances[charInstId as string];
      if (!defId) continue;
      const def = cardPool[defId as string];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;

      const placeAction = viableActions(view.legalActions).find(
        a => a.type === 'place-character' && a.characterInstanceId === charInstId,
      ) ?? null;
      const char = view.self.characters[charInstId as string];
      const hasItems = char && char.items.length > 0;

      const group = hasItems ? document.createElement('div') : null;
      if (group) group.className = 'drafted-card-group';

      const img = createCardImage(defId as string, def, imgPath,
        placeAction ? 'drafted-card drafted-card-selectable' : 'drafted-card', charInstId as string);

      if (group && char) {
        group.appendChild(img);
        appendItemCards(group, char, cardPool);
        el.appendChild(group);
      } else {
        el.appendChild(img);
      }

      if (placeAction) {
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => onAction(placeAction));
      }
    }
  }
}

/** Render sites and company characters on the table. Spacer added only when sites are unassigned. */
function renderSitesAndCharacters(
  el: HTMLElement,
  siteInstIds: readonly CardInstanceId[],
  charInstIds: readonly CardInstanceId[],
  view: PlayerView,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
  separateSites = false,
): void {
  for (const instId of siteInstIds) {
    const defId = view.visibleInstances[instId as string];
    if (!defId) continue;
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;
    el.appendChild(createCardImage(defId as string, def, imgPath, 'drafted-card', instId as string));
  }

  if (separateSites && siteInstIds.length > 0 && charInstIds.length > 0) {
    const spacer = document.createElement('div');
    spacer.className = 'drafted-spacer';
    el.appendChild(spacer);
  }
  renderCharactersWithItems(el, charInstIds, view, characters, cardPool);
}

/**
 * Render self characters during item draft with target highlighting.
 * When an item is selected, valid target characters glow and become clickable.
 */
function renderItemDraftTargets(
  el: HTMLElement,
  view: PlayerView,
  charInstanceIds: readonly { toString(): string }[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  for (const charInstId of charInstanceIds) {
    const defId = view.visibleInstances[charInstId as string];
    if (!defId) continue;
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    // Find the matching action for this character + selected item
    const charIdStr = charInstId as string;
    const targetAction = selectedItemDefId
      ? viableActions(view.legalActions).find(
        a => a.type === 'assign-starting-item'
          && a.itemDefId === selectedItemDefId
          && (a.characterInstanceId as string) === charIdStr,
      ) ?? null
      : null;

    const char = view.self.characters[charIdStr];
    const hasItems = char && char.items.length > 0;

    const group = hasItems ? document.createElement('div') : null;
    if (group) group.className = 'drafted-card-group';

    const img = createCardImage(defId as string, def, imgPath,
      targetAction ? 'drafted-card drafted-card-target' : 'drafted-card', charInstId as string);

    if (targetAction && onAction) {
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
        selectedItemDefId = null;
        setTargetingInstruction(null);
        onAction(targetAction);
      });
    }

    if (group && char) {
      group.appendChild(img);
      appendItemCards(group, char, cardPool);
      el.appendChild(group);
    } else {
      el.appendChild(img);
    }
  }
}


/** Render characters on the visual board during setup phases. */
export function renderDrafted(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  const selfEl = document.getElementById('drafted-self');
  const oppEl = document.getElementById('drafted-opponent');
  const setAsideEl = document.getElementById('set-aside');
  if (!selfEl || !oppEl) return;
  selfEl.innerHTML = '';
  oppEl.innerHTML = '';
  if (setAsideEl) setAsideEl.innerHTML = '';

  if (view.phaseState.phase !== 'setup') return;

  const step = view.phaseState.setupStep.step;

  if (step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    if (draft.step !== 'character-draft') return;
    const selfIdx = findSelfIndex(draft.draftState[0].pool, draft.draftState[1].pool);
    const oppIdx = 1 - selfIdx;

    /** Resolve draft instance IDs to definition IDs via visible instances. */
    const resolveDraft = (ids: readonly CardInstanceId[]): CardDefinitionId[] =>
      ids.map(id => view.visibleInstances[id as string]).filter((d): d is CardDefinitionId => d !== undefined);

    renderCardRow(selfEl, resolveDraft(draft.draftState[selfIdx].drafted), cardPool);

    // Show face-down pick if player has picked this round
    if (draft.draftState[selfIdx].currentPick !== null) {
      selfEl.appendChild(createFaceDownCard('Your pick (face down)'));
    }

    renderCardRow(oppEl, resolveDraft(draft.draftState[oppIdx].drafted), cardPool);

    // Show face-down pick if opponent has picked this round
    if (draft.draftState[oppIdx].currentPick !== null) {
      oppEl.appendChild(createFaceDownCard('Opponent pick (face down)'));
    }

    // Show set-aside (collisioned) characters on the left
    if (setAsideEl && draft.setAside.length > 0) {
      const label = document.createElement('div');
      label.className = 'set-aside-label';
      label.textContent = 'Set Aside';
      setAsideEl.appendChild(label);
      const resolvedSetAside = resolveDraft(draft.setAside);
      for (let j = 0; j < resolvedSetAside.length; j++) {
        const defId = resolvedSetAside[j];
        const def = cardPool[defId as string];
        if (!def) continue;
        const imgPath = cardImageProxyPath(def);
        if (!imgPath) continue;
        const img = createCardImage(defId as string, def, imgPath, 'set-aside-card');
        const baseZ = j + 1;
        img.style.zIndex = String(baseZ);
        img.addEventListener('mouseenter', () => { img.style.zIndex = '200'; });
        img.addEventListener('mouseleave', () => { img.style.zIndex = String(baseZ); });
        setAsideEl.appendChild(img);
      }
    }
    return;
  }

  // During item-draft, show company characters as clickable targets
  if (step === 'item-draft') {
    const selfCharIds = view.self.companies.flatMap(c => c.characters);
    renderItemDraftTargets(selfEl, view, selfCharIds, cardPool, onAction);

    const oppCharIds = view.opponent.companies.flatMap(c => c.characters);
    renderCharactersWithItems(oppEl, oppCharIds, view, view.opponent.characters, cardPool);
    return;
  }

  // During character-deck-draft, show company characters on the table
  if (step === 'character-deck-draft') {
    const selfCharIds = view.self.companies.flatMap(c => c.characters);
    renderCharactersWithItems(selfEl, selfCharIds, view, view.self.characters, cardPool);

    const oppCharIds = view.opponent.companies.flatMap(c => c.characters);
    renderCharactersWithItems(oppEl, oppCharIds, view, view.opponent.characters, cardPool);
  }

  // During site selection, show selected sites then a gap then company characters
  if (step === 'starting-site-selection') {
    const siteState = view.phaseState.setupStep.siteSelectionState;
    // Determine self index: self's selected sites resolve in visibleInstances
    const hasSelfSites = (idx: number) => siteState[idx].selectedSites.length > 0
      && view.visibleInstances[siteState[idx].selectedSites[0] as string] !== undefined;
    const selfIdx = hasSelfSites(0) ? 0 : hasSelfSites(1) ? 1 : 0;
    const oppIdx = 1 - selfIdx;

    const selfChars = view.self.companies.flatMap(c => c.characters);
    renderSitesAndCharacters(selfEl, siteState[selfIdx].selectedSites, selfChars, view, view.self.characters, cardPool, true);
    const oppChars = view.opponent.companies.flatMap(c => c.characters);
    renderSitesAndCharacters(oppEl, siteState[oppIdx].selectedSites, oppChars, view, view.opponent.characters, cardPool, true);
  }

  // During character placement, show companies with clickable characters
  if (step === 'character-placement') {
    if (view.self.companies.length > 1 && onAction) {
      renderPlacementCompanies(selfEl, view, cardPool, onAction);
    } else {
      renderCompanies(selfEl, view.self.companies, view, view.self.characters, cardPool);
    }
    renderCompanies(oppEl, view.opponent.companies, view, view.opponent.characters, cardPool);
  }

  // During deck shuffle and initial draw, show companies on the table
  if (step === 'deck-shuffle' || step === 'initial-draw') {
    renderCompanies(selfEl, view.self.companies, view, view.self.characters, cardPool);
    renderCompanies(oppEl, view.opponent.companies, view, view.opponent.characters, cardPool);
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

  // Cache render state for item draft re-rendering
  if (onAction && view.phaseState.phase === 'setup'
    && 'setupStep' in view.phaseState && view.phaseState.setupStep.step === 'item-draft') {
    itemDraftRenderCache = { view, cardPool, onAction };
    // Auto-clear selection if the selected item is no longer in legal actions
    if (selectedItemDefId && !isItemDraftCard(selectedItemDefId, viableActions(view.legalActions))) {
      selectedItemDefId = null;
      setTargetingInstruction(null);
    }
  } else {
    // Not in item draft — clear any stale selection
    if (selectedItemDefId) setTargetingInstruction(null);
    selectedItemDefId = null;
    itemDraftRenderCache = null;
  }

  // Cache render state for play-character re-rendering
  const viable = viableActions(view.legalActions);
  const hasPlayCharacters = viable.some(a => a.type === 'play-character');
  if (onAction && hasPlayCharacters) {
    playCharacterRenderCache = { view, cardPool, onAction };
    // Auto-clear selection if the selected character is no longer viable
    if (selectedCharacterInstanceId) {
      const stillViable = viable.some(
        a => a.type === 'play-character' && a.characterInstanceId === selectedCharacterInstanceId,
      );
      if (!stillViable) {
        selectedCharacterInstanceId = null;
        setTargetingInstruction(null);
      }
    }
  } else if (!hasPlayCharacters) {
    if (selectedCharacterInstanceId) setTargetingInstruction(null);
    selectedCharacterInstanceId = null;
    playCharacterRenderCache = null;
  }

  for (let i = 0; i < total; i++) {
    const { defId: cardDefId, instanceId: cardInstanceId } = cards[i];
    const def = cardPool[cardDefId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const action = findCardAction(cardDefId, viable, view.visibleInstances);
    const isItemDraft = isItemDraftCard(cardDefId, viable);
    const isPlayChar = isPlayCharacterCard(cardDefId, viable, view.visibleInstances);
    const shortEventActions = findShortEventActions(cardInstanceId, viable);
    const isShortEvent = shortEventActions.length > 0;
    const hazardActions = findHazardActions(cardInstanceId, viable);
    const isHazard = hazardActions.length > 0;
    const resourceActions = findResourcePlayActions(cardInstanceId, viable);
    const isResource = resourceActions.length > 0;
    const discardAction = cardInstanceId
      ? viable.find(a => a.type === 'discard-card' && a.cardInstanceId === cardInstanceId)
      : undefined;
    const nonViableReason = !action && !isItemDraft && !isPlayChar && !isShortEvent && !isHazard && !isResource && !discardAction
      ? findNonViableReason(cardDefId, view.legalActions, view.visibleInstances)
      : undefined;
    const isSelected = selectedItemDefId === cardDefId;

    const isCharSelected = selectedCharacterInstanceId !== null
      && cardInstanceId !== null
      && selectedCharacterInstanceId === cardInstanceId;

    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.dataset.cardId = cardDefId as string;
    if (cardInstanceId) img.dataset.instanceId = cardInstanceId as string;
    img.style.setProperty('--i', String(i));

    if (isItemDraft) {
      // Item draft two-step flow: click to select, then click a target character
      img.className = isSelected
        ? 'hand-card hand-card-selected'
        : 'hand-card hand-card-playable';
      img.dataset.defId = cardDefId as string;
      if (onAction) {
        img.addEventListener('click', () => {
          selectedItemDefId = isSelected ? null : cardDefId;
          setTargetingInstruction(
            selectedItemDefId ? `Click a highlighted character to assign ${def.name}` : null,
          );
          reRenderItemDraft();
        });
      }
    } else if (isPlayChar) {
      // Play-character two-step flow: click to select, then click a target company
      img.className = isCharSelected
        ? 'hand-card hand-card-selected'
        : 'hand-card hand-card-playable';
      if (onAction && cardInstanceId) {
        const instId = cardInstanceId;
        img.addEventListener('click', () => {
          selectedCharacterInstanceId = isCharSelected ? null : instId;
          setTargetingInstruction(
            selectedCharacterInstanceId ? `Click a highlighted company to play ${def.name}` : null,
          );
          if (selectedCharacterInstanceId) {
            void import('./company-view.js').then(m => m.switchToAllCompanies());
          }
          reRenderCharacterPlay();
        });
      }
    } else if (isShortEvent) {
      // Short-event: single target plays directly, multiple targets show tooltip
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        if (shortEventActions.length === 1) {
          img.addEventListener('click', () => onAction(shortEventActions[0]));
        } else {
          img.addEventListener('click', (e) => {
            showShortEventTargetMenu(e, shortEventActions, view, cardPool, onAction);
          });
        }
      }
    } else if (isHazard) {
      // Hazard creature/event: single keying plays directly, multiple show menu
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        if (hazardActions.length === 1) {
          img.addEventListener('click', () => onAction(hazardActions[0]));
        } else {
          img.addEventListener('click', (e) => {
            showHazardKeyingMenu(e, hazardActions, onAction);
          });
        }
      }
    } else if (isResource) {
      // Resource play: single target plays directly, multiple targets show menu
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        if (resourceActions.length === 1) {
          img.addEventListener('click', () => onAction(resourceActions[0]));
        } else {
          img.addEventListener('click', (e) => {
            showResourceTargetMenu(e, resourceActions, view, cardPool, onAction);
          });
        }
      }
    } else if (action) {
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        img.addEventListener('click', () => onAction(action));
      }
    } else if (discardAction) {
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        img.addEventListener('click', () => onAction(discardAction));
      }
    } else {
      img.className = 'hand-card hand-card-dimmed';
      if (nonViableReason) {
        img.title = nonViableReason;
      }
    }
    el.appendChild(img);
  }
}

/** Get the opponent's cards to display: draft pool during draft, card backs otherwise. */
function getOpponentCards(view: PlayerView): { cards: CardDefinitionId[]; hidden: boolean } {
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    const oppIdx = 1 - findSelfIndex(draft.draftState[0].pool, draft.draftState[1].pool);
    // Opponent pool is redacted — create placeholder array of the right length for card backs
    return { cards: Array.from({ length: draft.draftState[oppIdx].pool.length }, () => 'unknown-card' as CardDefinitionId), hidden: true };
  }
  // During character deck draft, show opponent's remaining pool as card backs
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-deck-draft') {
    const deckDraft = view.phaseState.setupStep.deckDraftState;
    const oppIdx = 1 - findSelfIndex(deckDraft[0].remainingPool, deckDraft[1].remainingPool);
    return { cards: Array.from({ length: deckDraft[oppIdx].remainingPool.length }, () => 'unknown-card' as CardDefinitionId), hidden: true };
  }
  // During character placement and deck shuffle, no hand cards for either player
  if (view.phaseState.phase === 'setup'
    && (view.phaseState.setupStep.step === 'character-placement'
      || view.phaseState.setupStep.step === 'deck-shuffle')) {
    return { cards: [], hidden: true };
  }
  // Outside draft, show card backs for each card in opponent's hand
  const count = view.opponent.handSize;
  return { cards: new Array<CardDefinitionId>(count).fill('unknown-card' as CardDefinitionId), hidden: true };
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
      img.dataset.cardId = cards[i] as string;
    }
    img.className = 'opponent-card';
    img.style.setProperty('--i', String(i));
    el.appendChild(img);
  }
}

/** Append a message to the log. Auto-scrolls to bottom. */
/**
 * Set up card preview via event delegation on the visual view.
 * Hovering any card image shows a zoomed copy in the fixed preview area.
 */
export function setupCardPreview(cardPool: Readonly<Record<string, CardDefinition>>): void {
  debugCardPool = cardPool;
  const view = document.getElementById('visual-view');
  const preview = document.getElementById('card-preview');
  if (!view || !preview) return;

  view.addEventListener('mouseover', (e) => {
    const img = (e.target as HTMLElement).closest('img');
    if (!img || !img.src) return;
    // Skip deck pile images, region type icons, and unknown card backs
    if (img.closest('.pile-cell, .region-type-icon')) return;
    if (!img.dataset.cardId) return;
    preview.innerHTML = '';
    const cardId = img.dataset.cardId;
    const def = cardId ? cardPool[cardId] : undefined;

    if (def) {
      const info = document.createElement('div');
      info.className = 'card-preview-info';

      // Name header
      const name = document.createElement('div');
      name.className = 'card-preview-name';
      name.textContent = def.name;
      info.appendChild(name);

      // Card image
      const clone = document.createElement('img');
      clone.src = img.src;
      clone.alt = img.alt;
      info.appendChild(clone);

      // Attributes
      buildCardAttributes(info, def);
      preview.appendChild(info);
    } else {
      const clone = document.createElement('img');
      clone.src = img.src;
      clone.alt = img.alt;
      preview.appendChild(clone);
    }
  });

  view.addEventListener('mouseout', (e) => {
    const img = (e.target as HTMLElement).closest('img');
    if (!img) return;
    preview.innerHTML = '';
  });

  view.addEventListener('click', () => {
    preview.innerHTML = '';
  });
}

/** Format a race or skill identifier into its proper display name. */
function formatLabel(value: string): string {
  const special: Record<string, string> = {
    dunadan: 'Dúnadan',
    'awakened-plant': 'Awakened Plant',
    'pukel-creature': 'Pûkel-creature',
  };
  return special[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

/** Format a card type string into a human-readable label. */
function formatCardType(cardType: string): string {
  return cardType
    .replace(/^(hero|minion|fallen-wizard|balrog)-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Add an attribute row to the info panel. */
function addAttr(parent: HTMLElement, label: string, value: string | number): void {
  const row = document.createElement('div');
  row.className = 'card-preview-attr';
  row.innerHTML = `<span class="attr-label">${label}</span><span class="attr-value">${value}</span>`;
  parent.appendChild(row);
}

/** Build attribute rows for a card definition based on its type. */
function buildCardAttributes(el: HTMLElement, def: CardDefinition): void {
  addAttr(el, 'Type', formatCardType(def.cardType));

  // Show keywords if present (environment, weapon, armor, etc.)
  const keywords = (def as { keywords?: readonly string[] }).keywords;
  if (keywords && keywords.length > 0) {
    addAttr(el, 'Keywords', keywords.map(formatLabel).join(', '));
  }

  switch (def.cardType) {
    case 'hero-character':
    case 'minion-character': {
      addAttr(el, 'Race', formatLabel(def.race));
      if (def.skills.length > 0) addAttr(el, 'Skills', def.skills.map(formatLabel).join(', '));
      addAttr(el, 'Prowess / Body', `${def.prowess} / ${def.body}`);
      if (def.mind !== null) addAttr(el, 'Mind', def.mind);
      addAttr(el, 'Direct Influence', def.directInfluence);
      addAttr(el, 'MP', def.marshallingPoints);
      if (def.corruptionModifier !== 0) addAttr(el, 'Corruption Mod', def.corruptionModifier);
      addAttr(el, 'Home Site', def.homesite);
      break;
    }
    case 'hero-resource-item':
    case 'minion-resource-item': {
      addAttr(el, 'Subtype', formatLabel(def.subtype));
      if (def.prowessModifier !== 0) addAttr(el, 'Prowess', formatSignedNumber(def.prowessModifier));
      if (def.bodyModifier !== 0) addAttr(el, 'Body', formatSignedNumber(def.bodyModifier));
      addAttr(el, 'MP', def.marshallingPoints);
      if (def.corruptionPoints !== 0) addAttr(el, 'Corruption', def.corruptionPoints);
      break;
    }
    case 'hero-resource-faction':
    case 'minion-resource-faction': {
      addAttr(el, 'Race', formatLabel(def.race));
      addAttr(el, 'Influence #', def.influenceNumber);
      addAttr(el, 'MP', def.marshallingPoints);
      addAttr(el, 'Playable At', def.playableAt.map(e => 'site' in e ? e.site : formatLabel(e.siteType)).join(', '));
      break;
    }
    case 'hero-resource-ally':
    case 'minion-resource-ally': {
      addAttr(el, 'Prowess / Body', `${def.prowess} / ${def.body}`);
      addAttr(el, 'MP', def.marshallingPoints);
      break;
    }
    case 'hazard-creature': {
      if (def.race) addAttr(el, 'Race', formatLabel(def.race));
      addAttr(el, 'Strikes', def.strikes);
      addAttr(el, 'Prowess', def.prowess);
      if (def.body !== null) addAttr(el, 'Body', def.body);
      if (def.killMarshallingPoints !== 0) addAttr(el, 'Kill MP', def.killMarshallingPoints);
      break;
    }
    case 'hazard-event': {
      addAttr(el, 'Duration', formatLabel(def.eventType));
      break;
    }
    case 'hero-resource-event': {
      addAttr(el, 'Duration', formatLabel(def.eventType));
      if (def.marshallingPoints !== 0) addAttr(el, 'MP', def.marshallingPoints);
      break;
    }
    case 'hazard-corruption': {
      addAttr(el, 'Corruption', def.corruptionPoints);
      break;
    }
    case 'hero-site':
    case 'minion-site':
    case 'fallen-wizard-site':
    case 'balrog-site': {
      addAttr(el, 'Site Type', def.siteType);
      if (def.nearestHaven) addAttr(el, 'Nearest Haven', def.nearestHaven);
      if (def.sitePath.length > 0) addAttr(el, 'Path', def.sitePath.join(' '));
      if (def.playableResources.length > 0) addAttr(el, 'Resources', def.playableResources.join(', '));
      if (def.automaticAttacks.length > 0) {
        for (const aa of def.automaticAttacks) {
          addAttr(el, 'Auto-attack', `${aa.creatureType} (${aa.strikes}/${aa.prowess})`);
        }
      }
      break;
    }
    case 'region': {
      addAttr(el, 'Region Type', def.regionType);
      if (def.adjacentRegions.length > 0) addAttr(el, 'Adjacent', def.adjacentRegions.join(', '));
      break;
    }
  }
}

export function renderLog(message: string, cardPool?: Readonly<Record<string, CardDefinition>>): void {
  const el = $('log');
  const line = document.createElement('div');
  line.innerHTML = ansiToHtml(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (cardPool) tagCardImages(line, cardPool);
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/**
 * Render the chain of effects panel in the visual view.
 *
 * When a chain is active, displays a floating panel on the right side
 * showing all chain entries in LIFO order (top = resolves first),
 * the current mode (declaring/resolving), and who has priority.
 */
export function renderChainPanel(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  _onAction: (action: GameAction) => void,
): void {
  const panel = document.getElementById('chain-panel');
  if (!panel) return;

  const chain = view.chain;
  if (!chain) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  panel.classList.remove('hidden');
  panel.innerHTML = '';

  // Header: mode and priority
  const header = document.createElement('div');
  header.className = 'chain-header';
  const modeLabel = chain.mode === 'declaring' ? 'Declaring' : 'Resolving';
  const isSelfPriority = chain.priority === view.self.id;
  const priorityName = isSelfPriority ? view.self.name : view.opponent.name;
  header.innerHTML = `<span class="chain-title">Chain of Effects</span>`
    + `<span class="chain-mode chain-mode--${chain.mode}">${modeLabel}</span>`;
  panel.appendChild(header);

  if (chain.mode === 'declaring') {
    const priorityEl = document.createElement('div');
    priorityEl.className = 'chain-priority';
    priorityEl.innerHTML = isSelfPriority
      ? '<span class="chain-priority--self">Your priority</span>'
      : `<span class="chain-priority--opp">${priorityName}'s priority</span>`;
    panel.appendChild(priorityEl);
  }

  // Chain entries in LIFO order (last entry = top of stack = resolves first)
  const entries = [...chain.entries].reverse();
  const list = document.createElement('div');
  list.className = 'chain-entries';

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'chain-entry';
    if (entry.resolved) row.classList.add('chain-entry--resolved');
    if (entry.negated) row.classList.add('chain-entry--negated');
    // Instance ID for FLIP animation tracking
    if (entry.cardInstanceId) {
      row.dataset.instanceId = entry.cardInstanceId as string;
    }

    // Card thumbnail
    const thumb = createChainThumb(entry.definitionId, cardPool);
    row.appendChild(thumb);

    // Card name and payload description
    const desc = document.createElement('span');
    desc.className = 'chain-entry__desc';
    desc.innerHTML = formatChainEntry(entry, view, cardPool);
    row.appendChild(desc);

    // Status badge
    if (entry.negated) {
      const status = document.createElement('span');
      status.className = 'chain-entry__status chain-entry__status--negated';
      status.textContent = 'negated';
      row.appendChild(status);
    } else if (entry.resolved) {
      const status = document.createElement('span');
      status.className = 'chain-entry__status chain-entry__status--resolved';
      status.textContent = 'resolved';
      row.appendChild(status);
    }

    list.appendChild(row);
  }
  panel.appendChild(list);

  // Nested chain indicator
  if (chain.parentChain) {
    const nested = document.createElement('div');
    nested.className = 'chain-nested';
    nested.textContent = `Sub-chain (${chain.restriction})`;
    panel.appendChild(nested);
  }
}

/**
 * Format a single chain entry into HTML for the chain panel.
 * Shows the card name (if known) and a description of the payload type,
 * including the target for short-events.
 */
function formatChainEntry(
  entry: ChainEntry,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const cardName = resolveCardName(entry.definitionId, cardPool);
  const declarer = entry.declaredBy === view.self.id ? 'You' : view.opponent.name;

  switch (entry.payload.type) {
    case 'short-event': {
      const targetName = entry.payload.targetInstanceId
        ? resolveInstanceName(entry.payload.targetInstanceId, view.visibleInstances, cardPool)
        : null;
      const arrow = targetName ? ` <span class="chain-arrow">\u2192</span> ${targetName}` : '';
      return `<span class="chain-card-name">${cardName}</span>${arrow}`
        + `<span class="chain-declarer">${declarer}</span>`;
    }
    case 'creature':
      return `<span class="chain-card-name">${cardName}</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'corruption-card':
      return `<span class="chain-card-name">${cardName}</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'passive-condition':
      return `<span class="chain-card-name">${cardName}</span>`
        + ` <span class="chain-trigger">(${entry.payload.trigger})</span>`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'activated-ability':
      return `<span class="chain-card-name">${cardName}</span> ability`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'on-guard-reveal':
      return `<span class="chain-card-name">${cardName}</span> on-guard`
        + `<span class="chain-declarer">${declarer}</span>`;
    case 'body-check':
      return `<span class="chain-card-name">${cardName}</span> body check`
        + `<span class="chain-declarer">${declarer}</span>`;
  }
}

/** Create a small card thumbnail for a chain entry row. */
function createChainThumb(
  defId: CardDefinitionId | null,
  cardPool: Readonly<Record<string, CardDefinition>>,
): HTMLElement {
  const img = document.createElement('img');
  img.className = 'chain-entry__thumb';
  if (defId) {
    const def = cardPool[defId as string];
    if (def) {
      const imgPath = cardImageProxyPath(def);
      if (imgPath) {
        img.src = imgPath;
        img.alt = def.name;
        img.dataset.cardId = defId as string;
        return img;
      }
    }
  }
  img.src = '/images/card-back.jpg';
  img.alt = 'Unknown card';
  return img;
}

/** Resolve a card definition ID to its display name. */
function resolveCardName(
  defId: CardDefinitionId | null,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  if (!defId) return 'Unknown';
  const def = cardPool[defId as string];
  return def ? def.name : (defId as string);
}

/** Resolve a card instance ID to its display name via visibleInstances. */
function resolveInstanceName(
  instanceId: CardInstanceId,
  visibleInstances: Readonly<Record<string, CardDefinitionId>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string {
  const defId = visibleInstances[instanceId as string];
  if (!defId) return '?';
  return resolveCardName(defId, cardPool);
}

/**
 * Show a brief toast notification overlay.
 * The toast auto-dismisses after the CSS animation completes (~3.4s).
 * Visible in both debug and visual view modes.
 */
export function showNotification(message: string, isError = false): void {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = isError ? 'toast toast--error' : 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  toast.addEventListener('animationend', (e) => {
    if (e.animationName === 'toast-out') toast.remove();
  });
}
