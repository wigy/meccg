/**
 * @module render-piles
 *
 * Renders deck piles (play deck, site deck, sideboard, discard, victory display)
 * for both players, and provides the pile browser modal for browsing card lists.
 * Also handles the interactive site selection, fetch-from-pile,
 * reveal-remove-from-discard, and arrange-deck-top sub-flows.
 */

import type { PlayerView, CardDefinition, CardInstanceId, GameAction, EvaluatedAction, ViewCard, PlayHeroResourceAction, ActivateGrantedAction } from '@meccg/shared';
import { cardImageProxyPath, isCardHidden } from '@meccg/shared';
import { buildCardAttributes } from './render-card-preview.js';
import { setSelectedAllyForPlay, setTargetingInstruction } from './render-selection-state.js';
import { reRenderAllyPlaySelection } from './render-hand.js';
import { getGrantedActions } from './company-actions.js';
import { showInPlayGrantedActionMenu } from './company-modals.js';

// ---- Deck pile rendering ----

/**
 * Render a deck pile cell with a card-back image and count label.
 * When `instanceIds` are provided, they are stamped on the image as a
 * space-separated `data-pile-instances` attribute so the FLIP animation
 * system can track cards entering or leaving this pile.
 */
function fillDeckPile(el: HTMLElement, deckSize: number, backImage = '/images/card-back.jpg', title?: string, instanceIds?: readonly CardInstanceId[]): void {
  el.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'deck-pile-wrapper';

  const img = document.createElement('img');
  img.src = backImage;
  img.alt = `Deck (${deckSize})`;
  img.className = deckSize === 0 ? 'deck-pile-card deck-pile-card--empty' : 'deck-pile-card';
  img.style.position = 'relative';
  if (title) wrapper.title = title;
  if (instanceIds && instanceIds.length > 0) {
    img.dataset.pileInstances = instanceIds.join(' ');
  }
  wrapper.appendChild(img);

  const label = document.createElement('div');
  label.className = 'deck-pile-label';
  label.textContent = String(deckSize);
  wrapper.appendChild(label);

  el.appendChild(wrapper);
}

/** Get the face image of the last card in a pile, or a card back fallback. */
function topCardImage(cards: readonly ViewCard[], cardPool: Readonly<Record<string, CardDefinition>> | null): string {
  if (!cardPool || cards.length === 0) return '/images/card-back.jpg';
  const top = cards[cards.length - 1];
  const def = cardPool[top.definitionId as string];
  return (def && cardImageProxyPath(def)) ?? '/images/card-back.jpg';
}

/** Reset all deck piles to empty (dimmed placeholder with 0). */
export function resetDeckPiles(): void {
  const piles: [string, string][] = [
    ['self-deck-pile', 'Play Deck'],
    ['opponent-deck-pile', 'Play Deck'],
    ['self-site-pile', 'Site Deck'],
    ['opponent-site-pile', 'Site Deck'],
    ['self-sideboard-pile', 'Sideboard'],
    ['opponent-sideboard-pile', 'Sideboard'],
    ['self-discard-pile', 'Discard Pile'],
    ['opponent-discard-pile', 'Discard Pile'],
    ['self-mp-pile', 'MP Pile'],
    ['opponent-mp-pile', 'MP Pile'],
    ['self-eliminated-pile', 'Eliminated'],
    ['opponent-eliminated-pile', 'Eliminated'],
  ];
  for (const [id, title] of piles) {
    const el = document.getElementById(id);
    if (!el) continue;
    const backImg = id.includes('site') ? '/images/site-back.jpg' : '/images/card-back.jpg';
    fillDeckPile(el, 0, backImg, title);
  }
}

/** Render both players' draw deck, site deck, sideboard, victory display, and discard piles. */
export function renderDeckPiles(view: PlayerView, cardPool?: Readonly<Record<string, CardDefinition>>, onAction?: (action: GameAction) => void): void {
  const ids = (cards: readonly ViewCard[]) => cards.map(c => c.instanceId);

  const selfEl = document.getElementById('self-deck-pile');
  if (selfEl) fillDeckPile(selfEl, view.self.playDeck.length, '/images/card-back.jpg', 'Play Deck', ids(view.self.playDeck));

  const oppEl = document.getElementById('opponent-deck-pile');
  if (oppEl) fillDeckPile(oppEl, view.opponent.playDeck.length, '/images/card-back.jpg', 'Play Deck', ids(view.opponent.playDeck));

  const selfSiteEl = document.getElementById('self-site-pile');
  if (selfSiteEl) fillDeckPile(selfSiteEl, view.self.siteDeck.length, '/images/site-back.jpg', 'Site Deck', ids(view.self.siteDeck));

  const oppSiteEl = document.getElementById('opponent-site-pile');
  if (oppSiteEl) fillDeckPile(oppSiteEl, view.opponent.siteDeck.length, '/images/site-back.jpg', 'Site Deck', ids(view.opponent.siteDeck));

  const selfSbEl = document.getElementById('self-sideboard-pile');
  if (selfSbEl) fillDeckPile(selfSbEl, view.self.sideboard.length, '/images/card-back.jpg', 'Sideboard', ids(view.self.sideboard));

  const oppSbEl = document.getElementById('opponent-sideboard-pile');
  if (oppSbEl) fillDeckPile(oppSbEl, view.opponent.sideboard.length, '/images/card-back.jpg', 'Sideboard', ids(view.opponent.sideboard));

  const selfMpEl = document.getElementById('self-mp-pile');
  if (selfMpEl) fillDeckPile(selfMpEl, view.self.killPile.length, topCardImage(view.self.killPile, cardPool ?? null), 'MP Pile', ids(view.self.killPile));

  const oppMpEl = document.getElementById('opponent-mp-pile');
  if (oppMpEl) fillDeckPile(oppMpEl, view.opponent.killPile.length, topCardImage(view.opponent.killPile, cardPool ?? null), 'MP Pile', ids(view.opponent.killPile));

  const selfElimEl = document.getElementById('self-eliminated-pile');
  if (selfElimEl) fillDeckPile(selfElimEl, view.self.outOfPlayPile.length, topCardImage(view.self.outOfPlayPile, cardPool ?? null), 'Eliminated', ids(view.self.outOfPlayPile));

  const oppElimEl = document.getElementById('opponent-eliminated-pile');
  if (oppElimEl) fillDeckPile(oppElimEl, view.opponent.outOfPlayPile.length, topCardImage(view.opponent.outOfPlayPile, cardPool ?? null), 'Eliminated', ids(view.opponent.outOfPlayPile));

  const selfDEl = document.getElementById('self-discard-pile');
  if (selfDEl) {
    fillDeckPile(selfDEl, view.self.discardPile.length, topCardImage(view.self.discardPile, cardPool ?? null), 'Discard Pile', ids(view.self.discardPile));
  }

  const oppDEl = document.getElementById('opponent-discard-pile');
  if (oppDEl) {
    fillDeckPile(oppDEl, view.opponent.discardPile.length, topCardImage(view.opponent.discardPile, cardPool ?? null), 'Discard Pile', ids(view.opponent.discardPile));
  }

  // Cache pile data for click handlers
  cachedSiteDeck = view.self.siteDeck;
  cachedSelfSideboard = view.self.sideboard;
  cachedSelfDiscard = view.self.discardPile;
  cachedOppSideboard = view.opponent.sideboard;
  cachedOppDiscard = view.opponent.discardPile;
  cachedSelfPlayDeck = view.self.playDeck;
  cachedOppPlayDeck = view.opponent.playDeck;
  cachedOppSiteDeck = view.opponent.siteDeck;
  cachedSelfKillPile = view.self.killPile;
  cachedSelfOutOfPlay = view.self.outOfPlayPile;
  cachedOppKillPile = view.opponent.killPile;
  cachedOppOutOfPlay = view.opponent.outOfPlayPile;
  if (cardPool) cachedCardPool = cardPool;
  if (onAction) cachedOnAction = onAction;
  cachedKillPileGrantedActions = getGrantedActions(view);
  // Collect actionable instance IDs from viable legal actions
  actionableInstanceIds = collectActionInstanceIds(view.legalActions);
  // Viable `play-hero-resource` actions sourced from the self discard pile
  // (e.g. Glove of Radagast wh-111's `grant-ally-play` `fromDiscard` grant) —
  // makes the corresponding discard-pile browser cards clickable below.
  discardAllyPlayActions = view.legalActions
    .filter((ea): ea is EvaluatedAction & { action: PlayHeroResourceAction } =>
      ea.viable && ea.action.type === 'play-hero-resource' && ea.action.fromDiscard === true)
    .map(ea => ea.action);
  installSiteDeckViewer();
  installPileBrowserClickHandlers();
}

// ---- Pile browser modal ----

/**
 * Set of card instance IDs referenced by viable legal actions.
 * Used to sort actionable cards to the end of pile browser listings.
 */
let actionableInstanceIds: ReadonlySet<string> = new Set();

/**
 * Viable `play-hero-resource` actions with `fromDiscard: true` (e.g. Glove of
 * Radagast wh-111's `grant-ally-play` grant, which lets a granted ally be
 * played from the discard pile). Checked against the currently-browsed pile
 * when it is the self discard pile so those cards become clickable.
 */
let discardAllyPlayActions: readonly PlayHeroResourceAction[] = [];

/** True while the pile browser modal is showing the self discard pile. */
let cachedBrowsingSelfDiscard = false;

/** True while the pile browser modal is showing the self MP (marshalling-point/kill) pile. */
let cachedBrowsingSelfKillPile = false;

/**
 * Viable `activate-granted-action`s keyed by `sourceCardId`, recomputed on every
 * render pass. Checked against the currently-browsed pile when it is the self MP
 * pile, so a `storedAtSite` card sitting there (Reforging tw-314, Andúril tw-192)
 * offers its ability the same way an attached item or bearer-less in-play card
 * does — the MP pile browser is otherwise the only place such a card is ever
 * shown to the player, since it has no bearer to render it on the board.
 */
let cachedKillPileGrantedActions: ReadonlyMap<string, ActivateGrantedAction[]> = new Map();

/** `onAction` callback for the pile browser's granted-action clicks. */
let cachedOnAction: ((action: GameAction) => void) | null = null;

/** Extract all CardInstanceId values from a game action object. */
function collectActionInstanceIds(actions: readonly EvaluatedAction[]): Set<string> {
  const ids = new Set<string>();
  for (const ea of actions) {
    if (!ea.viable) continue;
    const action = ea.action as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(action)) {
      if (key === 'type' || key === 'player') continue;
      if (typeof value === 'string') ids.add(value);
    }
  }
  return ids;
}

/** Cached cards for the current pile browser view. */
let cachedBrowserCards: readonly ViewCard[] = [];
/** Cached title for the current pile browser view. */
let cachedBrowserTitle = '';
/** Cached back image for hidden cards in the pile browser. */
let cachedBrowserBackImage = '/images/card-back.jpg';
let cachedCardPool: Readonly<Record<string, CardDefinition>> | null = null;
let pileBrowserListenerInstalled = false;

/** Cached site selection state for interactive site selection in the viewer. */
let siteSelectionActions: EvaluatedAction[] = [];
let siteSelectionCallback: ((action: GameAction) => void) | null = null;
/** Matches a site deck entry to its evaluated action for the current selection mode. */
let siteSelectionMatcher: ((card: { instanceId: CardInstanceId }) => EvaluatedAction | undefined) | null = null;
/**
 * Instance ids (stringified) for in-play destination candidates in the
 * movement viewer. These are rendered alongside the site deck but marked
 * with a distinct CSS class so the player can tell they are sibling-shared
 * destinations rather than deck cards.
 */
let siteSelectionInPlayInstanceIds: ReadonlySet<string> = new Set();

/**
 * Whether the arrange-deck-top sub-flow's browser modal has been opened by
 * the player at least once. Once set, `prepareArrangeDeckTop` re-populates
 * the grid on every subsequent call (i.e. after every pick, when the next
 * server state arrives) instead of leaving the modal closed -- this is a
 * mandatory, multi-step, no-pass ordering flow, so forcing a fresh pile
 * click to reopen it after every single card would be tedious.
 */
let arrangeDeckTopBrowserOpened = false;

/**
 * Open the pile browser modal showing a list of cards (known or unknown).
 * Used by site deck, sideboard, and victory display piles.
 */
function openPileBrowser(title: string, cards: readonly ViewCard[], cardPool: Readonly<Record<string, CardDefinition>>, backImage = '/images/card-back.jpg', isSelfDiscard = false, isSelfKillPile = false): void {
  cachedBrowserCards = cards;
  cachedBrowserTitle = title;
  cachedBrowserBackImage = backImage;
  cachedCardPool = cardPool;
  cachedBrowsingSelfDiscard = isSelfDiscard;
  cachedBrowsingSelfKillPile = isSelfKillPile;
  populateBrowserGrid();
}

/** Populate the pile browser grid, optionally with interactive site selection. */
function populateBrowserGrid(): void {
  const grid = document.getElementById('pile-browser-grid');
  const modal = document.getElementById('pile-browser-modal');
  const titleEl = document.getElementById('pile-browser-title');
  if (!grid || !modal || !cachedCardPool) return;

  grid.innerHTML = '';
  if (titleEl) titleEl.textContent = cachedBrowserTitle;

  if (cachedBrowserCards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pile-browser-empty';
    empty.textContent = 'Empty';
    grid.appendChild(empty);
    modal.classList.remove('hidden');
    return;
  }

  // If every card is hidden, show a compact overlapping stack instead of a full grid
  const allHidden = cachedBrowserCards.every(c => isCardHidden(c.definitionId));
  if (allHidden) {
    const stack = document.createElement('div');
    stack.className = 'pile-browser-stack';
    const count = cachedBrowserCards.length;
    // Compute card width from the 25vh height and typical card aspect ratio (~0.7)
    const cardWidth = window.innerHeight * 0.25 * 0.7;
    // Available width inside the dialog (80vw minus 3rem padding)
    const availableWidth = window.innerWidth * 0.8 - 48;
    // Compute per-card offset so all cards fit; clamp between 2px and 20px
    const offset = count > 1
      ? Math.max(2, Math.min(20, (availableWidth - cardWidth) / (count - 1)))
      : 0;
    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.src = cachedBrowserBackImage;
      img.alt = 'Unknown card';
      img.style.left = `${Math.round(i * offset)}px`;
      stack.appendChild(img);
    }
    const label = document.createElement('div');
    label.className = 'pile-browser-stack-label';
    label.textContent = `${count} card${count !== 1 ? 's' : ''}`;
    stack.appendChild(label);
    const totalWidth = count > 1 ? Math.round((count - 1) * offset + cardWidth) : cardWidth;
    stack.style.width = `${totalWidth}px`;
    grid.appendChild(stack);
    modal.classList.remove('hidden');
    return;
  }

  const isSelecting = siteSelectionActions.length > 0;

  // Sort highlighted cards to the end (last row, on top when overlapping).
  // During site selection, highlighted = selectable via siteSelectionMatcher;
  // otherwise highlighted = referenced by a viable legal action.
  const sortedCards = [...cachedBrowserCards].sort((a, b) => {
    const aHighlighted = isSelecting
      ? (siteSelectionMatcher?.(a)?.viable ? 1 : 0)
      : (actionableInstanceIds.has(a.instanceId as string) ? 1 : 0);
    const bHighlighted = isSelecting
      ? (siteSelectionMatcher?.(b)?.viable ? 1 : 0)
      : (actionableInstanceIds.has(b.instanceId as string) ? 1 : 0);
    return aHighlighted - bHighlighted;
  });

  for (const [idx, card] of sortedCards.entries()) {
    const defId = !isCardHidden(card.definitionId) ? card.definitionId as string : undefined;
    const def = defId ? cachedCardPool[defId] : undefined;
    const imgPath = def ? cardImageProxyPath(def) : undefined;

    const img = document.createElement('img');
    img.src = !isCardHidden(card.definitionId) ? (imgPath ?? cachedBrowserBackImage) : cachedBrowserBackImage;
    img.alt = def?.name ?? 'Unknown card';
    if (defId) img.dataset.cardId = defId;
    // Cards shown in this modal are *copies* — the same card (e.g. a site already
    // in play at another company) may also be on the board. Give each copy a
    // distinct, modal-scoped instance id so the FLIP animation system treats it
    // as its own element and never slides it in from the original card's previous
    // board position. The id is stable across re-renders (keyed by the real
    // instance id when available) so the copy stays put while the modal is open.
    img.dataset.instanceId = `browser:${(card.instanceId as string) ?? `${defId ?? 'x'}:${idx}`}`;

    if (isSelecting) {
      const ea = siteSelectionMatcher?.(card);
      const isInPlayDest = siteSelectionInPlayInstanceIds.has(card.instanceId as string);
      if (ea && ea.viable) {
        img.classList.add(isInPlayDest ? 'site-in-play-selectable' : 'site-selectable');
        if (isInPlayDest) {
          img.title = 'Already in play at another of your companies';
        }
        if (siteSelectionCallback) {
          const action = ea.action;
          img.addEventListener('click', () => {
            siteSelectionCallback!(action);
            if (action.type === 'arrange-deck-top-card') {
              // Mandatory multi-step ordering, no pass path -- leave the
              // browser open. prepareArrangeDeckTop() re-populates the grid
              // once the next server state (with this pick removed from the
              // legal actions) arrives, instead of forcing the player to
              // re-click the deck pile after every card.
              arrangeDeckTopBrowserOpened = true;
              img.classList.remove('site-selectable');
              img.classList.add('site-dimmed');
            } else {
              closeSelectionViewer();
            }
          });
        }
      } else if (ea && !ea.viable) {
        img.classList.add('site-dimmed');
        if (ea.reason) img.title = ea.reason;
      } else {
        // Site not in legal actions at all — dim it
        img.classList.add('site-dimmed');
      }
    } else if (cachedBrowsingSelfDiscard
      && discardAllyPlayActions.some(a => a.cardInstanceId === card.instanceId)) {
      // A `grant-ally-play` `fromDiscard` grant (Glove of Radagast wh-111) makes
      // this discard-pile card playable — enter the same two-step ally-play
      // targeting flow used for hand-sourced allies (click a company character
      // next), rather than dispatching directly, since the grant can offer
      // more than one valid target character.
      img.classList.add('site-selectable');
      const instanceId = card.instanceId;
      img.addEventListener('click', () => {
        setSelectedAllyForPlay(instanceId);
        setTargetingInstruction(`Click an untapped character to control ${def?.name ?? 'the selected ally'}`);
        reRenderAllyPlaySelection();
        closeSelectionViewer();
      });
    } else if (cachedBrowsingSelfKillPile) {
      // A `storedAtSite` card (Reforging tw-314, Andúril tw-192) offering a
      // `fromStored` grant-action: the MP pile browser is the only place this
      // bearer-less card is ever shown, so its ability menu is wired up here
      // instead of on a company-block card image.
      const grantedActions = cachedKillPileGrantedActions.get(card.instanceId as string) ?? [];
      if (grantedActions.length > 0 && cachedOnAction) {
        const onAction = cachedOnAction;
        img.classList.add('site-selectable');
        img.title = 'Click to activate this card\'s ability';
        img.addEventListener('click', () => {
          showInPlayGrantedActionMenu(img, grantedActions, cachedCardPool!, (action) => {
            onAction(action);
            closeSelectionViewer();
          });
        });
      }
    }

    grid.appendChild(img);
  }
  modal.classList.remove('hidden');

  // Overlap rows when there are more than 3 so everything fits without scrolling.
  // We must wait for images to load so they have intrinsic dimensions and the
  // flex-wrap layout produces correct offsetTop values for row detection.
  const gridImgs = grid.querySelectorAll<HTMLImageElement>('img');
  const imgLoaded = Array.from(gridImgs).map(img =>
    img.complete ? Promise.resolve() : new Promise<void>(r => { img.onload = img.onerror = () => r(); })
  );
  void Promise.all(imgLoaded).then(() => requestAnimationFrame(() => applyRowOverlap(grid)));
}

/**
 * When the pile browser grid has more than 3 rows, apply negative margins
 * so all rows fit on screen without a scrollbar.
 */
function applyRowOverlap(grid: HTMLElement): void {
  const imgs = grid.querySelectorAll<HTMLImageElement>('img');
  if (imgs.length === 0) return;

  // Reset any previous overlap
  for (const img of imgs) {
    img.style.marginTop = '';
    img.style.zIndex = '';
    img.style.position = '';
  }
  grid.closest('#pile-browser-dialog')?.classList.remove('pile-browser--overlapping');

  const cardHeight = window.innerHeight * 0.25; // 25vh
  const gap = parseFloat(getComputedStyle(grid).gap) || 3;

  // Determine rows from actual layout: count how many distinct offsetTop values exist
  const rowTops = new Set<number>();
  for (const img of imgs) rowTops.add(img.offsetTop);
  const numRows = rowTops.size || Math.ceil(imgs.length / Math.max(1, Math.floor(grid.clientWidth / (cardHeight * 0.7))));

  if (numRows <= 3) return;

  // Available height: 85vh dialog minus ~4rem for title and padding
  const availableHeight = window.innerHeight * 0.92 - 80;
  // step = vertical distance between row tops so everything fits
  const step = (availableHeight - cardHeight) / (numRows - 1);
  const overlap = step - cardHeight - gap;

  if (overlap >= 0) return; // no overlap needed

  // Map each distinct offsetTop to a row index — read ALL positions before writing
  // any styles, because writing marginTop triggers reflow and shifts later rows.
  const sortedTops = [...rowTops].sort((a, b) => a - b);
  const topToRow = new Map(sortedTops.map((t, i) => [t, i]));
  const rowAssignments = Array.from(imgs, img => topToRow.get(img.offsetTop) ?? 0);

  for (let i = 0; i < imgs.length; i++) {
    const row = rowAssignments[i];
    imgs[i].style.position = 'relative';
    imgs[i].style.zIndex = String(row);
    if (row > 0) {
      imgs[i].style.marginTop = `${Math.round(overlap)}px`;
    }
  }
  grid.closest('#pile-browser-dialog')?.classList.add('pile-browser--overlapping');
}

/** Install the backdrop click handler for the pile browser modal (once). */
function installPileBrowserBackdrop(): void {
  if (pileBrowserListenerInstalled) return;
  pileBrowserListenerInstalled = true;

  const backdrop = document.getElementById('pile-browser-backdrop');
  if (!backdrop) return;

  backdrop.addEventListener('click', () => {
    closeSelectionViewer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('pile-browser-modal');
    if (modal && !modal.classList.contains('hidden')) {
      closeSelectionViewer();
    }
  });

  // Card preview on hover inside the pile browser grid
  const grid = document.getElementById('pile-browser-grid');
  const preview = document.getElementById('card-preview');
  if (grid && preview) {
    grid.addEventListener('mouseover', (e) => {
      const img = (e.target as HTMLElement).closest('img');
      if (!img?.dataset.cardId || !cachedCardPool) return;
      const def = cachedCardPool[img.dataset.cardId];
      if (!def) return;
      preview.innerHTML = '';
      const info = document.createElement('div');
      info.className = 'card-preview-info';
      const name = document.createElement('div');
      name.className = 'card-preview-name';
      name.textContent = def.name;
      info.appendChild(name);
      const clone = document.createElement('img');
      clone.src = img.src;
      clone.alt = img.alt;
      info.appendChild(clone);
      buildCardAttributes(info, def);
      preview.appendChild(info);
    });
    grid.addEventListener('mouseout', (e) => {
      if ((e.target as HTMLElement).closest('img')) preview.innerHTML = '';
    });
  }
}

// ---- Cached pile data for click handlers ----

/** Cached site deck for the site pile click handler. */
let cachedSiteDeck: PlayerView['self']['siteDeck'] = [];
/** Cached sideboard for the sideboard pile click handler. */
let cachedSelfSideboard: readonly ViewCard[] = [];
/** Cached discard pile for the discard pile click handler. */
let cachedSelfDiscard: readonly ViewCard[] = [];
/** Cached opponent sideboard as hidden cards for browsing. */
let cachedOppSideboard: readonly ViewCard[] = [];
/** Cached opponent discard pile for the discard pile click handler. */
let cachedOppDiscard: readonly ViewCard[] = [];
/** Cached self play deck as hidden cards for browsing. */
let cachedSelfPlayDeck: readonly ViewCard[] = [];
/** Cached opponent play deck as hidden cards for browsing. */
let cachedOppPlayDeck: readonly ViewCard[] = [];
/** Cached opponent site deck as hidden cards for browsing. */
let cachedOppSiteDeck: readonly ViewCard[] = [];
/** Cached kill pile (defeated creatures / MP pile) for click handlers. */
let cachedSelfKillPile: readonly ViewCard[] = [];
let cachedOppKillPile: readonly ViewCard[] = [];
/** Cached out-of-play pile (eliminated characters/allies) for click handlers. */
let cachedSelfOutOfPlay: readonly ViewCard[] = [];
let cachedOppOutOfPlay: readonly ViewCard[] = [];
let siteDeckListenerInstalled = false;
let pileBrowserClickHandlersInstalled = false;

/** Install click handler on the self site pile to open the site deck browser. */
function installSiteDeckViewer(): void {
  installPileBrowserBackdrop();

  if (siteDeckListenerInstalled) return;
  siteDeckListenerInstalled = true;

  const pile = document.getElementById('self-site-pile');
  if (!pile) return;

  pile.addEventListener('click', () => {
    cachedBrowserCards = cachedSiteDeck;
    cachedBrowserTitle = 'Site Deck';
    cachedBrowserBackImage = '/images/site-back.jpg';
    populateBrowserGrid();
  });
}

/** Install click handlers on all piles to open the pile browser. */
function installPileBrowserClickHandlers(): void {
  installPileBrowserBackdrop();

  if (pileBrowserClickHandlersInstalled) return;
  pileBrowserClickHandlersInstalled = true;

  /** Helper to wire a pile element to the browser modal. */
  function wirePile(elementId: string, title: string, getCards: () => readonly ViewCard[], backImage = '/images/card-back.jpg', isSelfDiscard = false, isSelfKillPile = false): void {
    const el = document.getElementById(elementId);
    if (el) {
      el.addEventListener('click', () => {
        if (cachedCardPool) openPileBrowser(title, getCards(), cachedCardPool, backImage, isSelfDiscard, isSelfKillPile);
      });
    }
  }

  // Self piles
  wirePile('self-mp-pile', 'MP Pile', () => cachedSelfKillPile, '/images/card-back.jpg', false, true);
  wirePile('self-eliminated-pile', 'Eliminated', () => cachedSelfOutOfPlay);
  wirePile('self-sideboard-pile', 'Sideboard', () => cachedSelfSideboard);
  wirePile('self-discard-pile', 'Discard Pile', () => cachedSelfDiscard, '/images/card-back.jpg', true);
  wirePile('self-deck-pile', 'Play Deck', () => cachedSelfPlayDeck);

  // Opponent piles
  wirePile('opponent-mp-pile', 'MP Pile', () => cachedOppKillPile);
  wirePile('opponent-eliminated-pile', 'Eliminated', () => cachedOppOutOfPlay);
  wirePile('opponent-sideboard-pile', 'Sideboard', () => cachedOppSideboard);
  wirePile('opponent-discard-pile', 'Discard Pile', () =>
    revealRemoveDiscardFilterActive ? cachedOppDiscard.filter(c => !isCardHidden(c.definitionId)) : cachedOppDiscard);
  wirePile('opponent-deck-pile', 'Play Deck', () => cachedOppPlayDeck);
  wirePile('opponent-site-pile', 'Site Deck', () => cachedOppSiteDeck, '/images/site-back.jpg');
}

// ---- Site selection and fetch-from-pile sub-flows ----

/**
 * Prepare site selection state and highlight the site deck pile.
 *
 * Handles two site-deck picking flows that share identical UI:
 *  - `select-starting-site` during the starting-site-selection step, and
 *  - `select-stage-resource-site` during character-draft when a Fallen-wizard
 *    drafted Hidden Haven (wh-75) and must pair it with a Ruins & Lairs site
 *    from their own site deck.
 *
 * Both actions identify the candidate site by `siteInstanceId`, so the matcher
 * keys on `card.instanceId`. Does not auto-open the modal -- the player clicks
 * the highlighted pile to open it.
 */
export function prepareSiteSelection(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  cachedSiteDeck = view.self.siteDeck;
  cachedCardPool = cardPool;
  siteSelectionActions = view.legalActions.filter(
    ea => ea.action.type === 'select-starting-site'
      || ea.action.type === 'select-stage-resource-site',
  );
  siteSelectionMatcher = (card) => siteSelectionActions.find(
    a => (a.action.type === 'select-starting-site' || a.action.type === 'select-stage-resource-site')
      && a.action.siteInstanceId === card.instanceId,
  );
  siteSelectionCallback = onAction;
  installSiteDeckViewer();

  // Highlight the site deck pile when there are viable selections
  const pile = document.getElementById('self-site-pile');
  if (pile && siteSelectionActions.some(ea => ea.viable)) {
    pile.classList.add('site-pile--active');
    // Expand the deck box so the highlighted pile is visible
    document.getElementById('self-deck-box')?.classList.remove('deck-box--compact');
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

  // Build instance -> definitionId map from the site deck and from any
  // sibling companies' current sites or pending destination sites.
  // Rule 2.II.7.2 allows a company to declare movement to a site another
  // of its companies already occupies; such destinations are not in the
  // site deck but the legal action refers to them by their in-play
  // instance id. A sibling's destinationSite (already drawn from the deck)
  // must also be included so a second company can target the same site.
  const siteInstToDef = new Map<string, string>();
  for (const c of view.self.siteDeck) siteInstToDef.set(c.instanceId as string, c.definitionId as string);
  const inPlayDestInstanceIds = new Set<string>();
  for (const comp of view.self.companies) {
    if (comp.id === companyId) continue;
    const sites = [comp.currentSite, comp.destinationSite];
    for (const site of sites) {
      if (!site) continue;
      const instIdStr = site.instanceId as string;
      if (siteInstToDef.has(instIdStr)) continue;
      siteInstToDef.set(instIdStr, site.definitionId as string);
      inPlayDestInstanceIds.add(instIdStr);
    }
  }

  // Match by definition ID so all copies of the same site are highlighted.
  // Multiple plan-movement actions may target the same site (different paths);
  // pick the first viable one per destination definition.
  const destDefIds = new Map<string, EvaluatedAction>();
  for (const ea of siteSelectionActions) {
    if (ea.action.type !== 'plan-movement') continue;
    const destInstId = (ea.action as { destinationSite: CardInstanceId }).destinationSite;
    const destDefId = siteInstToDef.get(destInstId as string);
    if (destDefId && !destDefIds.has(destDefId)) {
      destDefIds.set(destDefId, ea);
    }
  }
  siteSelectionMatcher = (card) => destDefIds.get(siteInstToDef.get(card.instanceId as string) ?? '');
  siteSelectionInPlayInstanceIds = inPlayDestInstanceIds;
  siteSelectionCallback = onAction;
  installSiteDeckViewer();

  // Append virtual cards for in-play destinations so they render alongside
  // the actual site deck. Each carries the same shape the browser expects.
  const inPlayCards: ViewCard[] = [];
  for (const instIdStr of inPlayDestInstanceIds) {
    const defId = siteInstToDef.get(instIdStr);
    if (!defId) continue;
    inPlayCards.push({
      instanceId: instIdStr as unknown as CardInstanceId,
      definitionId: defId as unknown as ViewCard['definitionId'],
    });
  }
  cachedBrowserCards = [...cachedSiteDeck, ...inPlayCards];
  cachedBrowserTitle = 'Site Deck';
  populateBrowserGrid();
}

/**
 * Prepare the fetch-from-pile sub-flow UI.
 *
 * Opens the deck box, highlights the sideboard, discard, and play deck pile
 * cells (whichever the effect's sources include), and wires up the pile
 * browser so clicking an eligible card sends the corresponding
 * fetch-from-pile action.
 */
export function prepareFetchFromPile(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const fetchActions = view.legalActions.filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
  if (fetchActions.length === 0) return;

  cachedCardPool = cardPool;

  // Open deck box so piles are visible. The all-companies overview hides
  // #self-deck-box entirely (`.all-companies-mode #self-deck-box { display:
  // none }`) — e.g. auto-forced on the opponent's turn, or left on by a
  // manual toggle from before this effect appeared. Without clearing it here,
  // a fetch-to-deck offer landing while that overview is showing leaves the
  // sideboard/discard piles impossible to see or click (reported: Smoke Rings
  // played mid-attack, "the discard/sideboard never lights up for retrieval").
  document.body.classList.remove('all-companies-mode');
  document.getElementById('self-deck-box')?.classList.remove('deck-box--compact');

  // Highlight sideboard, discard, and play deck pile cells
  const hasSideboard = fetchActions.some(ea => (ea.action as { source: string }).source === 'sideboard');
  const hasDiscard = fetchActions.some(ea => (ea.action as { source: string }).source === 'discard-pile');
  const hasDeck = fetchActions.some(ea => (ea.action as { source: string }).source === 'deck');
  if (hasSideboard) {
    document.getElementById('self-sideboard-pile')?.classList.add('pile--fetch-active');
  }
  if (hasDiscard) {
    document.getElementById('self-discard-pile')?.classList.add('pile--fetch-active');
  }
  if (hasDeck) {
    document.getElementById('self-deck-pile')?.classList.add('pile--fetch-active');
  }

  // Set up selection state so pile browser highlights eligible cards
  pileSubFlowActive = true;
  siteSelectionActions = fetchActions;
  siteSelectionMatcher = (card) => fetchActions.find(
    ea => ea.action.type === 'fetch-from-pile'
      && ea.action.cardInstanceId === card.instanceId,
  );
  siteSelectionCallback = onAction;
}

/**
 * Whether the reveal-remove-from-discard sub-flow is active. While true, the
 * `opponent-discard-pile` click handler shows only the currently-revealed
 * (non-hidden) cards instead of the whole pile.
 *
 * Aware of their Ways only reveals a handful of cards at random (four, minus
 * any that were already public), but the opponent's discard pile can hold
 * dozens of still-hidden cards from the rest of the game. Opening the pile
 * browser with the raw, unfiltered pile buried the actual reveal in a wall of
 * face-down placeholders, sorted with the removable candidates pushed to the
 * end — reported as "showed 7 cards ... I assume #4 was unique ... but it
 * still should be visible" (the unique, non-removable card was technically
 * rendered, just lost among unrelated hidden cards).
 */
let revealRemoveDiscardFilterActive = false;

/**
 * Prepare the reveal-remove-from-discard sub-flow UI (Aware of their Ways,
 * dm-46): highlights the opponent's discard pile and wires up the pile
 * browser so clicking one of the revealed cards sends the corresponding
 * `remove-revealed-card` action. Declining is handled by the regular pass
 * button, not this sub-flow.
 */
export function prepareRevealRemoveFromDiscard(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const removeActions = view.legalActions.filter(ea => ea.viable && ea.action.type === 'remove-revealed-card');
  if (removeActions.length === 0) return;

  cachedCardPool = cardPool;

  // Open the opponent's deck box so the discard pile is visible
  document.getElementById('opponent-deck-box')?.classList.remove('deck-box--compact');
  document.getElementById('opponent-discard-pile')?.classList.add('pile--fetch-active');

  pileSubFlowActive = true;
  revealRemoveDiscardFilterActive = true;
  siteSelectionActions = removeActions;
  siteSelectionMatcher = (card) => removeActions.find(
    ea => ea.action.type === 'remove-revealed-card'
      && ea.action.cardInstanceId === card.instanceId,
  );
  siteSelectionCallback = onAction;
}

/**
 * Prepare the arrange-deck-top sub-flow UI (Revealed to all Watchers, dm-85):
 * highlights the player's own play deck pile and wires up the pile browser so
 * clicking one of the top-of-deck cards sends the corresponding
 * `arrange-deck-top-card` action. The player picks the next-highest card one
 * at a time until every set-aside card has been placed; there is no pass path.
 */
export function prepareArrangeDeckTop(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const arrangeActions = view.legalActions.filter(ea => ea.viable && ea.action.type === 'arrange-deck-top-card');
  if (arrangeActions.length === 0) return;

  cachedCardPool = cardPool;

  // Open the self deck box so the play deck is visible
  document.getElementById('self-deck-box')?.classList.remove('deck-box--compact');
  document.getElementById('self-deck-pile')?.classList.add('pile--fetch-active');

  pileSubFlowActive = true;
  siteSelectionActions = arrangeActions;
  siteSelectionMatcher = (card) => arrangeActions.find(
    ea => ea.action.type === 'arrange-deck-top-card'
      && ea.action.cardInstanceId === card.instanceId,
  );
  siteSelectionCallback = onAction;

  // If the browser was already opened for this flow, re-populate it now with
  // the updated legal actions instead of leaving it hidden after the pick
  // that triggered this state update -- see arrangeDeckTopBrowserOpened.
  if (arrangeDeckTopBrowserOpened) {
    cachedBrowserCards = view.self.playDeck;
    cachedBrowserTitle = 'Play Deck';
    cachedBrowserBackImage = '/images/card-back.jpg';
    populateBrowserGrid();
  }
}

/** Whether a pile sub-flow (fetch-from-pile, reveal-remove-from-discard, arrange-deck-top) is active (pile highlights should persist). */
let pileSubFlowActive = false;

/** Close the pile browser and clear selection state. */
export function closeSelectionViewer(): void {
  const modal = document.getElementById('pile-browser-modal');
  if (modal) modal.classList.add('hidden');

  if (pileSubFlowActive) {
    // Keep selection wiring and pile highlights -- only hide the modal.
    // The next state update will re-call the active sub-flow preparer if
    // still active, or clearSelectionState if no longer needed.
    return;
  }

  clearSelectionState();
}

/** Fully clear all selection/highlight state. Called when no sub-flow is active. */
export function clearSelectionState(): void {
  siteSelectionActions = [];
  siteSelectionCallback = null;
  siteSelectionMatcher = null;
  siteSelectionInPlayInstanceIds = new Set();
  pileSubFlowActive = false;
  revealRemoveDiscardFilterActive = false;
  arrangeDeckTopBrowserOpened = false;
  const pile = document.getElementById('self-site-pile');
  if (pile) pile.classList.remove('site-pile--active');
  document.getElementById('self-sideboard-pile')?.classList.remove('pile--fetch-active');
  document.getElementById('self-discard-pile')?.classList.remove('pile--fetch-active');
  document.getElementById('opponent-discard-pile')?.classList.remove('pile--fetch-active');
  document.getElementById('self-deck-pile')?.classList.remove('pile--fetch-active');
}

/** @deprecated Use closeSelectionViewer instead. */
export function clearSiteSelection(): void {
  closeSelectionViewer();
}
