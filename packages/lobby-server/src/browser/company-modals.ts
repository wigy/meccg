/**
 * @module company-modals
 *
 * Modal dialogs and tooltip menus for company-view interactions:
 * - Character action tooltip (influence, split, move, merge, sideboard, corruption)
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
  OpponentInfluenceAttemptAction,
} from '@meccg/shared';
import { cardImageProxyPath, viableActions } from '@meccg/shared';
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
import { setSelectedInfluencerForOpponent, clearOpponentInfluenceSelection, setTargetingInstruction } from './render.js';
import { switchToAllCompanies } from './company-view.js';

/** Remove any open character action tooltip and its backdrop from the DOM. */
export function dismissTooltip(): void {
  const existing = document.querySelector('.char-action-tooltip');
  if (existing) existing.remove();
  const backdrop = document.querySelector('.char-action-backdrop');
  if (backdrop) backdrop.remove();
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
  const cachedInstanceLookup = getCachedInstanceLookup();
  // Dismiss any existing modal first
  dismissSideboardModal();

  const backdrop = document.createElement('div');
  backdrop.className = 'char-action-backdrop sideboard-fetch-backdrop';

  const modal = document.createElement('div');
  modal.className = 'sideboard-fetch-modal';

  const title = document.createElement('div');
  title.className = 'sideboard-fetch-title';
  title.textContent = 'Fetch from Sideboard';
  modal.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'sideboard-fetch-grid';

  for (const action of fetchActions) {
    if (action.type !== 'fetch-from-sideboard' && action.type !== 'fetch-hazard-from-sideboard') continue;
    const cardInstId = action.sideboardCardInstanceId as string;
    const defId = cachedInstanceLookup(cardInstId as CardInstanceId);
    const def = defId ? cardPool[defId as string] : undefined;
    const imgPath = def ? cardImageProxyPath(def) : undefined;

    const img = document.createElement('img');
    img.src = imgPath ?? '/images/card-back.jpg';
    img.alt = def?.name ?? 'Unknown card';
    img.className = 'sideboard-fetch-card';
    if (defId) img.dataset.cardId = defId as string;
    img.style.cursor = 'pointer';

    img.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissSideboardModal();
      onAction(action);
    });

    grid.appendChild(img);
  }

  modal.appendChild(grid);

  // "Done" button when pass is available (discard mode with at least 1 fetched)
  if (passAction) {
    const doneBtn = document.createElement('button');
    doneBtn.className = 'char-action-tooltip__btn';
    doneBtn.style.marginTop = '0.6rem';
    doneBtn.textContent = 'Done';
    doneBtn.onclick = (e) => {
      e.stopPropagation();
      dismissSideboardModal();
      onAction(passAction);
    };
    modal.appendChild(doneBtn);
  }

  backdrop.onclick = () => dismissSideboardModal();
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
}

/** Remove sideboard fetch modal and its backdrop. */
export function dismissSideboardModal(): void {
  document.querySelector('.sideboard-fetch-modal')?.remove();
  document.querySelector('.sideboard-fetch-backdrop')?.remove();
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
  dismissExchangeModal();

  // Build lookup: discard cards and sideboard cards from the exchange actions
  const discardIds = new Set<string>();
  const sideboardIds = new Set<string>();
  for (const a of exchangeActions) {
    if (a.type !== 'exchange-sideboard') continue;
    discardIds.add(a.discardCardInstanceId as string);
    sideboardIds.add(a.sideboardCardInstanceId as string);
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'char-action-backdrop exchange-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'exchange-modal';

  const title = document.createElement('div');
  title.className = 'sideboard-fetch-title';
  title.textContent = 'Exchange Cards (Deck Exhaustion)';
  modal.appendChild(title);

  const columns = document.createElement('div');
  columns.className = 'exchange-columns';

  // State for selection
  let selectedDiscardId: string | null = null;
  let selectedSideboardId: string | null = null;

  /** Try to execute exchange if both sides selected. */
  function tryExchange(): void {
    if (!selectedDiscardId || !selectedSideboardId) return;
    const action = exchangeActions.find(
      a => a.type === 'exchange-sideboard'
        && a.discardCardInstanceId === selectedDiscardId
        && a.sideboardCardInstanceId === selectedSideboardId,
    );
    if (action) {
      dismissExchangeModal();
      onAction(action);
    }
  }

  /** Render one column of cards. */
  function renderColumn(label: string, ids: Set<string>, side: 'discard' | 'sideboard'): HTMLElement {
    const col = document.createElement('div');
    col.className = 'exchange-column';

    const heading = document.createElement('div');
    heading.className = 'exchange-column-heading';
    heading.textContent = label;
    col.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'sideboard-fetch-grid';

    for (const instId of ids) {
      const defId = cachedInstanceLookup(instId as CardInstanceId);
      const def = defId ? cardPool[defId as string] : undefined;
      const imgPath = def ? cardImageProxyPath(def) : undefined;

      const img = document.createElement('img');
      img.src = imgPath ?? '/images/card-back.jpg';
      img.alt = def?.name ?? 'Unknown card';
      img.className = 'sideboard-fetch-card';
      if (defId) img.dataset.cardId = defId as string;
      img.style.cursor = 'pointer';

      img.addEventListener('click', (e) => {
        e.stopPropagation();
        // Clear previous selection in this column
        for (const prev of grid.querySelectorAll('.sideboard-fetch-card--selected')) {
          prev.classList.remove('sideboard-fetch-card--selected');
        }
        img.classList.add('sideboard-fetch-card--selected');
        if (side === 'discard') selectedDiscardId = instId;
        else selectedSideboardId = instId;
        tryExchange();
      });

      grid.appendChild(img);
    }

    col.appendChild(grid);
    return col;
  }

  columns.appendChild(renderColumn('Discard Pile', discardIds, 'discard'));
  columns.appendChild(renderColumn('Sideboard', sideboardIds, 'sideboard'));
  modal.appendChild(columns);

  // "Done" button
  if (passAction) {
    const doneBtn = document.createElement('button');
    doneBtn.className = 'char-action-tooltip__btn';
    doneBtn.style.marginTop = '0.6rem';
    doneBtn.textContent = 'Done';
    doneBtn.onclick = (e) => {
      e.stopPropagation();
      dismissExchangeModal();
      onAction(passAction);
    };
    modal.appendChild(doneBtn);
  }

  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
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
    companyId?: CompanyId;
  },
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const lastView = getLastView();
  dismissTooltip();
  const onAction = options.onAction!;

  const tooltip = document.createElement('div');
  tooltip.className = 'char-action-tooltip';

  const influenceActions = options.influenceActions?.get(charInstId as string);
  const splitActions = options.splitActions?.get(charInstId as string);
  const moveActions = options.moveToCompanyActions?.get(charInstId as string);

  if (influenceActions && influenceActions.length > 0) {
    for (const ia of influenceActions) {
      const btn = document.createElement('button');
      btn.className = 'char-action-tooltip__btn';
      if (ia.controlledBy === 'general') {
        btn.textContent = 'Move under GI';
      } else {
        const ctrlDef = cachedInstanceLookup(ia.controlledBy);
        const ctrlName = ctrlDef ? cardPool[ctrlDef as string]?.name : undefined;
        btn.textContent = `Move under DI of ${ctrlName ?? 'character'}`;
      }
      btn.onclick = (e) => {
        e.stopPropagation();
        dismissTooltip();
        onAction(ia);
      };
      tooltip.appendChild(btn);
    }
  }

  if (splitActions) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Split to New Company';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      setPendingFocusCharacterId(splitActions.characterId);
      onAction(splitActions);
    };
    tooltip.appendChild(btn);
  }

  if (moveActions && moveActions.length > 0) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Move to Company';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      setCompanyMoveSourceId(charInstId);
      setCompanyMoveSourceCompanyId(moveActions[0].sourceCompanyId);
      const sourceDefId = cachedInstanceLookup(charInstId);
      const sourceName = sourceDefId ? cardPool[sourceDefId as string]?.name : undefined;
      setTargetingInstruction(
        `Click a company to move ${sourceName ?? 'character'} there`,
      );
      rerender();
    };
    tooltip.appendChild(btn);
  }

  const mergeActionsForCompany = options.companyId
    ? options.mergeActions?.get(options.companyId as string)
    : undefined;
  if (mergeActionsForCompany && mergeActionsForCompany.length > 0) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Join Company';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      if (mergeActionsForCompany.length === 1) {
        // Only one target — execute directly
        onAction(mergeActionsForCompany[0]);
      } else {
        // Multiple targets — enter targeting mode
        setMergeSourceCompanyId(options.companyId!);
        setTargetingInstruction('Click a company to join into');
        rerender();
      }
    };
    tooltip.appendChild(btn);
  }

  const sideboardIntents = options.sideboardIntentActions?.get(charInstId as string);
  if (sideboardIntents && sideboardIntents.length > 0) {
    for (const intent of sideboardIntents) {
      const btn = document.createElement('button');
      btn.className = 'char-action-tooltip__btn';
      btn.textContent = intent.type === 'start-sideboard-to-deck'
        ? 'Fetch to Deck' : 'Fetch to Discard';
      btn.onclick = (e) => {
        e.stopPropagation();
        dismissTooltip();
        onAction(intent);
      };
      tooltip.appendChild(btn);
    }
  }

  const ccAction = options.corruptionCheckActions?.get(charInstId as string);
  if (ccAction) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Corruption Check';
    btn.onclick = (e) => {
      e.stopPropagation();
      dismissTooltip();
      onAction(ccAction);
    };
    tooltip.appendChild(btn);
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
      const btn = document.createElement('button');
      btn.className = 'char-action-tooltip__btn';
      btn.textContent = 'Influence Opponent';
      btn.onclick = (e) => {
        e.stopPropagation();
        dismissTooltip();
        setSelectedInfluencerForOpponent(charInstId);
        setTargetingInstruction(
          `Click an opponent's card to attempt influence with ${charName ?? 'character'}`,
        );
        switchToAllCompanies();
        rerender();
      };
      tooltip.appendChild(btn);
    }
  }

  // Create a modal backdrop that blocks interaction and dismisses on click
  const backdrop = document.createElement('div');
  backdrop.className = 'char-action-backdrop';
  backdrop.onclick = () => dismissTooltip();
  document.body.appendChild(backdrop);

  // Position near the anchor element
  const rect = anchor.getBoundingClientRect();
  tooltip.style.position = 'fixed';
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top}px`;
  document.body.appendChild(tooltip);
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
  dismissTooltip();

  const tooltip = document.createElement('div');
  tooltip.className = 'char-action-tooltip';

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    if (action.revealedCardInstanceId) {
      const revealDef = lastCardPool
        ? lastCardPool[cachedInstanceLookup(action.revealedCardInstanceId) as string]
        : undefined;
      btn.textContent = `Influence (reveal ${revealDef?.name ?? 'card'})`;
    } else {
      btn.textContent = 'Influence (no reveal)';
    }
    btn.onclick = (ev) => {
      ev.stopPropagation();
      dismissTooltip();
      clearOpponentInfluenceSelection();
      onAction(action);
    };
    tooltip.appendChild(btn);
  }

  // Backdrop (uses same class as character action tooltip for cleanup)
  const backdrop = document.createElement('div');
  backdrop.className = 'char-action-backdrop';
  backdrop.onclick = () => dismissTooltip();
  document.body.appendChild(backdrop);

  document.body.appendChild(tooltip);

  // Position near click target
  const anchor = e.target as HTMLElement;
  const rect = anchor.getBoundingClientRect();
  tooltip.style.position = 'fixed';
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + 4}px`;
}
