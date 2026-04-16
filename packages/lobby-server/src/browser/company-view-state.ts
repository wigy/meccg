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
} from '@meccg/shared';
import type { CardDefinitionId } from '@meccg/shared';

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

/** Track the last active player so we can reset view state on turn change. */
let lastActivePlayer: string | null = null;

/** Track the last M/H or Site step so we can detect select-company transitions. */
let lastMhSiteStep: string | null = null;

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
