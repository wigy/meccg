/**
 * @module company-views
 *
 * View-mode renderers for the company display area:
 * - Single focused company at full scale with left/right navigation arrows
 * - All-companies overview at medium scale with targeting and selection
 * - View toggle button (grid/crosshair) for switching between modes
 */

import type {
  PlayerView,
  CardDefinition,
  CardInstanceId,
  Company,
  OpponentCompanyView,
  CharacterInPlay,
  SelectCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  OpponentInfluenceAttemptAction,
} from '@meccg/shared';
import { viableActions } from '@meccg/shared';
import { getSelectedCharacterForPlay, clearCharacterPlaySelection, getSelectedInfluencerForOpponent } from './render.js';
import {
  getFocusedCompanyId, setFocusedCompanyId,
  getSavedFocusedCompanyId, setSavedFocusedCompanyId,
  setAllCompaniesOverride,
  getCompanyMoveSourceId, setCompanyMoveSourceId,
  getCompanyMoveSourceCompanyId, setCompanyMoveSourceCompanyId,
  getMergeSourceCompanyId, setMergeSourceCompanyId,
  setPendingFocusCharacterId,
  getLastOnAction,
  rerender,
} from './company-view-state.js';
import { renderCompanyBlock, renderDummyCompanyBlock } from './company-block.js';
import {
  getMovableCompanyIds,
  getMoveToInfluenceActions,
  getTransferItemActions,
  getStoreItemActions,
  getSplitCompanyActions,
  getMoveToCompanyActions,
  getMergeCompaniesActions,
  getSideboardIntentActions,
  getCorruptionCheckActions,
  getSupportCorruptionCheckActions,
  getGrantedActions,
  getPlayCharacterActions,
  getSelectCardBearerActions,
} from './company-actions.js';
import { addOpponentInfluenceTargets } from './company-modals.js';
import { setTargetingInstruction } from './render.js';

/** Render a single focused company at full scale. */
export function renderSingleView(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const lastOnAction = getLastOnAction()!;
  const focusedCompanyId = getFocusedCompanyId();

  // Find the focused company across both players
  let company: Company | OpponentCompanyView | undefined;
  let charMap: Readonly<Record<string, CharacterInPlay>> = view.self.characters;
  let owner: 'self' | 'opponent' = 'self';

  if (focusedCompanyId) {
    company = view.self.companies.find(c => c.id === focusedCompanyId);
    if (!company) {
      company = view.opponent.companies.find(c => c.id === focusedCompanyId);
      if (company) {
        charMap = view.opponent.characters;
        owner = 'opponent';
      }
    }
  }

  if (!company) {
    // Focused company no longer exists — fall back to overview
    setFocusedCompanyId(null);
    renderAllCompaniesView(container, view, cardPool);
    return;
  }

  // Determine which list of companies to cycle through
  const isSelfTurn = view.activePlayer !== null && view.activePlayer === view.self.id;
  const cycleCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
  const currentIndex = cycleCompanies.findIndex(c => c.id === focusedCompanyId);

  const single = document.createElement('div');
  single.className = 'company-single';
  single.style.setProperty('--company-scale', '1');

  // Left arrow — previous company
  if (cycleCompanies.length > 1) {
    const leftArrow = document.createElement('button');
    leftArrow.className = 'company-nav-arrow company-nav-arrow--left';
    leftArrow.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48"><polyline points="15,4 7,12 15,20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    leftArrow.onclick = () => {
      const prev = currentIndex <= 0 ? cycleCompanies.length - 1 : currentIndex - 1;
      setFocusedCompanyId(cycleCompanies[prev].id);
      setSavedFocusedCompanyId(cycleCompanies[prev].id);
      rerender();
    };
    single.appendChild(leftArrow);
  }

  const movableIds = getMovableCompanyIds(view);
  const hasLegalMovement = movableIds.has(company.id as string);
  const influenceActions = owner === 'self' ? getMoveToInfluenceActions(view) : undefined;
  const transferActions = owner === 'self' ? getTransferItemActions(view) : undefined;
  const storeItemActs = owner === 'self' ? getStoreItemActions(view) : undefined;
  const splitActions = owner === 'self' ? getSplitCompanyActions(view) : undefined;
  const moveToCompanyActs = owner === 'self' ? getMoveToCompanyActions(view) : undefined;
  const sideboardIntentActs = owner === 'self' ? getSideboardIntentActions(view) : undefined;
  const ccActions = owner === 'self' ? getCorruptionCheckActions(view) : undefined;
  const ccSupportActs = owner === 'self' ? getSupportCorruptionCheckActions(view) : undefined;
  const grantedActs = owner === 'self' ? getGrantedActions(view) : undefined;
  const bearerActs = owner === 'self' ? getSelectCardBearerActions(view) : undefined;
  single.appendChild(renderCompanyBlock(company, charMap, view, cardPool, owner, { hideTitle: true, hasLegalMovement, onAction: lastOnAction, influenceActions, transferActions, storeItemActions: storeItemActs, splitActions, moveToCompanyActions: moveToCompanyActs, sideboardIntentActions: sideboardIntentActs, corruptionCheckActions: ccActions, supportCorruptionCheckActions: ccSupportActs, grantedActions: grantedActs, selectCardBearerActions: bearerActs }));

  // Right arrow — next company
  if (cycleCompanies.length > 1) {
    const rightArrow = document.createElement('button');
    rightArrow.className = 'company-nav-arrow company-nav-arrow--right';
    rightArrow.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48"><polyline points="9,4 17,12 9,20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    rightArrow.onclick = () => {
      const next = currentIndex >= cycleCompanies.length - 1 ? 0 : currentIndex + 1;
      setFocusedCompanyId(cycleCompanies[next].id);
      setSavedFocusedCompanyId(cycleCompanies[next].id);
      rerender();
    };
    single.appendChild(rightArrow);
  }

  container.appendChild(single);
}

/** Render all companies (both players) at medium scale. */
export function renderAllCompaniesView(
  container: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const lastOnAction = getLastOnAction()!;
  const mergeSourceCompanyId = getMergeSourceCompanyId();
  const companyMoveSourceId = getCompanyMoveSourceId();
  const companyMoveSourceCompanyId = getCompanyMoveSourceCompanyId();

  const overview = document.createElement('div');
  overview.className = 'company-overview-all';
  const initialScale = 0.6;
  overview.style.setProperty('--company-scale', String(initialScale));

  // Check if we're in character-play targeting mode
  const selectedChar = getSelectedCharacterForPlay();
  const targetActions = selectedChar
    ? getPlayCharacterActions(view, selectedChar)
    : null;

  // Companies with legal movement available
  const movableIds = getMovableCompanyIds(view);

  // Move-to-influence actions (for highlighting characters)
  const influenceActions = getMoveToInfluenceActions(view);

  // Transfer-item and store-item actions (for highlighting transferable/storable items)
  const transferActions = getTransferItemActions(view);
  const storeItemActs = getStoreItemActions(view);

  // Split-company, move-to-company, and merge-companies actions
  const splitActions = getSplitCompanyActions(view);
  const moveToCompanyActs = getMoveToCompanyActions(view);
  const mergeActions = getMergeCompaniesActions(view);

  // Fetch-from-sideboard and corruption-check actions (for avatar / character clicks)
  const sideboardIntentActs = getSideboardIntentActions(view);
  const ccActions = getCorruptionCheckActions(view);
  const ccSupportActs = getSupportCorruptionCheckActions(view);
  const grantedActs = getGrantedActions(view);
  const bearerActs = getSelectCardBearerActions(view);

  // Select-company actions (M/H phase company selection)
  const selectCompanyActions = new Map<string, SelectCompanyAction>();
  for (const a of viableActions(view.legalActions)) {
    if (a.type === 'select-company') {
      selectCompanyActions.set(a.companyId as string, a);
    }
  }

  // Collect site instance IDs that already have companies
  const companySiteIds = new Set<string>();
  for (const company of view.self.companies) {
    if (company.currentSite) companySiteIds.add(company.currentSite.instanceId as string);
  }

  // Self companies
  for (const company of view.self.companies) {
    const hasLegalMovement = movableIds.has(company.id as string);
    const block = renderCompanyBlock(company, view.self.characters, view, cardPool, 'self', { hasLegalMovement, onAction: lastOnAction, influenceActions, transferActions, storeItemActions: storeItemActs, splitActions, moveToCompanyActions: moveToCompanyActs, mergeActions, sideboardIntentActions: sideboardIntentActs, corruptionCheckActions: ccActions, supportCorruptionCheckActions: ccSupportActs, grantedActions: grantedActs, selectCardBearerActions: bearerActs });

    if (selectCompanyActions.size > 0) {
      // M/H phase select-company step: highlight selectable companies
      const selectAction = selectCompanyActions.get(company.id as string);
      if (selectAction) {
        block.classList.add('company-block--target');
        block.onclick = (e) => {
          e.stopPropagation();
          lastOnAction(selectAction);
        };
      }
    } else if (mergeSourceCompanyId) {
      // Merge targeting mode: highlight valid target companies
      const mergeAction = viableActions(view.legalActions).find(
        a => a.type === 'merge-companies'
          && a.sourceCompanyId === mergeSourceCompanyId
          && a.targetCompanyId === company.id,
      ) as MergeCompaniesAction | undefined;
      if (mergeAction) {
        block.classList.add('company-block--target');
        block.onclick = (e) => {
          e.stopPropagation();
          setMergeSourceCompanyId(null);
          setTargetingInstruction(null);
          lastOnAction(mergeAction);
        };
      } else if (company.id === mergeSourceCompanyId) {
        // Source company — clicking cancels merge targeting
        block.classList.add('company-block--clickable');
        block.onclick = (e) => {
          e.stopPropagation();
          setMergeSourceCompanyId(null);
          setTargetingInstruction(null);
          rerender();
        };
      }
    } else if (companyMoveSourceId && companyMoveSourceCompanyId) {
      // Company-move targeting mode: highlight valid target companies
      const moveAction = viableActions(view.legalActions).find(
        a => a.type === 'move-to-company'
          && a.characterInstanceId === companyMoveSourceId
          && a.sourceCompanyId === companyMoveSourceCompanyId
          && a.targetCompanyId === company.id,
      ) as MoveToCompanyAction | undefined;
      if (moveAction) {
        block.classList.add('company-block--target');
        block.onclick = (e) => {
          e.stopPropagation();
          setCompanyMoveSourceId(null);
          setCompanyMoveSourceCompanyId(null);
          setTargetingInstruction(null);
          lastOnAction(moveAction);
        };
      }
    } else if (targetActions && company.currentSite && targetActions.has(company.currentSite.instanceId as string)) {
      // This company is a valid target for playing the selected character
      block.classList.add('company-block--target');
      const actions = targetActions.get(company.currentSite.instanceId as string)!;
      const targetCompanyId = company.id;
      block.onclick = () => {
        // For now, use the first action (GI preferred, DI options come later)
        clearCharacterPlaySelection();
        setFocusedCompanyId(targetCompanyId);
        setAllCompaniesOverride(false);
        lastOnAction(actions[0]);
      };
    }
    overview.appendChild(block);
  }

  // Dummy companies for site-deck sites with no existing company
  if (targetActions) {
    for (const [siteInstId, actions] of targetActions) {
      if (companySiteIds.has(siteInstId)) continue;
      const siteInstanceId = siteInstId as CardInstanceId;
      const block = renderDummyCompanyBlock(siteInstanceId, view, cardPool);
      block.classList.add('company-block--target');
      block.onclick = () => {
        // After the action resolves, the played character will be in a new
        // company at the chosen site — auto-focus on it so the player doesn't
        // have to find it in the overview.
        setPendingFocusCharacterId(actions[0].characterInstanceId);
        clearCharacterPlaySelection();
        setAllCompaniesOverride(false);
        lastOnAction(actions[0]);
      };
      overview.appendChild(block);
    }
  }

  // Opponent companies — add click handlers when opponent influence targeting is active
  const oppInfluencer = getSelectedInfluencerForOpponent();
  const oppInfluenceActions = oppInfluencer
    ? viableActions(view.legalActions).filter(
      (a): a is OpponentInfluenceAttemptAction =>
        a.type === 'opponent-influence-attempt' && a.influencingCharacterId === oppInfluencer,
    )
    : [];

  for (const company of view.opponent.companies) {
    const block = renderCompanyBlock(company, view.opponent.characters, view, cardPool, 'opponent');

    // When targeting, add click handlers to opponent cards
    if (oppInfluencer && oppInfluenceActions.length > 0 && lastOnAction) {
      addOpponentInfluenceTargets(block, oppInfluenceActions, lastOnAction);
    }

    overview.appendChild(block);
  }

  container.appendChild(overview);

  // Shrink companies to fit the viewport if they overflow vertically
  requestAnimationFrame(() => {
    let scale = initialScale;
    while (scale > 0.25 && document.documentElement.scrollHeight > window.innerHeight + 2) {
      scale = Math.max(0.25, Math.round((scale - 0.05) * 100) / 100);
      overview.style.setProperty('--company-scale', String(scale));
    }
  });
}

/**
 * Render a toggle icon on the right edge of the board.
 * In single view it shows a grid icon (switch to all-companies).
 * In all-companies view it shows a focus icon (return to the saved company).
 */
export function renderViewToggle(
  container: HTMLElement,
  showingSingle: boolean,
  _view: PlayerView,
  _cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const btn = document.createElement('button');
  btn.className = 'company-view-toggle';
  btn.title = showingSingle ? 'Show all companies' : 'Return to focused company';
  // Grid icon (4 squares) for "show all", crosshair for "focus on one"
  btn.innerHTML = showingSingle
    ? '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="1" fill="currentColor"/><rect x="3" y="13" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="13" width="8" height="8" rx="1" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="2" x2="12" y2="7" stroke="currentColor" stroke-width="2"/><line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" stroke-width="2"/><line x1="2" y1="12" x2="7" y2="12" stroke="currentColor" stroke-width="2"/><line x1="17" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2"/></svg>';

  btn.onclick = () => {
    if (showingSingle) {
      // Save current focus so we can restore it later
      setSavedFocusedCompanyId(getFocusedCompanyId());
      setAllCompaniesOverride(true);
    } else {
      // Restore the saved focused company
      setAllCompaniesOverride(false);
      const saved = getSavedFocusedCompanyId();
      if (saved) {
        setFocusedCompanyId(saved);
      }
    }
    rerender();
  };

  container.appendChild(btn);
}
