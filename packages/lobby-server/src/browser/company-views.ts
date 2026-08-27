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
  getDiscardItemFromCompanyActions,
  getSplitCompanyActions,
  getMoveToCompanyActions,
  getMergeCompaniesActions,
  getSideboardIntentActions,
  getCorruptionCheckActions,
  getSupportCorruptionCheckActions,
  getRestoreCharacterActions,
  getDeclareBurglaryActions,
  getGrantedActions,
  getPlayCharacterActions,
  getSelectCardBearerActions,
  getDiscardCharacterActions,
  getRevealAgentActions,
  getAgentMoveActions,
  getAgentOtherActions,
} from './company-actions.js';
import { renderAgentBlock, renderOpponentAgentBlock } from './company-agent.js';
import { addOpponentInfluenceTargets } from './company-modals.js';
import { setTargetingInstruction } from './render.js';
import { createRadar } from './map-radar.js';
import { openFullMap } from './map-fullscreen.js';
import { loadCoordinates, areCoordinatesLoaded } from './map-coordinates.js';
import { onMapModeChange } from './map-mode.js';

// Re-render the radar whenever the map mode changes (single subscription for the module lifetime).
onMapModeChange(() => rerender());

/** Remove the map radar widget from the DOM if it exists. */
export function removeMapRadar(): void {
  document.getElementById('map-radar-widget')?.remove();
}

/**
 * Shrink `--company-scale` on `el` (in 0.05 steps down to `minScale`) until
 * the page fits the viewport height. Companies with many characters would
 * otherwise wrap onto extra rows or run off the bottom of the screen at a
 * fixed scale — this keeps them fully visible instead.
 */
function shrinkToFitViewport(el: HTMLElement, initialScale: number, minScale = 0.23): void {
  requestAnimationFrame(() => {
    let scale = initialScale;
    while (scale > minScale && document.documentElement.scrollHeight > window.innerHeight + 2) {
      scale = Math.max(minScale, Math.round((scale - 0.05) * 100) / 100);
      el.style.setProperty('--company-scale', String(scale));
    }
  });
}

/**
 * Decide which side's companies the left/right navigation arrows cycle
 * through in single-company view: whichever side the focused company
 * actually belongs to, not whichever side's turn it currently is.
 *
 * On the opponent's turn we're the hazard player and may focus one of our
 * own companies (e.g. by clicking it in the forced all-companies overview);
 * cycling must stay within our own companies rather than switching to the
 * opponent's list, which can be shorter (or length 1) and silently hide the
 * arrows.
 *
 * Exported for unit testing (pure — no DOM access).
 */
export function getCycleCompanies(
  owner: 'self' | 'opponent',
  selfCompanies: readonly Company[],
  opponentCompanies: readonly OpponentCompanyView[],
): readonly (Company | OpponentCompanyView)[] {
  return owner === 'self' ? selfCompanies : opponentCompanies;
}

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
  const cycleCompanies = getCycleCompanies(owner, view.self.companies, view.opponent.companies);
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
  const discardItemFromCompanyActs = owner === 'self' ? getDiscardItemFromCompanyActions(view) : undefined;
  const splitActions = owner === 'self' ? getSplitCompanyActions(view) : undefined;
  const moveToCompanyActs = owner === 'self' ? getMoveToCompanyActions(view) : undefined;
  const mergeActions = owner === 'self' ? getMergeCompaniesActions(view) : undefined;
  const sideboardIntentActs = owner === 'self' ? getSideboardIntentActions(view) : undefined;
  const ccActions = owner === 'self' ? getCorruptionCheckActions(view) : undefined;
  const ccSupportActs = owner === 'self' ? getSupportCorruptionCheckActions(view) : undefined;
  const restoreActs = owner === 'self' ? getRestoreCharacterActions(view) : undefined;
  const burglaryActs = owner === 'self' ? getDeclareBurglaryActions(view) : undefined;
  const grantedActs = owner === 'self' ? getGrantedActions(view) : undefined;
  const bearerActs = owner === 'self' ? getSelectCardBearerActions(view) : undefined;
  const discardActs = owner === 'self' ? getDiscardCharacterActions(view) : undefined;
  single.appendChild(renderCompanyBlock(company, charMap, view, cardPool, owner, { hideTitle: true, singleView: true, hasLegalMovement, onAction: lastOnAction, influenceActions, transferActions, storeItemActions: storeItemActs, discardItemFromCompanyActions: discardItemFromCompanyActs, splitActions, moveToCompanyActions: moveToCompanyActs, mergeActions, sideboardIntentActions: sideboardIntentActs, corruptionCheckActions: ccActions, supportCorruptionCheckActions: ccSupportActs, restoreCharacterActions: restoreActs, declareBurglaryActions: burglaryActs, grantedActions: grantedActs, selectCardBearerActions: bearerActs, discardCharacterActions: discardActs }));

  // Minimap radar — always shown.
  const radarSelfIndex = owner === 'self'
    ? view.self.companies.findIndex(c => c.id === focusedCompanyId)
    : -1;
  const radarOpponentIndex = owner === 'opponent'
    ? view.opponent.companies.findIndex(c => c.id === focusedCompanyId)
    : undefined;
  const attachRadar = (): void => {
    const radar = createRadar(view, radarSelfIndex, cardPool, radarOpponentIndex);
    if (radar) {
      single.appendChild(radar);
      radar.addEventListener('map-radar-click', () => {
        openFullMap(view, radarSelfIndex, cardPool, (idx) => {
          setFocusedCompanyId(view.self.companies[idx]?.id ?? null);
          setSavedFocusedCompanyId(view.self.companies[idx]?.id ?? null);
          rerender();
        });
      });
    }
  };
  if (areCoordinatesLoaded()) {
    attachRadar();
  } else {
    void loadCoordinates().then(() => rerender()).catch(() => {});
  }

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

  // Shrink to fit if a large company (e.g. 6+ characters) wraps onto extra
  // rows and runs off the bottom of the screen at full scale.
  shrinkToFitViewport(single, 1);
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
  // `--card-table-height` was bumped up (22vh -> 24vh) so the single-company
  // view reads more easily on a normal laptop; this initial scale is lowered
  // by the same ratio (0.6 * 22/24) so the all-companies overview — already
  // the tighter, more crowded layout — keeps its previous effective card size
  // instead of getting proportionally larger too.
  const initialScale = 0.55;
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
  const discardItemFromCompanyActs = getDiscardItemFromCompanyActions(view);

  // Split-company, move-to-company, and merge-companies actions
  const splitActions = getSplitCompanyActions(view);
  const moveToCompanyActs = getMoveToCompanyActions(view);
  const mergeActions = getMergeCompaniesActions(view);

  // Fetch-from-sideboard and corruption-check actions (for avatar / character clicks)
  const sideboardIntentActs = getSideboardIntentActions(view);
  const ccActions = getCorruptionCheckActions(view);
  const ccSupportActs = getSupportCorruptionCheckActions(view);
  const restoreActs = getRestoreCharacterActions(view);
  const burglaryActs = getDeclareBurglaryActions(view);
  const grantedActs = getGrantedActions(view);
  const bearerActs = getSelectCardBearerActions(view);
  const discardActs = getDiscardCharacterActions(view);

  // Select-company actions (M/H phase company selection — also targets agents)
  const selectCompanyActions = new Map<string, SelectCompanyAction>();
  for (const a of viableActions(view.legalActions)) {
    if (a.type === 'select-company') {
      selectCompanyActions.set(a.companyId as string, a);
    }
  }

  // Agent action maps for self agents
  const revealAgentActs = getRevealAgentActions(view);
  const agentMoveActs = getAgentMoveActions(view);
  const agentOtherActs = getAgentOtherActions(view);

  // Collect site instance IDs that already have companies
  const companySiteIds = new Set<string>();
  for (const company of view.self.companies) {
    if (company.currentSite) companySiteIds.add(company.currentSite.instanceId as string);
  }

  // Sibling companies at the same location share one site card instance (the
  // engine draws it once). Track the site ids emitted this pass so repeat
  // occurrences get a company-scoped `data-instance-id` and the shared site
  // cards keep a stable FLIP identity instead of jumping between company slots.
  const renderedSiteInstances = new Set<string>();

  // Self companies
  for (const company of view.self.companies) {
    const hasLegalMovement = movableIds.has(company.id as string);
    const block = renderCompanyBlock(company, view.self.characters, view, cardPool, 'self', { hasLegalMovement, onAction: lastOnAction, influenceActions, transferActions, storeItemActions: storeItemActs, discardItemFromCompanyActions: discardItemFromCompanyActs, splitActions, moveToCompanyActions: moveToCompanyActs, mergeActions, sideboardIntentActions: sideboardIntentActs, corruptionCheckActions: ccActions, supportCorruptionCheckActions: ccSupportActs, restoreCharacterActions: restoreActs, declareBurglaryActions: burglaryActs, grantedActions: grantedActs, selectCardBearerActions: bearerActs, discardCharacterActions: discardActs, renderedSiteInstances });

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
    } else {
      // Default: clicking a self company focuses it in single-company view
      const focusId = company.id;
      block.classList.add('company-block--clickable');
      block.onclick = (e) => {
        e.stopPropagation();
        setFocusedCompanyId(focusId);
        setAllCompaniesOverride(false);
        rerender();
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

  // Self agents — rendered as one-character virtual company blocks
  for (const agent of view.self.agents) {
    const selectAction = selectCompanyActions.get(agent.id as string);
    const block = renderAgentBlock(agent, view, cardPool, lastOnAction, {
      revealActions: revealAgentActs.get(agent.id as string),
      moveActions: agentMoveActs.get(agent.id as string),
      otherActions: agentOtherActs.get(agent.id as string),
      selectAction,
    });
    overview.appendChild(block);
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
    const block = renderCompanyBlock(company, view.opponent.characters, view, cardPool, 'opponent', { onAction: lastOnAction, renderedSiteInstances });

    // When targeting, add click handlers to opponent cards
    if (oppInfluencer && oppInfluenceActions.length > 0 && lastOnAction) {
      addOpponentInfluenceTargets(block, oppInfluenceActions, lastOnAction);
    }

    // Default: clicking an opponent company (background, not a targeted card)
    // focuses it in single-company view — mirrors the self-company handler
    // above. Without this, the hazard player has no way to bring an opponent
    // company into single view (and its nav arrows) once the initial
    // auto-focus lands elsewhere.
    const focusId = company.id;
    block.classList.add('company-block--clickable');
    block.onclick = (e) => {
      e.stopPropagation();
      setFocusedCompanyId(focusId);
      setAllCompaniesOverride(false);
      rerender();
    };

    overview.appendChild(block);
  }

  // Opponent agents — display-only (resource player cannot act on them)
  for (const agent of view.opponent.agents) {
    overview.appendChild(renderOpponentAgentBlock(agent, view, cardPool));
  }

  container.appendChild(overview);

  // Radar in all-companies view — no company is "active", no opponent highlighted
  const attachAllRadar = (): void => {
    const radar = createRadar(view, -1, cardPool);
    if (radar) {
      container.appendChild(radar);
      radar.addEventListener('map-radar-click', () => {
        openFullMap(view, 0, cardPool, (idx) => {
          setFocusedCompanyId(view.self.companies[idx]?.id ?? null);
          setSavedFocusedCompanyId(view.self.companies[idx]?.id ?? null);
          setAllCompaniesOverride(false);
          rerender();
        });
      });
    }
  };
  if (areCoordinatesLoaded()) {
    attachAllRadar();
  } else {
    void loadCoordinates().then(() => rerender()).catch(() => {});
  }

  // Shrink companies to fit the viewport if they overflow vertically
  shrinkToFitViewport(overview, initialScale);
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
  inCombat = false,
): void {
  const btn = document.createElement('button');
  // Stable id: the guided tutorial's 'view-toggle' pointer anchor attaches here.
  btn.id = 'company-view-toggle';

  if (inCombat) {
    // In all-companies view during combat: red sword icon returns to combat view
    btn.className = 'company-view-toggle company-view-toggle--battle';
    btn.title = 'Return to battle';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="7" y1="7" x2="11" y2="11"/></svg>';
    btn.onclick = () => {
      setAllCompaniesOverride(false);
      rerender();
    };
  } else {
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
  }

  container.appendChild(btn);
}
