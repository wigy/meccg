/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, GameAction, MovementHazardPhaseState, SiteCard, CardDefinitionId } from '../../index.js';
import { getPlayerIndex, isSiteCard, buildMovementMap, findRegionPaths } from '../../index.js';
import { MovementType } from '../../types/common.js';
import { logDetail, logHeading } from './log.js';

/**
 * Compute legal actions for the movement/hazard phase.
 *
 * The first step ('select-company') requires the resource player to choose
 * which of their unhandled companies will resolve next. No pass is allowed —
 * a company must be selected.
 */
export function movementHazardActions(state: GameState, playerId: PlayerId): GameAction[] {
  const isActive = state.activePlayer === playerId;
  const mhState = state.phaseState as MovementHazardPhaseState;

  logHeading(`Movement/hazard phase (step: ${mhState.step}): player is ${isActive ? 'active (mover)' : 'non-active (hazard player)'}`);

  if (mhState.step === 'select-company') {
    return selectCompanyActions(state, playerId, mhState);
  }

  if (mhState.step === 'reveal-new-site') {
    return revealNewSiteActions(state, playerId, mhState);
  }

  // TODO: declare-path, order-effects, play-hazard, assign-strike, resolve-strike, support-strike
  if (!isActive) {
    logDetail(`Not active player, no movement/hazard actions`);
    return [];
  }

  return [{ type: 'pass', player: playerId }];
}

/**
 * Generate actions for the reveal-new-site step (CoE step 1).
 *
 * If the company is moving, computes all possible ways to reach the
 * destination (starter and/or region movement) and offers each as a
 * `declare-path` action. No pass action — the player must choose a path.
 *
 * If the company is not moving (no destination), only a pass action is
 * offered to advance to the next step.
 *
 * TODO: triggering events on site reveal
 * TODO: under-deeps movement roll (stay if roll < site number)
 */
function revealNewSiteActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  if (state.activePlayer !== playerId) {
    logDetail(`Not active player — no actions during reveal-new-site step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company) {
    logDetail(`No active company at index ${mhState.activeCompanyIndex}`);
    return [];
  }

  // Non-moving company: just pass
  if (!company.destinationSite) {
    logDetail(`Company ${company.id as string} is not moving — pass to advance`);
    return [{ type: 'pass', player: playerId }];
  }

  // Resolve origin and destination site definitions
  const originDef = resolveSiteDef(state, company.currentSite);
  const destDef = resolveSiteDef(state, company.destinationSite);
  if (!originDef || !destDef) {
    logDetail(`Could not resolve site definitions — no actions`);
    return [];
  }

  const actions: GameAction[] = [];
  const movementMap = buildMovementMap(state.cardPool);

  // --- Starter movement ---
  if (isStarterMovementPossible(movementMap, originDef, destDef)) {
    logDetail(`Starter movement available: ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.Starter });
  }

  // --- Region movement ---
  const originRegion = movementMap.siteRegion.get(originDef.name);
  const destRegion = movementMap.siteRegion.get(destDef.name);
  if (originRegion && destRegion) {
    // Build region name → definition ID map for converting path names to IDs
    const regionNameToId = buildRegionNameMap(state);
    const paths = findRegionPaths(movementMap, originRegion, destRegion, mhState.maxRegionDistance);
    for (const path of paths) {
      const regionIds = path.map(name => regionNameToId.get(name)).filter((id): id is CardDefinitionId => id !== undefined);
      if (regionIds.length !== path.length) {
        logDetail(`Region path ${path.join(' → ')} has unresolvable region names — skipping`);
        continue;
      }
      logDetail(`Region path: ${path.join(' → ')} (${path.length} regions)`);
      actions.push({
        type: 'declare-path',
        player: playerId,
        movementType: MovementType.Region,
        regionPath: regionIds,
      });
    }
  }

  logDetail(`${actions.length} possible movement path(s) for company ${company.id as string}`);
  return actions;
}

/**
 * Resolve a site card instance ID to its {@link SiteCard} definition.
 * Returns `undefined` if the instance or definition cannot be found.
 */
function resolveSiteDef(
  state: GameState,
  siteInstanceId: import('../../index.js').CardInstanceId | null,
): SiteCard | undefined {
  if (!siteInstanceId) return undefined;
  const inst = state.instanceMap[siteInstanceId as string];
  if (!inst) return undefined;
  const def = state.cardPool[inst.definitionId as string];
  if (!def || !isSiteCard(def)) return undefined;
  return def;
}

/**
 * Build a map from region name to its {@link CardDefinitionId}.
 * Scans the card pool for all region cards.
 */
function buildRegionNameMap(state: GameState): Map<string, CardDefinitionId> {
  const map = new Map<string, CardDefinitionId>();
  for (const [id, card] of Object.entries(state.cardPool)) {
    if (card.cardType === 'region') {
      map.set(card.name, id as CardDefinitionId);
    }
  }
  return map;
}

/**
 * Check whether starter movement is possible between two sites.
 *
 * Starter movement connects:
 * - A haven to its connected non-haven sites (via nearestHaven)
 * - A non-haven site to its nearest haven
 * - Two havens that list paths to each other (via havenPaths)
 */
function isStarterMovementPossible(
  movementMap: import('../../index.js').MovementMap,
  origin: SiteCard,
  dest: SiteCard,
): boolean {
  const originIsHaven = origin.siteType === 'haven';
  const destIsHaven = dest.siteType === 'haven';

  if (originIsHaven && destIsHaven) {
    const connected = movementMap.havenToHaven.get(origin.name);
    return connected?.has(dest.name) ?? false;
  }
  if (originIsHaven && !destIsHaven) {
    return dest.nearestHaven === origin.name;
  }
  if (!originIsHaven && destIsHaven) {
    return origin.nearestHaven === dest.name;
  }
  return false;
}

/**
 * Generate select-company actions for the resource player.
 *
 * Lists all of the active player's companies that have not yet been
 * handled this turn. Only the active (resource) player may select;
 * the hazard player receives no actions during this step.
 */
function selectCompanyActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during select-company step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handledSet = new Set(mhState.handledCompanyIds);

  const actions: GameAction[] = [];
  for (const company of player.companies) {
    if (handledSet.has(company.id)) {
      logDetail(`Company ${company.id} already handled — skipping`);
      continue;
    }
    logDetail(`Company ${company.id} not yet handled — offering select-company`);
    actions.push({ type: 'select-company', player: playerId, companyId: company.id });
  }

  logDetail(`${actions.length} unhandled company(ies) available for selection`);
  return actions;
}
