/**
 * @module company-modals
 *
 * Modal dialogs and tooltip menus for company-view interactions:
 * - Character action tooltip (influence, split, move, merge, sideboard, corruption)
 * - Granted action tooltip (choose between multiple granted actions on one card)
 * - Sideboard fetch modal (browse and pick cards from sideboard)
 * - Exchange modal (deck exhaustion sideboard exchange)
 * - Opponent influence menu (choose reveal variant)
 * - Opponent influence target highlighting on company blocks
 */

import type {
  GameAction,
  CardDefinition,
  CardInstanceId,
  CompanyId,
  MoveToInfluenceAction,
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  StartSideboardToDeckAction,
  StartSideboardToDiscardAction,
  CorruptionCheckAction,
  SupportCorruptionCheckAction,
  RestoreCharacterByEffectAction,
  OpponentInfluenceAttemptAction,
  ActivateGrantedAction,
  DiscardCharacterOrgAction,
  DeclareBurglaryAction,
} from '@meccg/shared';
import { cardImageProxyPath, viableActions, CardStatus } from '@meccg/shared';
import {
  getCachedInstanceLookup,
  getLastView,
  getLastCardPool,
  setCompanyMoveSourceId,
  setCompanyMoveSourceCompanyId,
  setMergeSourceCompanyId,
  setPendingFocusCharacterId,
  rerender,
} from './company-view-state.js';
import { showConfirm } from './dialog.js';
import { setSelectedInfluencerForOpponent, clearOpponentInfluenceSelection, setTargetingInstruction, buildCardPreviewInfo } from './render.js';
import { switchToAllCompanies } from './company-view.js';
import { showTooltipMenu, tooltipButton, type TooltipMenuItem } from './tooltip-menu.js';

/**
 * One entry of a card-grid modal: the action to send and the card instance whose
 * image represents it (the card being fetched, discarded, or otherwise chosen).
 */
interface CardGridChoice {
  readonly action: GameAction;
  readonly instanceId: CardInstanceId;
}

/**
 * Build and show a card-grid modal: a titled fan of card images, one per
 * choice, where clicking a card dismisses the modal and sends its action.
 *
 * Shared by the sideboard fetch sub-flow and the granted-action target picker
 * so both look and behave identically; `variant` supplies the class-name prefix
 * (and therefore the dismissal scope) of the concrete modal.
 */
function openCardGridModal(
  variant: 'sideboard-fetch' | 'granted-target',
  title: string,
  choices: readonly CardGridChoice[],
  passAction: GameAction | null,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const dismiss = () => dismissCardGridModal(variant);
  // Dismiss any existing modal of this variant first
  dismiss();

  const backdrop = document.createElement('div');
  backdrop.className = `char-action-backdrop ${variant}-backdrop`;

  const modal = document.createElement('div');
  modal.className = `${variant}-modal`;

  const titleEl = document.createElement('div');
  titleEl.className = `${variant}-title`;
  titleEl.textContent = title;
  modal.appendChild(titleEl);

  const grid = document.createElement('div');
  grid.className = `${variant}-grid`;

  const cardPreview = document.getElementById('card-preview');

  for (const choice of choices) {
    const defId = cachedInstanceLookup(choice.instanceId);
    const def = defId ? cardPool[defId as string] : undefined;
    const imgPath = def ? cardImageProxyPath(def) : undefined;

    const img = document.createElement('img');
    img.src = imgPath ?? '/images/card-back.jpg';
    img.alt = def?.name ?? 'Unknown card';
    img.className = `${variant}-card`;
    // Note: deliberately NOT setting data-card-id / data-instance-id here so the
    // FLIP animation system (flip-animate.ts) ignores modal card images and does
    // not try to animate real pile cards from these transient modal positions.
    // Hover preview is wired up directly below instead of via the shared
    // #visual-view delegated listener (setupCardPreview), which never sees
    // these images since the modal is appended to document.body.
    img.style.cursor = 'pointer';

    img.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
      onAction(choice.action);
    });

    if (cardPreview) {
      img.addEventListener('mouseenter', () => {
        cardPreview.innerHTML = '';
        if (def) {
          cardPreview.appendChild(buildCardPreviewInfo(def));
        } else {
          const clone = document.createElement('img');
          clone.src = img.src;
          clone.alt = img.alt;
          cardPreview.appendChild(clone);
        }
      });
      img.addEventListener('mouseleave', () => {
        cardPreview.innerHTML = '';
      });
    }

    grid.appendChild(img);
  }

  modal.appendChild(grid);

  // "Done" button when pass is available (discard mode with at least 1 fetched)
  if (passAction) {
    const doneBtn = tooltipButton('Done', () => {
      dismiss();
      onAction(passAction);
    });
    doneBtn.style.marginTop = '0.6rem';
    modal.appendChild(doneBtn);
  }

  backdrop.onclick = () => dismiss();
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
}

/** Remove a card-grid modal of the given variant and its backdrop. */
function dismissCardGridModal(variant: 'sideboard-fetch' | 'granted-target'): void {
  document.querySelector(`.${variant}-modal`)?.remove();
  document.querySelector(`.${variant}-backdrop`)?.remove();
  // Removing the hovered card's img fires no mouseleave — clear any stale preview.
  const cardPreview = document.getElementById('card-preview');
  if (cardPreview) cardPreview.innerHTML = '';
}

/**
 * Open a sideboard browser modal for the active fetch-from-sideboard sub-flow.
 * Shows eligible sideboard cards; clicking one sends the fetch action.
 * For discard mode with at least 1 fetched, also shows a "Done" button (pass).
 */
export function openSideboardForFetch(
  fetchActions: GameAction[],
  passAction: GameAction | null,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const choices: CardGridChoice[] = [];
  for (const action of fetchActions) {
    if (action.type !== 'fetch-from-sideboard' && action.type !== 'fetch-hazard-from-sideboard') continue;
    choices.push({ action, instanceId: action.sideboardCardInstanceId });
  }
  openCardGridModal('sideboard-fetch', 'Fetch from Sideboard', choices, passAction, cardPool, onAction);
}

/** Remove sideboard fetch modal and its backdrop. */
export function dismissSideboardModal(): void {
  dismissCardGridModal('sideboard-fetch');
}

/**
 * Open a two-pile exchange modal for deck exhaustion sideboard exchange.
 * Shows discard pile on the left and sideboard on the right. The player
 * selects one card from each side, then the exchange action is sent.
 * "Done" button passes to complete the reshuffle.
 */
export function openExchangeModal(
  exchangeActions: GameAction[],
  passAction: GameAction | null,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();

  // Build lookup: discard cards and sideboard cards from the exchange actions
  const discardIds = new Set<string>();
  const sideboardIds = new Set<string>();
  for (const a of exchangeActions) {
    if (a.type !== 'exchange-sideboard') continue;
    discardIds.add(a.discardCardInstanceId as string);
    sideboardIds.add(a.sideboardCardInstanceId as string);
  }

  // If the modal is already open (e.g. re-rendered after a previous swap),
  // reuse the existing element and just replace its contents — this avoids
  // a close/reopen flicker between successive exchanges.
  let modal = document.querySelector<HTMLElement>('.exchange-modal');
  if (modal) {
    modal.replaceChildren();
  } else {
    const backdrop = document.createElement('div');
    backdrop.className = 'char-action-backdrop exchange-modal-backdrop';
    modal = document.createElement('div');
    modal.className = 'exchange-modal';
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
  }

  const title = document.createElement('div');
  title.className = 'sideboard-fetch-title';
  title.textContent = 'Exchange Cards (Deck Exhaustion)';
  modal.appendChild(title);

  const columns = document.createElement('div');
  columns.className = 'exchange-columns';

  // State for selection — track both the id and the DOM element so we can
  // animate the swap in place before dismissing.
  let selectedDiscardId: string | null = null;
  let selectedSideboardId: string | null = null;
  let selectedDiscardEl: HTMLElement | null = null;
  let selectedSideboardEl: HTMLElement | null = null;

  /** Animate two cards swapping positions, then run `onComplete`. */
  function animateSwap(a: HTMLElement, b: HTMLElement, onComplete: () => void): void {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const dx = rb.left - ra.left;
    const dy = rb.top - ra.top;
    // Keep the existing -18px lift so the cards stay raised through the swap.
    const lift = -18;
    const opts: KeyframeAnimationOptions = { duration: 450, easing: 'ease-in-out', fill: 'forwards' };
    const animA = a.animate(
      [
        { transform: `translate(0px, ${lift}px)` },
        { transform: `translate(${dx}px, ${dy + lift}px)` },
      ],
      opts,
    );
    const animB = b.animate(
      [
        { transform: `translate(0px, ${lift}px)` },
        { transform: `translate(${-dx}px, ${-dy + lift}px)` },
      ],
      opts,
    );
    Promise.all([animA.finished, animB.finished]).then(onComplete, onComplete);
  }

  /** Try to execute exchange if both sides selected. */
  function tryExchange(): void {
    if (!selectedDiscardId || !selectedSideboardId) return;
    if (!selectedDiscardEl || !selectedSideboardEl) return;
    const action = exchangeActions.find(
      a => a.type === 'exchange-sideboard'
        && a.discardCardInstanceId === selectedDiscardId
        && a.sideboardCardInstanceId === selectedSideboardId,
    );
    if (!action) return;
    // Capture refs locally — selection state is reset after the animation so
    // the user can pick another pair while the server processes the action.
    const discardEl = selectedDiscardEl;
    const sideboardEl = selectedSideboardEl;
    selectedDiscardId = null;
    selectedSideboardId = null;
    selectedDiscardEl = null;
    selectedSideboardEl = null;
    animateSwap(discardEl, sideboardEl, () => {
      // Don't dismiss the modal — the rerender after the action will either
      // refresh its contents in place (more exchanges available) or dismiss it
      // (no exchange actions left). This avoids a visible close/reopen flicker.
      onAction(action);
    });
  }

  const fanGrids: HTMLElement[] = [];

  /** Sort instance IDs by card type, then by name, for a stable grouped layout. */
  function sortByType(ids: Iterable<string>): string[] {
    return Array.from(ids).sort((a, b) => {
      const defA = cardPool[cachedInstanceLookup(a as CardInstanceId) as string];
      const defB = cardPool[cachedInstanceLookup(b as CardInstanceId) as string];
      const typeA = defA?.cardType ?? '';
      const typeB = defB?.cardType ?? '';
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      return (defA?.name ?? '').localeCompare(defB?.name ?? '');
    });
  }

  /** Render one column of cards as a single horizontal row (cards overlap to fit). */
  function renderColumn(label: string, ids: Set<string>, side: 'discard' | 'sideboard'): HTMLElement {
    const col = document.createElement('div');
    col.className = 'exchange-column';

    const heading = document.createElement('div');
    heading.className = 'exchange-column-heading';
    heading.textContent = label;
    col.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'exchange-fan-grid';
    fanGrids.push(grid);

    for (const instId of sortByType(ids)) {
      const defId = cachedInstanceLookup(instId as CardInstanceId);
      const def = defId ? cardPool[defId as string] : undefined;
      const imgPath = def ? cardImageProxyPath(def) : undefined;

      const img = document.createElement('img');
      img.src = imgPath ?? '/images/card-back.jpg';
      img.alt = def?.name ?? 'Unknown card';
      img.className = 'sideboard-fetch-card';
      // Note: deliberately NOT setting data-card-id / data-instance-id here so the
      // FLIP animation system (flip-animate.ts) ignores modal card images and does
      // not try to animate real pile cards from these transient modal positions.
      img.style.cursor = 'pointer';

      img.addEventListener('click', (e) => {
        e.stopPropagation();
        // Clear previous selection in this column
        for (const prev of grid.querySelectorAll('.sideboard-fetch-card--selected')) {
          prev.classList.remove('sideboard-fetch-card--selected');
        }
        img.classList.add('sideboard-fetch-card--selected');
        if (side === 'discard') {
          selectedDiscardId = instId;
          selectedDiscardEl = img;
        } else {
          selectedSideboardId = instId;
          selectedSideboardEl = img;
        }
        tryExchange();
      });

      grid.appendChild(img);
    }

    col.appendChild(grid);
    return col;
  }

  /**
   * Compute overlap so all cards in a fan grid fit on a single row.
   * If cards already fit at full width, no overlap is applied.
   */
  function applyFanOverlap(grid: HTMLElement): void {
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.sideboard-fetch-card'));
    if (cards.length <= 1) return;
    const containerWidth = grid.clientWidth;
    const cardWidth = cards[0].offsetWidth;
    if (cardWidth <= 0 || containerWidth <= 0) return;
    const totalWidth = cards.length * cardWidth;
    if (totalWidth <= containerWidth) return;
    // Overlap is the per-card horizontal shift; first card stays at 0.
    const overlap = (totalWidth - containerWidth) / (cards.length - 1);
    for (let i = 1; i < cards.length; i++) {
      cards[i].style.marginLeft = `-${overlap}px`;
    }
  }

  // Sideboard on top, Discard on bottom.
  columns.appendChild(renderColumn('Sideboard', sideboardIds, 'sideboard'));
  columns.appendChild(renderColumn('Discard Pile', discardIds, 'discard'));
  modal.appendChild(columns);

  // "Done" button
  if (passAction) {
    const doneBtn = tooltipButton('Done', () => {
      dismissExchangeModal();
      onAction(passAction);
    });
    doneBtn.style.marginTop = '0.6rem';
    modal.appendChild(doneBtn);
  }

  // Apply overlap once card images have loaded so offsetWidth is accurate.
  // On the first open, images are not yet cached and have no intrinsic width
  // until loaded; a plain requestAnimationFrame would see offsetWidth === 0
  // and skip the overlap calculation.
  const allImages = fanGrids.flatMap(g =>
    Array.from(g.querySelectorAll<HTMLImageElement>('.sideboard-fetch-card')),
  );
  const applyAll = (): void => {
    requestAnimationFrame(() => {
      for (const grid of fanGrids) applyFanOverlap(grid);
    });
  };
  const pending = allImages.filter(img => !img.complete);
  if (pending.length === 0) {
    applyAll();
  } else {
    let remaining = pending.length;
    const onLoad = (): void => {
      remaining--;
      if (remaining === 0) applyAll();
    };
    for (const img of pending) {
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onLoad, { once: true });
    }
  }
}

/** Remove exchange modal and its backdrop. */
export function dismissExchangeModal(): void {
  document.querySelector('.exchange-modal')?.remove();
  document.querySelector('.exchange-modal-backdrop')?.remove();
}

/**
 * Show a small tooltip near a character card with action choices:
 * "Reassign Influence" and "Split / Move Company".
 */
export function showCharacterActionTooltip(
  anchor: HTMLElement,
  charInstId: CardInstanceId,
  cardPool: Readonly<Record<string, CardDefinition>>,
  options: {
    onAction?: (action: GameAction) => void;
    influenceActions?: Map<string, MoveToInfluenceAction[]>;
    splitActions?: Map<string, SplitCompanyAction>;
    moveToCompanyActions?: Map<string, MoveToCompanyAction[]>;
    mergeActions?: Map<string, MergeCompaniesAction[]>;
    sideboardIntentActions?: Map<string, (StartSideboardToDeckAction | StartSideboardToDiscardAction)[]>;
    corruptionCheckActions?: Map<string, CorruptionCheckAction>;
    supportCorruptionCheckActions?: Map<string, SupportCorruptionCheckAction>;
    restoreCharacterActions?: Map<string, RestoreCharacterByEffectAction>;
    declareBurglaryActions?: Map<string, DeclareBurglaryAction[]>;
    grantedActions?: Map<string, ActivateGrantedAction[]>;
    discardCharacterActions?: Map<string, DiscardCharacterOrgAction>;
    companyId?: CompanyId;
  },
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const lastView = getLastView();
  const onAction = options.onAction!;

  const items: TooltipMenuItem[] = [];

  const influenceActions = options.influenceActions?.get(charInstId as string) ?? [];
  const splitAction = options.splitActions?.get(charInstId as string);
  const moveActions = options.moveToCompanyActions?.get(charInstId as string);

  for (const ia of influenceActions) {
    let label: string;
    if (ia.controlledBy === 'general') {
      label = 'Move under GI';
    } else {
      const ctrlDef = cachedInstanceLookup(ia.controlledBy);
      const ctrlName = ctrlDef ? cardPool[ctrlDef as string]?.name : undefined;
      label = `Move under DI of ${ctrlName ?? 'character'}`;
    }
    items.push({ label, onClick: () => onAction(ia) });
  }

  if (splitAction) {
    items.push({
      label: 'Split to New Company',
      onClick: () => {
        setPendingFocusCharacterId(splitAction.characterId);
        onAction(splitAction);
      },
    });
  }

  if (moveActions && moveActions.length > 0) {
    items.push({
      label: 'Move to Company',
      onClick: () => {
        setCompanyMoveSourceId(charInstId);
        setCompanyMoveSourceCompanyId(moveActions[0].sourceCompanyId);
        const sourceDefId = cachedInstanceLookup(charInstId);
        const sourceName = sourceDefId ? cardPool[sourceDefId as string]?.name : undefined;
        setTargetingInstruction(
          `Click a company to move ${sourceName ?? 'character'} there`,
        );
        switchToAllCompanies();
        rerender();
      },
    });
  }

  const mergeActionsForCompany = options.companyId
    ? options.mergeActions?.get(options.companyId as string)
    : undefined;
  if (mergeActionsForCompany && mergeActionsForCompany.length > 0) {
    items.push({
      label: 'Join Company',
      onClick: () => {
        if (mergeActionsForCompany.length === 1) {
          // Only one target — execute directly
          onAction(mergeActionsForCompany[0]);
        } else {
          // Multiple targets — enter targeting mode
          setMergeSourceCompanyId(options.companyId!);
          setTargetingInstruction('Click a company to join into');
          switchToAllCompanies();
          rerender();
        }
      },
    });
  }

  const sideboardIntents = options.sideboardIntentActions?.get(charInstId as string) ?? [];
  for (const intent of sideboardIntents) {
    items.push({
      label: intent.type === 'start-sideboard-to-deck' ? 'Fetch to Deck' : 'Fetch to Discard',
      onClick: () => onAction(intent),
    });
  }

  const ccAction = options.corruptionCheckActions?.get(charInstId as string);
  if (ccAction) {
    items.push({ label: 'Corruption Check', onClick: () => onAction(ccAction) });
  }

  const ccSupportAction = options.supportCorruptionCheckActions?.get(charInstId as string);
  if (ccSupportAction) {
    items.push({ label: 'Tap for CC Support (+1)', onClick: () => onAction(ccSupportAction) });
  }

  const restoreAction = options.restoreCharacterActions?.get(charInstId as string);
  if (restoreAction) {
    const charStatus = lastView?.self.characters[charInstId]?.status;
    const label = charStatus === CardStatus.Inverted ? 'Heal (Hall of Fire)' : 'Untap (Hall of Fire)';
    items.push({ label, onClick: () => onAction(restoreAction) });
  }

  const burglaryActions = options.declareBurglaryActions?.get(charInstId as string) ?? [];
  for (const ba of burglaryActions) {
    const cardDefId = cachedInstanceLookup(ba.cardInstanceId);
    const cardName = cardDefId ? cardPool[cardDefId as string]?.name : undefined;
    items.push({
      label: `Attempt Burglary${cardName ? ` (${cardName.trim()})` : ''}`,
      onClick: () => onAction(ba),
    });
  }

  const grantedActionsForChar = options.grantedActions?.get(charInstId as string) ?? [];
  items.push(...buildGrantedActionMenuItems(grantedActionsForChar, onAction, id => {
    const defId = cachedInstanceLookup(id);
    return defId ? cardPool[defId as string]?.name : undefined;
  }));

  const discardAction = options.discardCharacterActions?.get(charInstId as string);
  if (discardAction) {
    const charDefId = cachedInstanceLookup(charInstId);
    const charName = charDefId ? cardPool[charDefId as string]?.name : undefined;
    items.push({
      label: 'Discard Character',
      onClick: () => {
        void showConfirm(`Discard ${charName ?? 'this character'}?`).then(ok => {
          if (ok) onAction(discardAction);
        });
      },
    });
  }

  // Opponent influence: enter targeting mode
  if (lastView) {
    const oppInfluenceActions = viableActions(lastView.legalActions).filter(
      (a): a is OpponentInfluenceAttemptAction =>
        a.type === 'opponent-influence-attempt' && a.influencingCharacterId === charInstId,
    );
    if (oppInfluenceActions.length > 0) {
      const charDefId = cachedInstanceLookup(charInstId);
      const charName = charDefId ? cardPool[charDefId as string]?.name : undefined;
      items.push({
        label: 'Influence Opponent',
        onClick: () => {
          setSelectedInfluencerForOpponent(charInstId);
          setTargetingInstruction(
            `Click an opponent's card to attempt influence with ${charName ?? 'character'}`,
          );
          switchToAllCompanies();
          rerender();
        },
      });
    }
  }

  showTooltipMenu(anchor, items);
}

/**
 * Walk an opponent company block's DOM to add click handlers on cards
 * that are valid targets for an opponent influence attempt.
 *
 * Finds character columns and ally/item images by their `data-instance-id`
 * attribute and highlights targetable ones with a click handler.
 */
export function addOpponentInfluenceTargets(
  block: HTMLElement,
  actions: OpponentInfluenceAttemptAction[],
  onAction: (action: GameAction) => void,
): void {
  // Group actions by target instance ID (may have reveal/no-reveal variants)
  const targetActions = new Map<string, OpponentInfluenceAttemptAction[]>();
  for (const action of actions) {
    const key = action.targetInstanceId as string;
    const existing = targetActions.get(key) ?? [];
    existing.push(action);
    targetActions.set(key, existing);
  }

  /** Attach click handler to a card image for the given target actions. */
  const attachHandler = (img: HTMLImageElement, acts: OpponentInfluenceAttemptAction[]): void => {
    img.classList.add('company-card--influence-target');
    img.style.cursor = 'pointer';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      if (acts.length === 1) {
        // Single variant — dispatch directly
        clearOpponentInfluenceSelection();
        onAction(acts[0]);
      } else {
        // Multiple variants (with/without reveal) — show tooltip menu
        showOpponentInfluenceMenu(e, acts, onAction);
      }
    });
  };

  // Walk all card images with instance IDs
  const allImages = block.querySelectorAll<HTMLImageElement>('[data-instance-id]');
  const handled = new Set<string>();
  for (const img of allImages) {
    const instId = img.dataset.instanceId;
    if (!instId || handled.has(instId)) continue;
    const acts = targetActions.get(instId);
    if (!acts) continue;
    handled.add(instId);
    attachHandler(img, acts);
  }

  // Character columns have their own data-instance-id — check those too
  const cols = block.querySelectorAll<HTMLElement>('.character-column[data-instance-id]');
  for (const col of cols) {
    const instId = col.dataset.instanceId;
    if (!instId || handled.has(instId)) continue;
    const acts = targetActions.get(instId);
    if (!acts) continue;
    handled.add(instId);
    const charImg = col.querySelector<HTMLImageElement>('.company-card[data-instance-id="' + instId + '"]');
    if (charImg) attachHandler(charImg, acts);
  }
}

/** Human-friendly labels for granted action IDs. */
export const GRANTED_ACTION_LABELS: Readonly<Record<string, string>> = {
  'untap-bearer': 'Untap Bearer',
  'extra-region-movement': 'Extra Movement',
  'remove-self-on-roll': 'Attempt Removal',
  'cancel-attack': 'Cancel Attack',
  'test-gold-ring': 'Test Gold Ring',
  'palantir-fetch-discard': 'Fetch from Discard',
  'gwaihir-special-movement': 'Special Movement',
  'saruman-fetch-spell': 'Fetch Spell',
  'cancel-constraint': 'Cancel Constraint',
  'cancel-return-and-site-tap': 'Cancel Return',
  'cancel-river': 'Cancel River (ranger tap)',
  'cancel-chain-entry': 'Cancel',
  'sauron-sideboard-fetch': 'Fetch from Sideboard',
  'sauron-peek-hand': 'Discard to Peek at Opponent\'s Hand',
  'anduril-combine-with-narsil': 'Combine with Narsil',
  'reforging-retrieve-item': 'Retrieve Item from Discard',
};

/**
 * Group granted actions by their `actionId`, preserving first-seen order.
 *
 * A single card may grant several distinct abilities (The Lidless Eye le-203 /
 * Sauron ba-43: sideboard-fetch **or** peek-at-hand) and each ability may be
 * offered once per candidate target (one action per eligible sideboard card, one
 * per hand card). The board menu shows one entry per ability; the candidates
 * within a group are then chosen from a card picker rather than from a list of
 * identically-labelled menu entries.
 *
 * Exported for regression testing without a DOM render.
 */
export function groupGrantedActionsByAbility(
  actions: readonly ActivateGrantedAction[],
): ActivateGrantedAction[][] {
  const groups = new Map<string, ActivateGrantedAction[]>();
  for (const action of actions) {
    const existing = groups.get(action.actionId);
    if (existing) existing.push(action);
    else groups.set(action.actionId, [action]);
  }
  return [...groups.values()];
}

/**
 * Show the ability menu for a bearer-less in-play card that grants actions
 * (The Lidless Eye le-203 / Sauron ba-43 during the controller's organization
 * phase).
 *
 * One menu entry per granted ability. Choosing an ability whose candidates are
 * cards (`targetCardId` — a sideboard card to bring into the play deck, a hand
 * card to discard as the peek cost) opens a card picker so the player sees what
 * they are choosing; a targetless ability fires directly.
 */
export function showInPlayGrantedActionMenu(
  anchor: HTMLElement,
  actions: readonly ActivateGrantedAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const items = groupGrantedActionsByAbility(actions).map((group): TooltipMenuItem => {
    const label = GRANTED_ACTION_LABELS[group[0].actionId] ?? group[0].actionId;
    return {
      label,
      onClick: () => {
        const choices = group
          .filter(a => a.targetCardId !== undefined)
          .map(a => ({ action: a as GameAction, instanceId: a.targetCardId as CardInstanceId }));
        if (choices.length === 0) {
          onAction(group[0]);
          return;
        }
        openCardGridModal('granted-target', label, choices, null, cardPool, onAction);
      },
    };
  });
  showTooltipMenu(anchor, items);
}

/**
 * Build the tooltip menu items for a set of granted actions on a single card
 * (e.g. Cram offers both untap-bearer and extra-region-movement). Exported so
 * callers that need to merge granted actions into a larger combined menu
 * (e.g. an item that is both usable and transferable) can build the entries
 * without opening a tooltip themselves.
 *
 * @param resolveName - optional lookup that resolves any card instance ID
 *   (character or item) to a display name; used to disambiguate entries that
 *   share an `actionId`. Two shapes of ambiguity exist: different acting
 *   characters (e.g. two rangers each able to cancel River — disambiguated by
 *   `characterId`), or the same character offering the ability once per
 *   (item, recipient) candidate pair (The Forge-master wh-117 — disambiguated
 *   by `targetCardId` / `recipientCharacterId`).
 */
export function buildGrantedActionMenuItems(
  actions: readonly ActivateGrantedAction[],
  onAction: (action: GameAction) => void,
  resolveName?: (id: CardInstanceId) => string | undefined,
): TooltipMenuItem[] {
  // Detect when multiple entries share the same actionId so we know whether
  // appending disambiguating names is necessary.
  const actionIdCounts = new Map<string, number>();
  const byActionId = new Map<string, ActivateGrantedAction[]>();
  for (const a of actions) {
    actionIdCounts.set(a.actionId, (actionIdCounts.get(a.actionId) ?? 0) + 1);
    const group = byActionId.get(a.actionId);
    if (group) group.push(a);
    else byActionId.set(a.actionId, [a]);
  }

  const items: TooltipMenuItem[] = [];
  for (const [actionId, group] of byActionId) {
    // A group that varies over both `targetCardId` and `recipientCharacterId`
    // is a two-dimensional cross product — one entry per (item, recipient)
    // pair, e.g. The Forge-master (wh-117) offering every qualifying fetched
    // item × every eligible recipient at its site. Flattened, this can
    // easily exceed what fits on screen with no way to scroll (bug report
    // db6910ae7bc65e25: 7 items × 4 recipients = 28 buttons). Narrow it into
    // a two-step picker instead: one top-level entry per item, opening a
    // submenu of that item's recipients.
    const distinctItems = new Set(group.map(a => a.targetCardId).filter((id): id is CardInstanceId => id !== undefined));
    const distinctRecipients = new Set(group.map(a => a.recipientCharacterId).filter((id): id is CardInstanceId => id !== undefined));
    if (resolveName && distinctItems.size > 1 && distinctRecipients.size > 1) {
      const baseLabel = GRANTED_ACTION_LABELS[actionId] ?? actionId;
      const byItem = new Map<string, ActivateGrantedAction[]>();
      for (const a of group) {
        const key = a.targetCardId as string;
        const itemGroup = byItem.get(key);
        if (itemGroup) itemGroup.push(a);
        else byItem.set(key, [a]);
      }
      for (const [itemId, itemGroup] of byItem) {
        const itemName = resolveName(itemId as CardInstanceId) ?? itemId;
        items.push({
          label: `${baseLabel} — ${itemName}`,
          children: itemGroup.map((a): TooltipMenuItem => {
            const recipientName = a.recipientCharacterId ? resolveName(a.recipientCharacterId) : undefined;
            return { label: recipientName ? `to ${recipientName}` : baseLabel, onClick: () => onAction(a) };
          }),
        });
      }
      continue;
    }

    for (const action of group) {
      // METD §7 / rule 10.08: corruption removal has two variants for the
      // same actionId — tap-and-roll (standard) vs no-tap-at-minus-3.
      // Distinguish them by the action's `noTap` flag; otherwise fall back
      // to the action-id label.
      const baseLabel = GRANTED_ACTION_LABELS[action.actionId] ?? action.actionId;
      let label = action.noTap === true
        ? `${baseLabel} (no tap, -3)`
        : action.actionId === 'remove-self-on-roll'
          ? `${baseLabel} (tap)`
          : baseLabel;
      if (resolveName && (actionIdCounts.get(action.actionId) ?? 0) > 1) {
        if (action.targetCardId || action.recipientCharacterId) {
          // Same acting character, single-dimension ambiguity (only items or
          // only recipients vary) — name whichever varies.
          const itemName = action.targetCardId ? resolveName(action.targetCardId) : undefined;
          const recipientName = action.recipientCharacterId ? resolveName(action.recipientCharacterId) : undefined;
          const parts = [itemName, recipientName ? `to ${recipientName}` : undefined].filter((p): p is string => !!p);
          if (parts.length > 0) label += ` — ${parts.join(' ')}`;
        } else if (action.characterId) {
          // Different acting characters offering the same ability — append the
          // acting character's name so the player knows which one taps.
          const charName = resolveName(action.characterId);
          if (charName) label += ` — ${charName}`;
        }
      }
      items.push({ label, onClick: () => onAction(action) });
    }
  }
  return items;
}

/**
 * Show a tooltip menu for choosing between multiple granted actions on a single card
 * (e.g. Cram offers both untap-bearer and extra-region-movement).
 *
 * @param getCharacterName - optional lookup that resolves a card instance ID
 *   (character or item) to a display name; used to disambiguate entries that
 *   share an `actionId` (see {@link buildGrantedActionMenuItems}).
 */
export function showGrantedActionTooltip(
  anchor: HTMLElement,
  actions: ActivateGrantedAction[],
  onAction: (action: GameAction) => void,
  getCharacterName?: (id: CardInstanceId) => string | undefined,
): void {
  showTooltipMenu(anchor, buildGrantedActionMenuItems(actions, onAction, getCharacterName));
}

/**
 * Show a tooltip menu for choosing between opponent influence variants
 * (with or without revealing an identical card from hand).
 */
export function showOpponentInfluenceMenu(
  e: Event,
  actions: OpponentInfluenceAttemptAction[],
  onAction: (action: GameAction) => void,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const lastCardPool = getLastCardPool();

  const items = actions.map((action): TooltipMenuItem => {
    let label = 'Influence (no reveal)';
    if (action.revealedCardInstanceId) {
      const revealDef = lastCardPool
        ? lastCardPool[cachedInstanceLookup(action.revealedCardInstanceId) as string]
        : undefined;
      label = `Influence (reveal ${revealDef?.name ?? 'card'})`;
    }
    return {
      label,
      onClick: () => {
        clearOpponentInfluenceSelection();
        onAction(action);
      },
    };
  });

  showTooltipMenu(e.target as HTMLElement, items, { placement: 'under-left' });
}
