/**
 * @module company-view-state
 *
 * Mutable view state for company rendering. Stores the focused company,
 * two-step selection states (influence, transfer, merge, company-move),
 * cached render arguments, and the instance lookup cache.
 *
 * Other company-view modules import getters/setters from here to read
 * and update shared state without circular dependencies.
 */

import type {
  PlayerView,
  GameAction,
  CardDefinition,
  CardInstanceId,
  CompanyId,
  EvaluatedAction,
} from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';
import { Phase } from '@meccg/shared';

// ---- View focus state ----

/** The company currently focused in single-company view, or null for all-companies overview. */
let focusedCompanyId: CompanyId | null = null;

/**
 * Saved company ID to return to when toggling back from all-companies view.
 * Set whenever we leave single view so the toggle can restore it.
 */
let savedFocusedCompanyId: CompanyId | null = null;

/** Whether we are currently showing all-companies as an override (toggle). */
let allCompaniesOverride = false;

/**
 * After an action that creates a new company (e.g. split-company, or
 * play-character at a site that has no existing company), stores the
 * character ID placed into the new company. On the next render, the view
 * auto-focuses on the company containing this character.
 */
let pendingFocusCharacterId: CardInstanceId | null = null;

// ---- Two-step selection states ----

/**
 * Move-to-influence two-step selection state.
 * When a character with move-to-influence options is clicked, its instance ID
 * is stored here and valid controller targets are highlighted.
 */
let influenceMoveSourceId: CardInstanceId | null = null;

/**
 * Transfer-item two-step selection state.
 * When an item card is clicked, its instance ID and bearer are stored here.
 * Valid target characters are then highlighted for the second click.
 */
let transferItemSourceId: CardInstanceId | null = null;
let transferItemFromCharId: CardInstanceId | null = null;

/**
 * Move-to-company two-step selection state.
 * When a character is chosen for "move to company", their instance ID and
 * source company are stored here. Target companies are then highlighted.
 */
let companyMoveSourceId: CardInstanceId | null = null;
let companyMoveSourceCompanyId: CompanyId | null = null;

/**
 * Merge-companies two-step selection state.
 * When a title character is chosen for "join company", the source company ID
 * is stored here. Target companies at the same site are then highlighted.
 */
let mergeSourceCompanyId: CompanyId | null = null;

// ---- Turn tracking ----

/**
 * Decide whether a turn change to `activeId` should switch the local player
 * into the all-companies overview.
 *
 * During normal play we switch to the overview when it becomes the opponent's
 * turn and return to single-company view on our own turn. The one exception is
 * the very start of the game (`lastActivePlayer === null`): if the opponent has
 * the first turn we keep the all-companies override off so the downstream
 * auto-focus lands on the opponent's starting company in single-company view,
 * rather than dropping the player into the overview before any play has begun.
 *
 * @param activeId - The active player ID after the turn change (null if none).
 * @param lastActivePlayer - The previously tracked active player (null at game start).
 * @param selfId - The local player's ID.
 * @returns True if the all-companies overview should be forced on.
 */
export function shouldOverrideToAllCompanies(
  activeId: string | null,
  lastActivePlayer: string | null,
  selfId: string,
): boolean {
  const isGameStart = lastActivePlayer === null;
  const opponentTurn = activeId !== null && activeId !== selfId;
  return opponentTurn && !isGameStart;
}

/**
 * Decide whether a select-company → next-step transition (M/H or Site phase)
 * should auto-focus the just-selected company into single-company view.
 *
 * This only applies on our own turn: when the active player picks one of
 * their own companies to resolve next, narrowing to that single company is
 * a convenience. On the opponent's turn, we are the hazard player and must
 * stay in the all-companies overview (forced on by {@link
 * shouldOverrideToAllCompanies} for the whole opponent turn) — that overview
 * is the only place our own agents are rendered (see company-agent.ts), so
 * forcing single-company view here would silently drop a just-played agent
 * hazard off the screen until the player manually toggles the view.
 *
 * @param lastMhSiteStep - The M/H or Site phase step from the previous render.
 * @param curStep - The M/H or Site phase step for the current render.
 * @param activeId - The active player ID for the current render (null if none).
 * @param selfId - The local player's ID.
 * @returns True if the local player should be focused onto their active company.
 */
export function shouldFocusOwnCompanyAfterSelectCompany(
  lastMhSiteStep: string | null,
  curStep: string | null,
  activeId: string | null,
  selfId: string,
): boolean {
  const justResolvedSelectCompany = lastMhSiteStep === 'select-company' && curStep !== null && curStep !== 'select-company';
  const isSelfTurn = activeId !== null && activeId === selfId;
  return justResolvedSelectCompany && isSelfTurn;
}

/**
 * Decide whether a focused opponent company should be dropped back to the
 * all-companies overview because the M/H or Site phase has moved on to a
 * different company.
 *
 * On the opponent's turn we are the hazard player; clicking an opponent
 * company block (see company-views.ts) focuses it into single-company view
 * so we can play hazards against it or watch its site resolution — but
 * nothing was clearing that focus once its company's turn actually ended.
 * `activeCompanyIndex` (see MovementHazardPhaseState / SitePhaseState) tells
 * us which company is currently resolving; when it changes while we are
 * still focused on the company that was *previously* active, that view is
 * now stale — its buttons no longer correspond to a legal action — so we
 * fall back to the overview rather than leaving the player stuck looking at
 * a dead single-company view (see {@link shouldFocusOwnCompanyAfterSelectCompany}
 * for why we don't instead auto-focus the new active company: that would
 * hide self.agents for the rest of the opponent's turn).
 *
 * This only fires on the transition edge (index actually changed between
 * renders), not on every render, so manually browsing a non-active opponent
 * company afterward is not immediately undone.
 *
 * @param isFocusedOnOpponentCompany - Whether the currently focused company
 *   (if any) belongs to the opponent (the side whose companies are advancing).
 * @param lastActiveCompanyIndex - The opponent-turn M/H or Site
 *   `activeCompanyIndex` from the previous render (null outside those
 *   phases or on our own turn).
 * @param curActiveCompanyIndex - The same value for the current render.
 * @param activeId - The active player ID for the current render (null if none).
 * @param selfId - The local player's ID.
 * @returns True if the focus should be reset to the all-companies overview.
 */
export function shouldResetFocusOnOpponentCompanyAdvance(
  isFocusedOnOpponentCompany: boolean,
  lastActiveCompanyIndex: number | null,
  curActiveCompanyIndex: number | null,
  activeId: string | null,
  selfId: string,
): boolean {
  const opponentTurn = activeId !== null && activeId !== selfId;
  const advanced = lastActiveCompanyIndex !== null && curActiveCompanyIndex !== null
    && lastActiveCompanyIndex !== curActiveCompanyIndex;
  return opponentTurn && advanced && isFocusedOnOpponentCompany;
}

/**
 * Decide whether the start of a new combat should clear an all-companies
 * override that was auto-forced on for the opponent's turn (by {@link
 * shouldOverrideToAllCompanies}).
 *
 * Without this, a hazard-triggered strike or body-check arising during the
 * opponent's movement/hazard phase would stay hidden behind the overview —
 * which also hides the local player's hand via CSS — because the override
 * takes precedence over the combat view for as long as it is set. Clearing
 * it only on the *start* of a new combat (as opposed to every re-render
 * while combat is ongoing) preserves a manual toggle back to the overview
 * that the player takes once the combat view is already showing.
 *
 * @param combatActive - Whether combat is active in the current render.
 * @param lastCombatActive - Whether combat was active in the previous render.
 * @returns True if the all-companies override should be cleared.
 */
export function shouldClearOverrideForNewCombat(
  combatActive: boolean,
  lastCombatActive: boolean,
): boolean {
  return combatActive && !lastCombatActive;
}

/**
 * Decide whether the end of a combat should restore the all-companies
 * override that {@link shouldOverrideToAllCompanies} forces on for the whole
 * opponent turn.
 *
 * {@link shouldClearOverrideForNewCombat} clears the override the moment a
 * combat starts so the combat view can take over, but nothing turns it back
 * on once that combat resolves. If the combat happened mid-opponent-turn
 * (e.g. an automatic attack at a site), the render is then stuck in
 * single-company view — focused on whichever company was in combat — for
 * the rest of the opponent's turn, hiding the local player's other
 * companies and any agent hazards until they manually toggle back to the
 * overview.
 *
 * @param combatActive - Whether combat is active in the current render.
 * @param lastCombatActive - Whether combat was active in the previous render.
 * @param activeId - The active player ID for the current render (null if none).
 * @param selfId - The local player's ID.
 * @returns True if the all-companies override should be restored.
 */
export function shouldRestoreOverrideAfterCombat(
  combatActive: boolean,
  lastCombatActive: boolean,
  activeId: string | null,
  selfId: string,
): boolean {
  const combatJustEnded = !combatActive && lastCombatActive;
  const opponentTurn = activeId !== null && activeId !== selfId;
  return combatJustEnded && opponentTurn;
}

/**
 * Decide whether the combat arena view should stay hidden in favor of the
 * normal company view because a pending corruption check blocks combat from
 * actually proceeding (e.g. Corpse-candle tw-23/le-67: "every character in
 * the company makes a corruption check before defending characters are
 * selected"). The engine sets `combat.phase` to 'assign-strikes' before
 * those pre-defense checks resolve, so `view.combat` is already non-null —
 * but the corruption-check banner, the per-character tap-in-support buttons
 * (CoE 7.1.1), and reactive short-event plays (e.g. A Friend or Three) only
 * render in the company view, not the combat arena, so switching to combat
 * early hides the controls the defending player needs to resolve the check.
 *
 * @param legalActions - The viewing player's legal actions for this render.
 * @returns True if a viable corruption-check or support-corruption-check
 *   action is pending, meaning the company view should keep rendering.
 */
export function isCombatBlockedByPendingCorruptionCheck(
  legalActions: readonly EvaluatedAction[],
): boolean {
  return legalActions.some(ea =>
    ea.viable && (ea.action.type === 'corruption-check' || ea.action.type === 'support-corruption-check'));
}

/**
 * Decide whether the hand-arc must stay visible despite the all-companies
 * overview being forced on. CoE 10.3.i lets either player play reactive
 * resource/character actions from hand (e.g. A Friend or Three's
 * corruption-check-boost) while a Free Council corruption check is pending,
 * and the all-companies overview is forced on for the *entire* Free Council
 * phase (so support taps across every company stay reachable, unlike the
 * opponent-turn override that {@link shouldClearOverrideForNewCombat} only
 * needs to interrupt around combat) — so the CSS that hides `#hand-arc`
 * whenever `all-companies-mode` is set (see public/style.css) must be
 * suppressed for the phase's whole duration, or the reactive-play window is
 * unreachable: the player can see the pending check but never click the card.
 *
 * @param phase - The current phase.
 * @returns True if the hand-arc must stay visible (Free Council).
 */
export function handStaysVisibleDuringOverview(phase: PlayerView['phaseState']['phase']): boolean {
  return phase === Phase.FreeCouncil;
}

/** Track the last active player so we can reset view state on turn change. */
let lastActivePlayer: string | null = null;

/** Track the last M/H or Site step so we can detect select-company transitions. */
let lastMhSiteStep: string | null = null;

/**
 * Track the last opponent-turn M/H or Site `activeCompanyIndex` so we can
 * detect when the opponent's active company changes (see
 * {@link shouldResetFocusOnOpponentCompanyAdvance}). Null outside those
 * phases or on our own turn.
 */
let lastOpponentActiveCompanyIndex: number | null = null;

/**
 * Track whether combat was active on the last render, so we can detect the
 * start of a new combat (as opposed to a re-render mid-combat).
 */
let lastCombatActive = false;

// ---- Cached render arguments ----

/** Cached instance-to-definition lookup built from the latest PlayerView. */
let cachedInstanceLookup: ((id: CardInstanceId) => CardDefinitionId | undefined) = () => undefined;

/** Cached args for re-renders triggered by navigation. */
let lastOnAction: ((action: GameAction) => void) | null = null;
let lastView: PlayerView | null = null;
let lastCardPool: Readonly<Record<string, CardDefinition>> | null = null;

/**
 * Re-render callback. Set by the entry point so other modules can trigger
 * a full re-render without importing renderCompanyViews (avoids circular deps).
 */
let rerenderFn: (() => void) | null = null;

// ---- Getters ----

/** Get the currently focused company ID. */
export function getFocusedCompanyId(): CompanyId | null { return focusedCompanyId; }

/** Get the saved focused company ID (for toggle restore). */
export function getSavedFocusedCompanyId(): CompanyId | null { return savedFocusedCompanyId; }

/** Whether the all-companies override is active. */
export function getAllCompaniesOverride(): boolean { return allCompaniesOverride; }

/** Get the pending focus character ID (set after split). */
export function getPendingFocusCharacterId(): CardInstanceId | null { return pendingFocusCharacterId; }

/** Get the influence move source ID. */
export function getInfluenceMoveSourceId(): CardInstanceId | null { return influenceMoveSourceId; }

/** Get the transfer item source ID. */
export function getTransferItemSourceId(): CardInstanceId | null { return transferItemSourceId; }

/** Get the transfer item from-character ID. */
export function getTransferItemFromCharId(): CardInstanceId | null { return transferItemFromCharId; }

/** Get the company-move source character ID. */
export function getCompanyMoveSourceId(): CardInstanceId | null { return companyMoveSourceId; }

/** Get the company-move source company ID. */
export function getCompanyMoveSourceCompanyId(): CompanyId | null { return companyMoveSourceCompanyId; }

/** Get the merge source company ID. */
export function getMergeSourceCompanyId(): CompanyId | null { return mergeSourceCompanyId; }

/** Get the last active player string. */
export function getLastActivePlayer(): string | null { return lastActivePlayer; }

/** Get the last M/H or Site step. */
export function getLastMhSiteStep(): string | null { return lastMhSiteStep; }

/** Get the last opponent-turn M/H or Site active company index. */
export function getLastOpponentActiveCompanyIndex(): number | null { return lastOpponentActiveCompanyIndex; }

/** Get whether combat was active on the last render. */
export function getLastCombatActive(): boolean { return lastCombatActive; }

/** Get the cached instance lookup function. */
export function getCachedInstanceLookup(): (id: CardInstanceId) => CardDefinitionId | undefined { return cachedInstanceLookup; }

/** Get the last onAction callback. */
export function getLastOnAction(): ((action: GameAction) => void) | null { return lastOnAction; }

/** Get the last PlayerView. */
export function getLastView(): PlayerView | null { return lastView; }

/** Get the last card pool. */
export function getLastCardPool(): Readonly<Record<string, CardDefinition>> | null { return lastCardPool; }

// ---- Setters ----

/** Set the focused company ID. */
export function setFocusedCompanyId(id: CompanyId | null): void { focusedCompanyId = id; }

/** Set the saved focused company ID. */
export function setSavedFocusedCompanyId(id: CompanyId | null): void { savedFocusedCompanyId = id; }

/** Set the all-companies override flag. */
export function setAllCompaniesOverride(v: boolean): void { allCompaniesOverride = v; }

/** Set the pending focus character ID. */
export function setPendingFocusCharacterId(id: CardInstanceId | null): void { pendingFocusCharacterId = id; }

/** Set the influence move source ID. */
export function setInfluenceMoveSourceId(id: CardInstanceId | null): void { influenceMoveSourceId = id; }

/** Set the transfer item source ID. */
export function setTransferItemSourceId(id: CardInstanceId | null): void { transferItemSourceId = id; }

/** Set the transfer item from-character ID. */
export function setTransferItemFromCharId(id: CardInstanceId | null): void { transferItemFromCharId = id; }

/** Set the company-move source character ID. */
export function setCompanyMoveSourceId(id: CardInstanceId | null): void { companyMoveSourceId = id; }

/** Set the company-move source company ID. */
export function setCompanyMoveSourceCompanyId(id: CompanyId | null): void { companyMoveSourceCompanyId = id; }

/** Set the merge source company ID. */
export function setMergeSourceCompanyId(id: CompanyId | null): void { mergeSourceCompanyId = id; }

/** Set the last active player string. */
export function setLastActivePlayer(id: string | null): void { lastActivePlayer = id; }

/** Set the last M/H or Site step. */
export function setLastMhSiteStep(step: string | null): void { lastMhSiteStep = step; }

/** Set the last opponent-turn M/H or Site active company index. */
export function setLastOpponentActiveCompanyIndex(index: number | null): void { lastOpponentActiveCompanyIndex = index; }

/** Set whether combat was active on the last render. */
export function setLastCombatActive(v: boolean): void { lastCombatActive = v; }

/** Set the cached instance lookup function. */
export function setCachedInstanceLookup(fn: (id: CardInstanceId) => CardDefinitionId | undefined): void { cachedInstanceLookup = fn; }

/** Set the last onAction callback. */
export function setLastOnAction(fn: ((action: GameAction) => void) | null): void { lastOnAction = fn; }

/** Set the last PlayerView. */
export function setLastView(v: PlayerView | null): void { lastView = v; }

/** Set the last card pool. */
export function setLastCardPool(p: Readonly<Record<string, CardDefinition>> | null): void { lastCardPool = p; }

/** Set the re-render callback function. */
export function setRerenderFn(fn: (() => void) | null): void { rerenderFn = fn; }

/** Trigger a re-render via the registered callback. */
export function rerender(): void {
  if (rerenderFn) rerenderFn();
}

// ---- Reset ----

/** Reset all company view state. Call when leaving the game screen. */
export function resetState(): void {
  focusedCompanyId = null;
  savedFocusedCompanyId = null;
  allCompaniesOverride = false;
  lastActivePlayer = null;
  lastMhSiteStep = null;
  lastOpponentActiveCompanyIndex = null;
  lastCombatActive = false;
  lastOnAction = null;
  lastView = null;
  lastCardPool = null;
  cachedInstanceLookup = () => undefined;
  influenceMoveSourceId = null;
  transferItemSourceId = null;
  transferItemFromCharId = null;
  companyMoveSourceId = null;
  companyMoveSourceCompanyId = null;
  mergeSourceCompanyId = null;
  pendingFocusCharacterId = null;
  rerenderFn = null;
}
