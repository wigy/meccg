/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction, MovementHazardPhaseState, SiteCard, CardDefinitionId } from '../../index.js';
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
export function movementHazardActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  const mhState = state.phaseState as MovementHazardPhaseState;

  logHeading(`Movement/hazard phase (step: ${mhState.step}): player is ${isActive ? 'active (mover)' : 'non-active (hazard player)'}`);

  if (mhState.step === 'select-company') {
    return viable(selectCompanyActions(state, playerId, mhState));
  }

  if (mhState.step === 'reveal-new-site') {
    return viable(revealNewSiteActions(state, playerId, mhState));
  }

  // set-hazard-limit step (CoE step 3): immediate, only pass to advance
  if (mhState.step === 'set-hazard-limit') {
    if (!isActive) {
      logDetail(`Not active player — no actions during set-hazard-limit step`);
      return [];
    }
    logDetail(`Set hazard limit — pass to advance to order-effects`);
    return viable([{ type: 'pass', player: playerId }]);
  }

  // order-effects step (CoE step 4): dummy for now, only pass to advance
  if (mhState.step === 'order-effects') {
    if (!isActive) {
      logDetail(`Not active player — no actions during order-effects step`);
      return [];
    }
    logDetail(`Order effects — pass to advance to draw-cards`);
    return viable([{ type: 'pass', player: playerId }]);
  }

  // draw-cards step (CoE step 5): both players draw cards simultaneously
  if (mhState.step === 'draw-cards') {
    return viable(drawCardsActions(state, playerId, mhState, isActive));
  }

  // play-hazards step (CoE step 7): hazard player plays hazards, both may pass
  if (mhState.step === 'play-hazards') {
    return playHazardsActions(state, playerId, mhState, isActive);
  }

  // TODO: assign-strike, resolve-strike, support-strike
  if (!isActive) {
    logDetail(`Not active player, no movement/hazard actions`);
    return [];
  }

  return viable([{ type: 'pass', player: playerId }]);
}

/** Wrap plain GameActions as viable EvaluatedActions. */
function viable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
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
    // Sort paths: shortest first, then fewest distinct regions as tiebreaker
    paths.sort((a, b) => {
      const lenDiff = a.length - b.length;
      if (lenDiff !== 0) return lenDiff;
      return new Set(a).size - new Set(b).size;
    });
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

/**
 * Generate actions for the draw-cards step (CoE step 5).
 *
 * Both players act simultaneously. Each player who has not yet reached
 * their max draw count gets a `draw-cards` action (count: 1). After the
 * first mandatory draw, `pass` is also offered to stop early.
 * A player who has reached their max or has no cards left gets no actions.
 */
function drawCardsActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
): GameAction[] {
  const drawnSoFar = isResourcePlayer ? mhState.resourceDrawCount : mhState.hazardDrawCount;
  const drawMax = isResourcePlayer ? mhState.resourceDrawMax : mhState.hazardDrawMax;
  const playerLabel = isResourcePlayer ? 'resource' : 'hazard';

  // Already done (hit max or passed — signaled by drawCount >= drawMax)
  if (drawnSoFar >= drawMax) {
    logDetail(`${playerLabel} player already done drawing (${drawnSoFar}/${drawMax})`);
    return [];
  }

  // Check if player has cards to draw
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  if (player.playDeck.length === 0) {
    logDetail(`${playerLabel} player has no cards in play deck — only pass`);
    return [{ type: 'pass', player: playerId }];
  }

  const actions: GameAction[] = [];

  // Draw 1 card action
  actions.push({ type: 'draw-cards', player: playerId, count: 1 });

  // Pass is allowed after the first mandatory draw
  if (drawnSoFar > 0) {
    actions.push({ type: 'pass', player: playerId });
  }

  logDetail(`${playerLabel} player draw-cards: ${drawnSoFar}/${drawMax} drawn, ${actions.length} action(s)`);
  return actions;
}

/**
 * Generate actions for the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events from hand (up to the
 * hazard limit). Both players always have a pass action available.
 * The company's M/H phase ends when both players have passed.
 *
 * TODO: creatures, short-events, permanent-events, on-guard cards
 */
function playHazardsActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const limitReached = mhState.hazardsPlayedThisCompany >= mhState.hazardLimit;

  // Hazard player: offer playable hazard long-events
  if (!isResourcePlayer) {
    const playerIndex = getPlayerIndex(state, playerId);
    const player = state.players[playerIndex];
    const activeIndex = getPlayerIndex(state, state.activePlayer!);
    const resourcePlayer = state.players[activeIndex];
    const targetCompany = resourcePlayer.companies[mhState.activeCompanyIndex];

    for (const cardInstId of player.hand) {
      const inst = state.instanceMap[cardInstId as string];
      if (!inst) continue;
      const def = state.cardPool[inst.definitionId as string];
      if (!def) continue;

      // Currently only hazard long-events
      if (def.cardType !== 'hazard-event' || def.eventType !== 'long') continue;

      const action: GameAction = {
        type: 'play-hazard',
        player: playerId,
        cardInstanceId: cardInstId,
        targetCompanyId: targetCompany.id,
      };

      // Hazard limit reached
      if (limitReached) {
        actions.push({ action, viable: false, reason: `Hazard limit reached (${mhState.hazardLimit})` });
        continue;
      }

      // Uniqueness: non-viable if already in play
      if (def.unique) {
        const alreadyInPlay = state.players.some(p =>
          p.cardsInPlay.some(c => c.definitionId === def.id),
        );
        if (alreadyInPlay) {
          logDetail(`Hazard long-event "${def.name}" is unique and already in play`);
          actions.push({ action, viable: false, reason: `${def.name} is unique and already in play` });
          continue;
        }
      }

      // Duplication-limit: non-viable if max copies already in play
      if (def.effects) {
        let blocked = false;
        for (const effect of def.effects) {
          if (effect.type !== 'duplication-limit' || effect.scope !== 'game') continue;
          const copiesInPlay = state.players.reduce((count, p) =>
            count + p.cardsInPlay.filter(c => {
              const cDef = state.cardPool[c.definitionId as string];
              return cDef && cDef.name === def.name;
            }).length, 0,
          );
          if (copiesInPlay >= effect.max) {
            logDetail(`Hazard long-event "${def.name}" cannot be duplicated (${copiesInPlay}/${effect.max} in play)`);
            actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated` });
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
      }

      logDetail(`Hazard long-event "${def.name}" is playable`);
      actions.push({ action, viable: true });
    }
  }

  // Both players can always pass
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });

  const viableCount = actions.filter(a => a.viable && a.action.type === 'play-hazard').length;
  logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player has ${viableCount} viable hazard(s), ${actions.length} total action(s)`);
  return actions;
}
