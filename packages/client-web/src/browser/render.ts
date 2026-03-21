/**
 * @module render
 *
 * DOM rendering functions for the web client. Renders game state,
 * action buttons, draft info, and a message log.
 */

import type { PlayerView, GameAction, EvaluatedAction, CardDefinition, CardDefinitionId, CardInstanceId, CharacterInPlay } from '@meccg/shared';
import { describeAction, formatPlayerView, formatCardList, cardImageProxyPath, isCharacterCard, GENERAL_INFLUENCE, getAlignmentRules } from '@meccg/shared';

/** Extract viable GameActions from EvaluatedActions. */
function viableActions(evaluated: readonly EvaluatedAction[]): GameAction[] {
  return evaluated.filter(e => e.viable).map(e => e.action);
}

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
    if (a.type === 'draft-pick' && a.characterDefId === defId) return ea.reason;
    if (a.type === 'add-character-to-deck' && a.characterDefId === defId) return ea.reason;
    if (a.type === 'assign-starting-item' && a.itemDefId === defId) return ea.reason;
    if (a.type === 'select-starting-site' && visibleInstances
      && visibleInstances[a.siteInstanceId as string] === defId) return ea.reason;
  }
  return undefined;
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
 * Create an absolutely-positioned clone of a card and fly it toward a target element.
 * The clone lives outside the hand arc so server state updates can't destroy it mid-flight.
 */
function flyCardTo(source: HTMLElement, target: HTMLElement, onDone: () => void): void {
  const sourceRect = source.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  const clone = source.cloneNode(true) as HTMLImageElement;
  clone.className = 'item-fly-clone';
  clone.style.position = 'fixed';
  clone.style.left = `${sourceRect.left}px`;
  clone.style.top = `${sourceRect.top}px`;
  clone.style.width = `${sourceRect.width}px`;
  clone.style.height = `${sourceRect.height}px`;
  clone.style.zIndex = '1000';
  clone.style.pointerEvents = 'none';

  // Calculate flight vector
  const dx = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
  const dy = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
  clone.style.setProperty('--fly-x', `${dx}px`);
  clone.style.setProperty('--fly-y', `${dy}px`);

  document.body.appendChild(clone);

  clone.addEventListener('animationend', () => {
    clone.remove();
    onDone();
  }, { once: true });
}

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

/** Render action buttons (viable actions clickable, non-viable shown disabled with reason). */
export function renderActions(
  evaluated: readonly EvaluatedAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onClick: (action: GameAction) => void,
  instanceLookup?: Readonly<Record<string, CardDefinitionId>>,
): void {
  const el = $('actions');
  el.innerHTML = '';

  // Viable actions first — clickable
  for (const ea of evaluated.filter(e => e.viable)) {
    const btn = document.createElement('button');
    btn.innerHTML = ansiToHtml(describeAction(ea.action, cardPool, instanceLookup));
    tagCardImages(btn, cardPool);
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
      btn.innerHTML = ansiToHtml(describeAction(ea.action, cardPool, instanceLookup))
        + (ea.reason ? ` <span class="action-reason">— ${ea.reason}</span>` : '');
      tagCardImages(btn, cardPool);
      el.appendChild(btn);
    }
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
  // During item draft, show remaining pool (undrafted characters) + unassigned items
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'item-draft') {
    const step = view.phaseState.setupStep;
    const cards: CardDefinitionId[] = [];

    // Remaining pool: undrafted characters (shown dimmed as non-items)
    const selfPoolIdx = step.remainingPool[0].length > 0
      && (step.remainingPool[0][0] as string) !== 'unknown-card' ? 0 : 1;
    cards.push(...step.remainingPool[selfPoolIdx]);

    // Unassigned items (assigned items are removed from pool)
    const selfItemIdx = step.itemDraftState[0].unassignedItems.length > 0
      && view.visibleInstances[step.itemDraftState[0].unassignedItems[0] as string] ? 0 : 1;
    for (const instId of step.itemDraftState[selfItemIdx].unassignedItems) {
      const defId = view.visibleInstances[instId as string];
      if (defId) cards.push(defId);
    }

    return cards;
  }
  // During site selection, show all candidate sites (both viable and non-viable)
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'starting-site-selection') {
    return view.legalActions
      .filter(ea => ea.action.type === 'select-starting-site')
      .map(ea => ea.action.type === 'select-starting-site'
        ? view.visibleInstances[ea.action.siteInstanceId as string]
        : undefined)
      .filter((id): id is CardDefinitionId => id !== undefined);
  }
  // During character placement and deck shuffle, no hand cards
  if (view.phaseState.phase === 'setup'
    && (view.phaseState.setupStep.step === 'character-placement'
      || view.phaseState.setupStep.step === 'deck-shuffle')) {
    return [];
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

/**
 * Render a draw deck as a small pile of card-back images into a container.
 * The number of visible cards scales proportionally with deck size,
 * capped at a maximum stack height to avoid visual clutter.
 */
function fillDeckPile(el: HTMLElement, deckSize: number, backImage = '/images/card-back.jpg'): void {
  el.innerHTML = '';
  if (deckSize === 0) return;

  // Show 1 card per ~4 in deck, min 1, max 8 visible layers
  const layers = Math.min(8, Math.max(1, Math.ceil(deckSize / 4)));

  const wrapper = document.createElement('div');
  wrapper.className = 'deck-pile-wrapper';

  for (let i = 0; i < layers; i++) {
    const img = document.createElement('img');
    img.src = backImage;
    img.alt = `Deck (${deckSize})`;
    img.className = 'deck-pile-card';
    if (i === 0) {
      img.style.position = 'relative';
    } else {
      img.style.bottom = `${i * 2}px`;
      img.style.left = `${i * 1}px`;
    }
    wrapper.appendChild(img);
  }

  // Position label at the top-right corner of the top card
  const topCard = layers - 1;
  const label = document.createElement('div');
  label.className = 'deck-pile-label';
  label.textContent = String(deckSize);
  label.style.right = `${-topCard * 1}px`;
  label.style.top = `${-topCard * 2}px`;
  wrapper.appendChild(label);
  el.appendChild(wrapper);
}

/**
 * Animate a deck shuffle: count down to 0, then back up, redrawing each step.
 * Returns a promise that resolves when the animation completes.
 */
function animateDeckShuffle(el: HTMLElement, deckSize: number, backImage = '/images/card-back.jpg'): Promise<void> {
  return new Promise((resolve) => {
    const stepDelay = Math.max(20, Math.min(60, 400 / deckSize));
    let current = deckSize;
    let direction: 'down' | 'up' = 'down';

    function step(): void {
      fillDeckPile(el, current, backImage);

      if (direction === 'down') {
        current -= 4;
        if (current <= 0) {
          current = 0;
          fillDeckPile(el, 0, backImage);
          direction = 'up';
        }
      } else {
        current += 4;
        if (current >= deckSize) {
          current = deckSize;
          fillDeckPile(el, deckSize, backImage);
          resolve();
          return;
        }
      }
      setTimeout(step, stepDelay);
    }

    step();
  });
}

/** Run shuffle animation on both players' deck piles, then invoke callback. */
export function animateShuffleThenAct(deckSizes: { self: number; opponent: number }, onDone: () => void): void {
  const selfEl = document.getElementById('self-deck-pile');
  const oppEl = document.getElementById('opponent-deck-pile');
  const promises: Promise<void>[] = [];
  if (selfEl && deckSizes.self > 0) promises.push(animateDeckShuffle(selfEl, deckSizes.self));
  if (oppEl && deckSizes.opponent > 0) promises.push(animateDeckShuffle(oppEl, deckSizes.opponent));
  void Promise.all(promises).then(onDone);
}

/** Render both players' draw deck and site deck piles. */
export function renderDeckPiles(view: PlayerView): void {
  const selfEl = document.getElementById('self-deck-pile');
  if (selfEl) fillDeckPile(selfEl, view.self.playDeckSize);

  const oppEl = document.getElementById('opponent-deck-pile');
  if (oppEl) fillDeckPile(oppEl, view.opponent.playDeckSize);

  const selfSiteEl = document.getElementById('self-site-pile');
  if (selfSiteEl) fillDeckPile(selfSiteEl, view.self.siteDeck.length, '/images/site-back.jpg');

  const oppSiteEl = document.getElementById('opponent-site-pile');
  if (oppSiteEl) fillDeckPile(oppSiteEl, view.opponent.siteDeckSize, '/images/site-back.jpg');

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
 * returned directly — clicking the card sends them immediately.
 */
function findCardAction(
  defId: CardDefinitionId,
  legalActions: readonly GameAction[],
  visibleInstances?: Readonly<Record<string, CardDefinitionId>>,
): GameAction | null {
  for (const action of legalActions) {
    if (action.type === 'draft-pick' && action.characterDefId === defId) return action;
    if (action.type === 'add-character-to-deck' && action.characterDefId === defId) return action;
    if (action.type === 'select-starting-site' && visibleInstances
      && visibleInstances[action.siteInstanceId as string] === defId) return action;
  }
  return null;
}

/**
 * Check whether a card in the hand arc has assign-starting-item actions
 * (needs the two-step target selection flow).
 */
function isItemDraftCard(defId: CardDefinitionId, legalActions: readonly GameAction[]): boolean {
  return legalActions.some(a => a.type === 'assign-starting-item' && a.itemDefId === defId);
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
  return null;
}

/** Render instruction text in the visual board. */
export function renderInstructions(view: PlayerView): void {
  const el = document.getElementById('instruction-text');
  if (!el) return;
  const text = getInstructionText(view);
  el.textContent = text ?? '';
}

/** Render the pass/stop button in the visual view if a pass-like action is available. */
export function renderPassButton(view: PlayerView, onAction: (action: GameAction) => void): void {
  const btn = document.getElementById('pass-btn') as HTMLButtonElement | null;
  if (!btn) return;

  // Find a viable pass-like or single-step action
  const passEval = view.legalActions.find(ea =>
    ea.viable && (ea.action.type === 'pass' || ea.action.type === 'draft-stop'
    || ea.action.type === 'shuffle-play-deck' || ea.action.type === 'draw-cards'
    || ea.action.type === 'roll-initiative'));
  const passAction = passEval?.action;
  if (!passAction) {
    btn.classList.add('hidden');
    return;
  }

  // Choose label based on action type and phase
  let label = 'Done';
  if (passAction.type === 'draft-stop') {
    label = 'Done';
  } else if (passAction.type === 'shuffle-play-deck') {
    label = 'Shuffle';
  } else if (passAction.type === 'draw-cards') {
    label = 'Draw';
  } else if (passAction.type === 'roll-initiative') {
    label = 'Roll';
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
  if (passAction.type === 'shuffle-play-deck') {
    btn.onclick = () => {
      btn.classList.add('hidden');
      animateShuffleThenAct(
        { self: view.self.playDeckSize, opponent: view.opponent.playDeckSize },
        () => onAction(passAction),
      );
    };
  } else {
    btn.onclick = () => onAction(passAction);
  }
}

/** Render a row of card images from definition IDs. */
function renderCardRow(el: HTMLElement, defIds: readonly CardDefinitionId[], cardPool: Readonly<Record<string, CardDefinition>>): void {
  for (const defId of defIds) {
    const def = cardPool[defId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;
    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.dataset.cardId = defId as string;
    img.className = 'drafted-card';
    el.appendChild(img);
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

    if (!hasItems) {
      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      img.dataset.cardId = defId as string;
      img.className = 'drafted-card';
      el.appendChild(img);
      continue;
    }

    const group = document.createElement('div');
    group.className = 'drafted-card-group';
    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.dataset.cardId = defId as string;
    img.className = 'drafted-card';
    group.appendChild(img);
    appendItemCards(group, char, cardPool);
    el.appendChild(group);
  }
}

/** Render item cards to the right of a character card inside a group container. */
function appendItemCards(
  container: HTMLElement,
  char: CharacterInPlay,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  for (const item of char.items) {
    const itemDef = cardPool[item.definitionId as string];
    if (!itemDef) continue;
    const itemImg = cardImageProxyPath(itemDef);
    if (!itemImg) continue;
    const img = document.createElement('img');
    img.src = itemImg;
    img.alt = itemDef.name;
    img.dataset.cardId = item.definitionId as string;
    img.className = 'drafted-card drafted-item';
    container.appendChild(img);
  }
}

/** Render companies with their sites, characters, and items on the table. */
function renderCompanies(
  el: HTMLElement,
  companies: readonly { characters: readonly CardInstanceId[]; currentSite: CardInstanceId | null }[],
  view: PlayerView,
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const siteIds = company.currentSite ? [company.currentSite] : [];
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
      const siteDefId = view.visibleInstances[company.currentSite as string];
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

      const img = document.createElement('img');
      img.src = imgPath;
      img.alt = def.name;
      img.dataset.cardId = defId as string;
      img.className = placeAction
        ? 'drafted-card drafted-card-selectable'
        : 'drafted-card';

      if (group && char) {
        group.appendChild(img);
        appendItemCards(group, char, cardPool);
        el.appendChild(group);
      } else {
        el.appendChild(img);
      }

      if (placeAction) {
        img.style.cursor = 'pointer';
        // Determine slide direction: right if target company is to the right, left otherwise
        const targetIdx = view.self.companies.findIndex(
          c => (c.id as string) === ((placeAction as GameAction & { companyId: unknown }).companyId as string),
        );
        const slideRight = targetIdx > i;
        const animEl = group ?? img;
        img.addEventListener('click', () => {
          animEl.classList.add(slideRight ? 'placement-slide-right' : 'placement-slide-left');
          let sent = false;
          const send = () => { if (!sent) { sent = true; onAction(placeAction); } };
          setTimeout(send, 300);
          animEl.addEventListener('animationend', send, { once: true });
        });
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
  const siteDefIds = siteInstIds
    .map(id => view.visibleInstances[id as string])
    .filter((id): id is CardDefinitionId => id !== undefined);
  renderCardRow(el, siteDefIds, cardPool);

  if (separateSites && siteDefIds.length > 0 && charInstIds.length > 0) {
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

    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.dataset.cardId = defId as string;
    img.className = targetAction
      ? 'drafted-card drafted-card-target'
      : 'drafted-card';

    if (targetAction && onAction) {
      img.style.cursor = 'pointer';
      img.addEventListener('click', () => {
        // Find the selected item card in the hand arc
        const arc = document.getElementById('hand-arc');
        const sourceCard = arc?.querySelector<HTMLElement>(
          `[data-def-id="${selectedItemDefId as string}"]`,
        );
        selectedItemDefId = null;

        if (sourceCard) {
          flyCardTo(sourceCard, img, () => onAction(targetAction));
        } else {
          onAction(targetAction);
        }
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
    const selfIdx = getSelfDraftIndex(draft.draftState);
    const oppIdx = 1 - selfIdx;

    renderCardRow(selfEl, draft.draftState[selfIdx].drafted, cardPool);

    // Show face-down pick if player has picked this round
    if (draft.draftState[selfIdx].currentPick !== null) {
      const faceDown = document.createElement('img');
      faceDown.src = '/images/card-back.jpg';
      faceDown.alt = 'Your pick (face down)';
      faceDown.className = 'drafted-card drafted-card-facedown';
      selfEl.appendChild(faceDown);
    }

    // Show remaining GI for self
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

    renderCardRow(oppEl, draft.draftState[oppIdx].drafted, cardPool);

    // Show face-down pick if opponent has picked this round
    if (draft.draftState[oppIdx].currentPick !== null) {
      const faceDown = document.createElement('img');
      faceDown.src = '/images/card-back.jpg';
      faceDown.alt = 'Opponent pick (face down)';
      faceDown.className = 'drafted-card drafted-card-facedown';
      oppEl.appendChild(faceDown);
    }

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

    // Show set-aside (collisioned) characters on the left
    if (setAsideEl && draft.setAside.length > 0) {
      const label = document.createElement('div');
      label.className = 'set-aside-label';
      label.textContent = 'Set Aside';
      setAsideEl.appendChild(label);
      for (let j = 0; j < draft.setAside.length; j++) {
        const defId = draft.setAside[j];
        const def = cardPool[defId as string];
        if (!def) continue;
        const imgPath = cardImageProxyPath(def);
        if (!imgPath) continue;
        const img = document.createElement('img');
        img.src = imgPath;
        img.alt = def.name;
        img.dataset.cardId = defId as string;
        img.className = 'set-aside-card';
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
    }
  } else {
    // Not in item draft — clear any stale selection
    selectedItemDefId = null;
    itemDraftRenderCache = null;
  }

  for (let i = 0; i < total; i++) {
    const def = cardPool[cards[i] as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const cardDefId = cards[i];
    const viable = viableActions(view.legalActions);
    const action = findCardAction(cardDefId, viable, view.visibleInstances);
    const isItemDraft = isItemDraftCard(cardDefId, viable);
    const nonViableReason = !action && !isItemDraft
      ? findNonViableReason(cardDefId, view.legalActions, view.visibleInstances)
      : undefined;
    const isSelected = selectedItemDefId === cardDefId;

    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.dataset.cardId = cardDefId as string;
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
          reRenderItemDraft();
        });
      }
    } else if (action) {
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        img.addEventListener('click', () => {
          const rect = img.getBoundingClientRect();
          const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
          const dy = window.innerHeight * 0.35 - (rect.top + rect.height / 2);
          img.style.setProperty('--fly-x', `${dx}px`);
          img.style.setProperty('--fly-y', `${dy}px`);
          img.className = 'hand-card hand-card-played';
          img.addEventListener('animationend', () => onAction(action), { once: true });
        });
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
    // Opponent's pool has 'unknown-card' placeholders; self pool has real IDs
    const hasRealCards = (pool: readonly CardDefinitionId[]) =>
      pool.length > 0 && (pool[0] as string) !== 'unknown-card';
    const oppIdx = hasRealCards(draft.draftState[0].pool) ? 1 : 0;
    return { cards: [...draft.draftState[oppIdx].pool], hidden: true };
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
  const view = document.getElementById('visual-view');
  const preview = document.getElementById('card-preview');
  if (!view || !preview) return;

  view.addEventListener('mouseover', (e) => {
    const img = (e.target as HTMLElement).closest('img');
    if (!img || !img.src) return;
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

  switch (def.cardType) {
    case 'hero-character':
    case 'minion-character': {
      addAttr(el, 'Race', def.race);
      if (def.skills.length > 0) addAttr(el, 'Skills', def.skills.join(', '));
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
      addAttr(el, 'Subtype', def.subtype);
      if (def.prowessModifier !== 0) addAttr(el, 'Prowess', `${def.prowessModifier > 0 ? '+' : ''}${def.prowessModifier}`);
      if (def.bodyModifier !== 0) addAttr(el, 'Body', `${def.bodyModifier > 0 ? '+' : ''}${def.bodyModifier}`);
      addAttr(el, 'MP', def.marshallingPoints);
      if (def.corruptionPoints !== 0) addAttr(el, 'Corruption', def.corruptionPoints);
      break;
    }
    case 'hero-resource-faction':
    case 'minion-resource-faction': {
      addAttr(el, 'Race', def.race);
      addAttr(el, 'Influence #', def.influenceNumber);
      addAttr(el, 'MP', def.marshallingPoints);
      addAttr(el, 'Playable At', def.playableAt);
      break;
    }
    case 'hero-resource-ally':
    case 'minion-resource-ally': {
      addAttr(el, 'Prowess / Body', `${def.prowess} / ${def.body}`);
      addAttr(el, 'MP', def.marshallingPoints);
      break;
    }
    case 'hazard-creature': {
      addAttr(el, 'Strikes', def.strikes);
      addAttr(el, 'Prowess', def.prowess);
      if (def.body !== null) addAttr(el, 'Body', def.body);
      if (def.killMarshallingPoints !== 0) addAttr(el, 'Kill MP', def.killMarshallingPoints);
      break;
    }
    case 'hazard-event': {
      addAttr(el, 'Duration', def.eventType);
      break;
    }
    case 'hero-resource-event': {
      addAttr(el, 'Duration', def.eventType);
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
