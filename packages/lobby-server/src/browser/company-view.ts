/**
 * @module company-view
 *
 * Renders companies on the board during play phases (post-setup) and Free Council.
 * Defaults to showing the active player's first company at full scale.
 * Falls back to an all-companies overview when no company is focused.
 *
 * This is the entry point that orchestrates sub-modules:
 * - company-view-state: mutable view state and cached render args
 * - company-actions: legal action collection helpers
 * - company-site: site area rendering and path region types
 * - company-modals: tooltips, sideboard, exchange, opponent influence menus
 * - company-character: character column rendering
 * - company-block: company block rendering with click handler builders
 * - company-views: single/all view modes and toggle button
 */

import type {
  PlayerView,
  GameAction,
  CardDefinition,
} from '@meccg/shared';
import { Phase, viableActions, buildInstanceLookup, isCharacterCard } from '@meccg/shared';
import { $ } from './render-utils.js';
import { setTargetingInstruction } from './render.js';
import { renderCombatView, clearCombatButtons } from './combat-view.js';
import {
  getFocusedCompanyId, setFocusedCompanyId,
  getAllCompaniesOverride, setAllCompaniesOverride,
  getPendingFocusCharacterId, setPendingFocusCharacterId,
  getInfluenceMoveSourceId, setInfluenceMoveSourceId,
  getTransferItemSourceId, setTransferItemSourceId,
  setTransferItemFromCharId,
  getCompanyMoveSourceId, setCompanyMoveSourceId,
  setCompanyMoveSourceCompanyId,
  getMergeSourceCompanyId, setMergeSourceCompanyId,
  getLastActivePlayer, setLastActivePlayer,
  getLastMhSiteStep, setLastMhSiteStep,
  setLastOnAction, setLastView, setLastCardPool,
  setCachedInstanceLookup,
  getCachedInstanceLookup,
  setRerenderFn,
  resetState,
} from './company-view-state.js';
import { renderCardsInPlayRow } from './company-block.js';
import { renderSingleView, renderAllCompaniesView, renderViewToggle } from './company-views.js';
import { dismissTooltip, openSideboardForFetch, dismissSideboardModal, openExchangeModal, dismissExchangeModal } from './company-modals.js';

/**
 * Render a situation banner when a pending corruption check is active
 * (e.g. after transferring an item during Organization). Shows the
 * character name, check details, and the explanation breakdown.
 */
function renderCorruptionCheckBanner(
  board: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const ccEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'corruption-check');
  if (!ccEval || ccEval.action.type !== 'corruption-check') return;

  const action = ccEval.action;
  const cachedInstanceLookup = getCachedInstanceLookup();
  const defId = cachedInstanceLookup(action.characterId);
  const def = defId ? cardPool[defId as string] : undefined;
  const charName = def && isCharacterCard(def) ? def.name : '?';

  const row = document.createElement('div');
  row.className = 'situation-banner-row';

  const banner = document.createElement('div');
  banner.className = 'situation-banner';
  banner.textContent = `Corruption Check \u2014 ${charName}`;

  const detail = document.createElement('div');
  detail.className = 'situation-banner-detail';
  detail.textContent = action.explanation;
  banner.appendChild(detail);

  row.appendChild(banner);
  board.appendChild(row);
}

/**
 * Render a situation banner when a faction influence roll is pending.
 * Mirrors {@link renderCorruptionCheckBanner}: title line names the
 * influencing character and target faction; detail line shows the full
 * roll breakdown (target number, DI, and any modifiers).
 */
function renderFactionInfluenceRollBanner(
  board: HTMLElement,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): void {
  const fiEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'faction-influence-roll');
  if (!fiEval || fiEval.action.type !== 'faction-influence-roll') return;

  const action = fiEval.action;
  const cachedInstanceLookup = getCachedInstanceLookup();

  const charDefId = cachedInstanceLookup(action.influencingCharacterId);
  const charDef = charDefId ? cardPool[charDefId as string] : undefined;
  const charName = charDef && isCharacterCard(charDef) ? charDef.name : '?';

  const factionDefId = cachedInstanceLookup(action.factionInstanceId);
  const factionDef = factionDefId ? cardPool[factionDefId as string] : undefined;
  const factionName = factionDef?.name ?? '?';

  const row = document.createElement('div');
  row.className = 'situation-banner-row';

  const banner = document.createElement('div');
  banner.className = 'situation-banner';
  banner.textContent = `Faction Influence \u2014 ${charName} influencing ${factionName}`;

  const detail = document.createElement('div');
  detail.className = 'situation-banner-detail';
  detail.textContent = action.explanation;
  banner.appendChild(detail);

  row.appendChild(banner);
  board.appendChild(row);
}

/**
 * Render a situation banner when the defender must roll for an opponent
 * influence attempt. Shows the influencing character, target, attacker
 * roll, and all modifier breakdowns so the defender knows the situation
 * before committing to their roll.
 */
function renderOpponentInfluenceDefendBanner(
  board: HTMLElement,
  view: PlayerView,
): void {
  const oiEval = view.legalActions.find(ea => ea.viable && ea.action.type === 'opponent-influence-defend');
  if (!oiEval || oiEval.action.type !== 'opponent-influence-defend') return;

  const action = oiEval.action;

  const row = document.createElement('div');
  row.className = 'situation-banner-row';

  const banner = document.createElement('div');
  banner.className = 'situation-banner';
  banner.textContent = 'Opponent Influence \u2014 Defend';

  const detail = document.createElement('div');
  detail.className = 'situation-banner-detail';
  detail.textContent = action.explanation;
  banner.appendChild(detail);

  row.appendChild(banner);
  board.appendChild(row);
}

/** Phases where company views are displayed (normal play and Free Council). */
const COMPANY_VIEW_PHASES = new Set([
  Phase.Untap,
  Phase.Organization,
  Phase.LongEvent,
  Phase.MovementHazard,
  Phase.Site,
  Phase.EndOfTurn,
  Phase.FreeCouncil,
]);

/** Install keyboard listener for left/right arrow navigation. */
let keyboardNavInstalled = false;
function installKeyboardNav(): void {
  if (keyboardNavInstalled) return;
  keyboardNavInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const cls = e.key === 'ArrowLeft' ? 'company-nav-arrow--left' : 'company-nav-arrow--right';
    const arrow: HTMLButtonElement | null = document.querySelector(`.${cls}`);
    if (!arrow) return;
    e.preventDefault();
    arrow.classList.add('btn--flash');
    arrow.click();
    // The click triggers a re-render which replaces the element, so the flash
    // class is applied to the new arrow after re-render via a short timeout.
    requestAnimationFrame(() => {
      const newArrow = document.querySelector(`.${cls}`);
      if (newArrow) {
        newArrow.classList.add('btn--flash');
        setTimeout(() => newArrow.classList.remove('btn--flash'), 300);
      }
    });
  });
}

/** Switch to all-companies overview, saving the current focus for later restore. */
export function switchToAllCompanies(): void {
  if (!getAllCompaniesOverride() && getFocusedCompanyId()) {
    // Save is done by the caller or view toggle; just set the override
  }
  setAllCompaniesOverride(true);
}

/** Reset all company view state. Call when leaving the game screen. */
export function resetCompanyViews(): void {
  resetState();
  dismissTooltip();
  setTargetingInstruction(null);
  document.body.classList.remove('all-companies-mode');
}

/**
 * Render company views in the visual board area.
 * Active during normal play phases (untap through end-of-turn) and Free Council.
 * No-op during setup and game-over phases.
 */
export function renderCompanyViews(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  if (!COMPANY_VIEW_PHASES.has(view.phaseState.phase)) return;

  setLastOnAction(onAction);
  setLastView(view);
  setLastCardPool(cardPool);
  setCachedInstanceLookup(buildInstanceLookup(view));
  setRerenderFn(() => renderCompanyViews(view, cardPool, onAction));
  installKeyboardNav();

  // Reset view state on active player change
  const activeId = view.activePlayer as string | null;
  const lastActivePlayer = getLastActivePlayer();
  if (activeId !== lastActivePlayer) {
    // Auto-switch to all-companies view when opponent's turn starts;
    // reset to single-company view when own turn starts.
    if (activeId !== null && activeId !== (view.self.id as string)) {
      setAllCompaniesOverride(true);
      setFocusedCompanyId(null);
    } else {
      setAllCompaniesOverride(false);
      setFocusedCompanyId(null);
    }
    setLastActivePlayer(activeId);
  }

  // Auto-focus on the active company after one is selected for M/H or Site phase
  const curPhase = view.phaseState.phase;
  const curStep = (curPhase === Phase.MovementHazard || curPhase === Phase.Site)
    ? view.phaseState.step : null;
  const lastMhSiteStep = getLastMhSiteStep();
  if (lastMhSiteStep === 'select-company' && curStep !== null && curStep !== 'select-company') {
    const isSelfTurn = activeId !== null && activeId === (view.self.id as string);
    const companies = isSelfTurn ? view.self.companies : view.opponent.companies;
    const activeIdx = (view.phaseState as { activeCompanyIndex: number }).activeCompanyIndex;
    if (companies[activeIdx]) {
      setFocusedCompanyId(companies[activeIdx].id);
      setAllCompaniesOverride(false);
    }
  }
  setLastMhSiteStep(curStep);

  // After an action that creates a new company (split-company, play-character
  // at a new site), focus on the new company containing the target character.
  const pendingFocusCharacterId = getPendingFocusCharacterId();
  if (pendingFocusCharacterId) {
    setPendingFocusCharacterId(null);
    const newCompany = view.self.companies.find(
      c => c.characters.includes(pendingFocusCharacterId),
    );
    if (newCompany) {
      setFocusedCompanyId(newCompany.id);
      setAllCompaniesOverride(false);
    }
  }

  // Clear influence move selection if the source character no longer has valid actions
  const influenceMoveSourceId = getInfluenceMoveSourceId();
  if (influenceMoveSourceId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'move-to-influence' && a.characterInstanceId === influenceMoveSourceId,
    );
    if (!stillValid) {
      setInfluenceMoveSourceId(null);
      setTargetingInstruction(null);
    }
  }

  // Clear transfer item selection if the source item no longer has valid actions
  const transferItemSourceId = getTransferItemSourceId();
  if (transferItemSourceId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'transfer-item' && a.itemInstanceId === transferItemSourceId,
    );
    if (!stillValid) {
      setTransferItemSourceId(null);
      setTransferItemFromCharId(null);
      setTargetingInstruction(null);
    }
  }

  // Clear company-move selection if the source character no longer has valid actions
  const companyMoveSourceId = getCompanyMoveSourceId();
  if (companyMoveSourceId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'move-to-company' && a.characterInstanceId === companyMoveSourceId,
    );
    if (!stillValid) {
      setCompanyMoveSourceId(null);
      setCompanyMoveSourceCompanyId(null);
      setTargetingInstruction(null);
    }
  }

  // Clear merge selection if the source company no longer has valid merge actions
  const mergeSourceCompanyId = getMergeSourceCompanyId();
  if (mergeSourceCompanyId) {
    const stillValid = viableActions(view.legalActions).some(
      a => a.type === 'merge-companies' && a.sourceCompanyId === mergeSourceCompanyId,
    );
    if (!stillValid) {
      setMergeSourceCompanyId(null);
      setTargetingInstruction(null);
    }
  }

  // Validate focused company still exists
  let focusedCompanyId = getFocusedCompanyId();
  if (focusedCompanyId) {
    const exists =
      view.self.companies.some(c => c.id === focusedCompanyId) ||
      view.opponent.companies.some(c => c.id === focusedCompanyId);
    if (!exists) {
      setFocusedCompanyId(null);
      focusedCompanyId = null;
    }
  }

  // Auto-focus on the company containing a character with a pending corruption check
  const ccAction = view.legalActions.find(
    ea => ea.viable && ea.action.type === 'corruption-check',
  );
  if (ccAction && ccAction.action.type === 'corruption-check') {
    const { characterId } = ccAction.action;
    const ccCompany = view.self.companies.find(
      c => c.characters.includes(characterId),
    );
    if (ccCompany && ccCompany.id !== focusedCompanyId) {
      setFocusedCompanyId(ccCompany.id);
      focusedCompanyId = ccCompany.id;
      setAllCompaniesOverride(false);
    }
  }

  // Auto-focus the active player's first company when entering play phases
  if (!focusedCompanyId && view.activePlayer !== null) {
    const isSelfTurn = view.activePlayer === view.self.id;
    const activeCompanies = isSelfTurn ? view.self.companies : view.opponent.companies;
    if (activeCompanies.length > 0) {
      setFocusedCompanyId(activeCompanies[0].id);
      focusedCompanyId = activeCompanies[0].id;
    }
  }

  // Force all-companies view during select-company step so the player can
  // see every company and pick one, and during Free Council so all companies
  // are visible for corruption checks.
  const inSelectCompany =
    (view.phaseState.phase === Phase.MovementHazard || view.phaseState.phase === Phase.Site)
    && view.phaseState.step === 'select-company';
  const inFreeCouncil = view.phaseState.phase === Phase.FreeCouncil;

  const board = $('visual-board');
  board.innerHTML = '';

  // Combat view takes over entirely when combat is active
  if (view.combat) {
    renderCombatView(board, view, cardPool, onAction);
    return;
  }

  // Clean up any leftover combat buttons when combat ends
  clearCombatButtons();

  // Cards in play row (permanent resources, factions, etc.) — always at top
  renderCardsInPlayRow(board, view, cardPool, onAction);

  // Pending corruption check banner (transfer / wound / Lure during Organization)
  renderCorruptionCheckBanner(board, view, cardPool);

  // Pending faction influence roll banner (chain paused awaiting the roll)
  renderFactionInfluenceRollBanner(board, view, cardPool);

  // Pending opponent influence defend banner (defender must roll)
  renderOpponentInfluenceDefendBanner(board, view);

  const showingSingle = focusedCompanyId !== null && !getAllCompaniesOverride() && !inSelectCompany && !inFreeCouncil;

  // In all-companies view, hide hand arcs, text log, and score boxes to maximise
  // screen real estate for the company grid.
  document.body.classList.toggle('all-companies-mode', !showingSingle);

  if (showingSingle) {
    renderSingleView(board, view, cardPool);
  } else {
    renderAllCompaniesView(board, view, cardPool);
  }

  // During Free Council, highlight characters with available corruption check
  // or support actions (clickable) and mark already-checked characters
  if (inFreeCouncil) {
    const ccActions = new Map<string, GameAction>();
    const ccSupportActions = new Map<string, GameAction>();
    for (const a of viableActions(view.legalActions)) {
      if (a.type === 'corruption-check') {
        ccActions.set(a.characterId as string, a);
      } else if (a.type === 'support-corruption-check') {
        ccSupportActions.set(a.supportingCharacterId as string, a);
      }
    }
    const checkedSet = new Set(view.phaseState.checkedCharacters);
    for (const col of board.querySelectorAll<HTMLElement>('.character-column[data-instance-id]')) {
      const instId = col.dataset.instanceId!;
      const ccAction = ccActions.get(instId);
      const supportAction = ccSupportActions.get(instId);
      if (ccAction) {
        col.classList.add('cc-pending');
        col.style.cursor = 'pointer';
        col.onclick = (e) => {
          e.stopPropagation();
          onAction(ccAction);
        };
      } else if (supportAction) {
        col.classList.add('cc-pending');
        col.style.cursor = 'pointer';
        col.onclick = (e) => {
          e.stopPropagation();
          onAction(supportAction);
        };
      } else if (checkedSet.has(instId)) {
        const mark = document.createElement('div');
        mark.className = 'cc-passed-mark';
        mark.textContent = '\u2713';
        const wrap = col.querySelector('.character-card-wrap');
        if (wrap) wrap.appendChild(mark);
      }
    }
  }

  // Toggle icon on the right edge of the board
  renderViewToggle(board, showingSingle, view, cardPool);

  // Auto-open sideboard browser when in a sideboard sub-flow (org or untap hazard)
  const viable = viableActions(view.legalActions);
  const exchangeActions = viable.filter(a => a.type === 'exchange-sideboard');
  const fetchActions = viable.filter(a => a.type === 'fetch-from-sideboard' || a.type === 'fetch-hazard-from-sideboard');
  if (exchangeActions.length > 0) {
    const passAction = viable.find(a => a.type === 'pass') ?? null;
    openExchangeModal(exchangeActions, passAction, cardPool, onAction);
  } else if (fetchActions.length > 0) {
    const passAction = viable.find(a => a.type === 'pass') ?? null;
    openSideboardForFetch(fetchActions, passAction, cardPool, onAction);
  } else {
    dismissSideboardModal();
    dismissExchangeModal();
  }
}
