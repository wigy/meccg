/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction, MovementHazardPhaseState, SiteCard, CardDefinitionId, CardInstanceId, CompanyId, CreatureCard, CreatureKeyingMatch, PlayHazardAction, PlaceOnGuardAction, PlayConditionEffect, CreatureRaceChoiceEffect, PlayAgentHazardAction, RevealAgentAction, AgentMoveAction, AgentMoveBackAction, AgentReturnHomeAction, AgentHealAction, AgentUntapAction, AgentTurnFaceDownAction, AgentKeyCreaturesAction, AgentInfluenceAttemptAction, AgentTapAttackAction } from '../../index.js';
import { getPlayerIndex, isSiteCard, isCharacterCard, isAllyCard, isFactionCard, isAvatarCharacter, buildMovementMap, findRegionPaths, getReachableSites, RegionType, Race, Skill, hasPlayFlag, matchesCondition, matchesContext, CardStatus, Alignment, GENERAL_INFLUENCE, AGENT_MAX_REGION_DISTANCE } from '../../index.js';
import { canCallEndgameNow, isWizard, isMinionOrBalrog } from '../../state-utils.js';
import { defenderAlignmentLabel } from '../detainment.js';
import { isUnderDeepsAdjacent } from './organization-companies.js';
import type { TapAgentEffect, AgentTapAttackEffect, HazardLimitSwapEffect } from '../../types/effects.js';
import type { TapHazardCardForLimitAction, PayHazardLimitToUntapCardAction } from '../../types/actions-movement-hazard.js';
import { resolveInstanceId } from '../../types/state.js';
import { getActiveAutoAttacks } from '../manifestations.js';
import { resolveHandSize, isWardedAgainst, resolveDef } from '../effects/index.js';
import { cardName, matchesDefinition, playerById, getCardEffects, defById, countCopiesInPlay, countCompanyBoundCopies, companyEffectiveSize, defNamesOf, itemKeywordsOf, itemSubtypesOf } from '../reducer-utils.js';
import { countConstraintsFromDefinition } from '../pending.js';
import { buildInPlayNames } from '../recompute-derived.js';
import { MovementType } from '../../types/common.js';
import { logDetail, logHeading } from './log.js';
import { playPermanentEventActions, playShortEventActions } from './organization-events.js';
import { grantedActionActivations } from './organization.js';
import { heroResourceShortEventActions } from './long-event.js';
import { emitGrantedActionConstraintActions } from './granted-action-constraints.js';
import { countExtraAgentActions, currentHazardLimit } from '../reducer-movement-hazard.js';
import { collectRegionKeyingBoosts, regionPathsWithBoosts } from '../region-keying.js';

/**
 * Count unresolved hazard-creature / hazard-event chain entries. Used
 * as a context field for granted-action constraints whose `when`
 * checks chain state (e.g. Great Ship needs at least one unresolved
 * hazard to offer a cancel).
 */
function countUnresolvedChainHazards(state: GameState): number {
  if (!state.chain) return 0;
  let n = 0;
  for (const e of state.chain.entries) {
    if (e.resolved || e.negated || !e.card) continue;
    const def = defById(state, e.card.definitionId);
    if (def && (def.cardType === 'hazard-creature' || def.cardType === 'hazard-event')) n++;
  }
  return n;
}

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

  // Wound corruption checks (Barrow-wight et al.) are now produced and
  // consumed via the unified pending-resolution system; the
  // resolution short-circuit in `legal-actions/index.ts` handles them
  // before this function is reached.

  if (mhState.step === 'select-company') {
    return viable(selectCompanyActions(state, playerId, mhState));
  }

  if (mhState.step === 'reveal-new-site') {
    return viable(revealNewSiteActions(state, playerId, mhState));
  }

  if (mhState.step === 'under-deeps-roll') {
    if (!isActive) {
      logDetail(`Not active player — no actions during under-deeps-roll step`);
      return [];
    }
    logDetail(`Under-deeps roll — resource player must roll (required: ${mhState.underDeepsRollRequired ?? '?'})`);
    return viable([{ type: 'under-deeps-roll', player: playerId }]);
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

  // reset-hand step (CoE step 8): players with excess cards choose discards
  if (mhState.step === 'reset-hand') {
    return resetHandActions(state, playerId);
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
 * destination (starter, region, or Under-deeps movement) and offers each
 * as a `declare-path` action. No pass action — the player must choose a path.
 *
 * If the company is not moving (no destination), only a pass action is
 * offered to advance to the next step.
 *
 * TODO: triggering events on site reveal
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

  const player = playerById(state, playerId)!;
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
  const originDef = resolveSiteDef(state, company.currentSite?.instanceId ?? null);
  const destDef = resolveSiteDef(state, company.destinationSite.instanceId);
  if (!originDef || !destDef) {
    logDetail(`Could not resolve site definitions — no actions`);
    return [];
  }

  const actions: GameAction[] = [];

  // --- Special movement (e.g. Gwaihir) ---
  if (company.specialMovement === 'gwaihir') {
    logDetail(`Special movement (Gwaihir): ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.Special });
    return actions;
  }

  const movementMap = buildMovementMap(state.cardPool);

  // Under-deeps sites cannot be reached by starter or region movement — only under-deeps movement applies.
  const originIsUD = originDef.keywords?.includes('under-deeps') ?? false;
  const destIsUD = destDef.keywords?.includes('under-deeps') ?? false;
  const isUnderDeepsMovement = originIsUD || destIsUD;

  // --- Starter movement ---
  if (!isUnderDeepsMovement && isStarterMovementPossible(movementMap, originDef, destDef)) {
    logDetail(`Starter movement available: ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.Starter });
  }

  // --- Region movement ---
  const originRegion = movementMap.siteRegion.get(originDef.name);
  const destRegion = movementMap.siteRegion.get(destDef.name);
  if (!isUnderDeepsMovement && originRegion && destRegion) {
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

  // --- Under-deeps movement ---
  if (isUnderDeepsAdjacent(state, originDef, destDef)) {
    logDetail(`Under-deeps movement available: ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.UnderDeeps });
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
  const defId = resolveInstanceId(state, siteInstanceId);
  if (!defId) return undefined;
  const def = defById(state, defId);
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

  const player = playerById(state, playerId)!;
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

  const player = playerById(state, playerId)!;

  // Deck exhaust exchange sub-flow: only exchange + pass actions
  if (player.deckExhaustPending) {
    return deckExhaustExchangeActions(state, player, playerId);
  }

  // Check if player has cards to draw
  if (player.playDeck.length === 0) {
    if (player.discardPile.length > 0) {
      logDetail(`${playerLabel} player deck empty — must exhaust (reshuffle discard)`);
      return [{ type: 'deck-exhaust', player: playerId }];
    }
    logDetail(`${playerLabel} player has no cards in play deck or discard — only pass`);
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
 * Parse a comma-separated homesite string into individual site name tokens.
 * e.g. "Goblin-gate, Mount Gundabad" → ["Goblin-gate", "Mount Gundabad"]
 */
export function parseHomesiteNames(homesite: string): string[] {
  return homesite.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Generate `play-agent-hazard` actions for the hazard player.
 *
 * Emits one action per agent character card in the hazard player's hand.
 * The home site is chosen at reveal time (rule 9.04), not at play time.
 * Playing counts 1 against the hazard limit (rule 2.IV.vii.1).
 */
function playAgentHazardActions(
  state: GameState,
  playerId: PlayerId,
  _mhState: MovementHazardPhaseState,
  liveLimit: number,
  limitReached: boolean,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId)!;

  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def || !isCharacterCard(def)) continue;
    if (!('keywords' in def) || !(def as { keywords?: readonly string[] }).keywords?.includes('agent')) continue;

    const action: PlayAgentHazardAction = {
      type: 'play-agent-hazard',
      player: playerId,
      agentCardInstanceId: handCard.instanceId,
    };

    if (limitReached) {
      logDetail(`Agent "${def.name}": hazard limit reached (${liveLimit})`);
      actions.push({ action, viable: false, reason: `Hazard limit reached (${liveLimit})` });
    } else {
      logDetail(`Agent "${def.name}" playable as face-down hazard (home site chosen at reveal)`);
      actions.push({ action, viable: true });
    }
  }

  return actions;
}

/**
 * Generate `reveal-agent` actions for the hazard player.
 *
 * Revealing a face-down agent is not an action and does not count against
 * the hazard limit (rule 4.2). The hazard player chooses a home site from
 * their location deck matching the agent's home site names (rule 9.04).
 * One action is emitted per (agent, matching home site) pair.
 *
 * If no matching home site exists, one action is still emitted without a
 * homeSiteInstanceId — the reveal is legal but the agent will be discarded
 * at end of turn (rule 9.04).
 */
function revealAgentActions(
  state: GameState,
  playerId: PlayerId,
): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const agent of player.agents) {
    if (agent.revealed) continue;

    const agentDef = defById(state, agent.character.definitionId);
    if (!agentDef || !isCharacterCard(agentDef)) continue;

    const homesiteNames = parseHomesiteNames(agentDef.homesite);
    if (homesiteNames.length === 0) {
      logDetail(`Agent ${agent.id as string}: no homesite defined — cannot reveal`);
      continue;
    }

    // Emit one action per matching site instance in the location deck
    const seenNames = new Set<string>();
    for (const siteInst of player.siteDeck) {
      const siteDef = defById(state, siteInst.definitionId);
      if (!siteDef || !isSiteCard(siteDef)) continue;
      if (!homesiteNames.includes(siteDef.name)) continue;
      if (seenNames.has(siteDef.name)) continue;
      seenNames.add(siteDef.name);

      logDetail(`Agent reveal: ${agentDef.name} can reveal at home site "${siteDef.name}"`);
      const action: RevealAgentAction = {
        type: 'reveal-agent',
        player: playerId,
        agentId: agent.id,
        homeSiteInstanceId: siteInst.instanceId,
      };
      actions.push({ action, viable: true });
    }

    if (seenNames.size === 0) {
      // No matching home site in deck — reveal is still legal but agent discarded at end of turn
      logDetail(`Agent ${agentDef.name}: no matching home site in location deck — revealing without site (will discard at end of turn)`);
      const action: RevealAgentAction = {
        type: 'reveal-agent',
        player: playerId,
        agentId: agent.id,
        // no homeSiteInstanceId
      };
      actions.push({ action, viable: true });
    }
  }

  return actions;
}

/**
 * Returns true if the given site is a haven (Wizard haven site).
 *
 * Agents cannot move to haven sites (rule 9.07).
 */
function isHavenSite(state: GameState, defId: string): boolean {
  const def = state.cardPool[defId];
  return !!(def && isSiteCard(def) && def.siteType === 'haven');
}

/**
 * Generate agent turn actions for the hazard player.
 *
 * Each costs 1 hazard slot (rule 9.02). Common gate: the agent must have
 * been in play at start of turn (`inPlayAtTurnStart = true`) and must not
 * have already acted this turn (`actedThisTurn = false`).
 *
 * Emits: agent-move (one per legal destination), agent-move-back,
 * agent-return-home (one per matching home site), agent-heal, agent-untap,
 * agent-turn-face-down, agent-key-creatures.
 */
function agentTurnActions(
  state: GameState,
  playerId: PlayerId,
  limitReached: boolean,
  liveLimit: number,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId)!;

  for (const agent of player.agents) {
    if (!agent.inPlayAtTurnStart) continue;
    if (agent.remainingActions <= 0) continue;

    const agentDef = defById(state, agent.character.definitionId);
    const agentName = agentDef?.name ?? String(agent.character.definitionId);
    const status = agent.character.status;

    const extraAgentActions = countExtraAgentActions(state);
    const isExtraAction = agent.remainingActions <= extraAgentActions;
    function push(action: AgentMoveAction | AgentMoveBackAction | AgentReturnHomeAction | AgentHealAction | AgentUntapAction | AgentTurnFaceDownAction | AgentKeyCreaturesAction) {
      if (limitReached && !isExtraAction) {
        actions.push({ action, viable: false, reason: `Hazard limit reached (${liveLimit})` });
      } else {
        actions.push({ action, viable: true });
      }
    }

    // --- agent-move: move to adjacent site (non-haven, non-Under-deeps) ---
    // A tapped or untapped agent may move. When siteStack is empty (face-down
    // agent at home, hasn't moved yet), movement is from any of the home sites
    // (rule 4.1). When siteStack is non-empty, movement is from the top site.
    if (status === CardStatus.Untapped || status === CardStatus.Tapped) {
      const movementMap = buildMovementMap(state.cardPool);
      const allSiteDefs = Object.values(state.cardPool).filter(isSiteCard);
      const hazardAlignment = player.alignment;

      // Collect reachable site names from all valid starting points
      const reachableNames = new Set<string>();
      if (agent.siteStack.length > 0) {
        const topSite = agent.siteStack[agent.siteStack.length - 1];
        const topDef = defById(state, topSite.definitionId);
        if (topDef && isSiteCard(topDef)) {
          for (const r of getReachableSites(movementMap, topDef, allSiteDefs, AGENT_MAX_REGION_DISTANCE)) {
            reachableNames.add(r.site.name);
          }
          // Rule 9.08: Ringwraith/Balrog treat Dagorlad ↔ Ûdun as adjacent
          if (hazardAlignment === Alignment.Ringwraith || hazardAlignment === Alignment.Balrog) {
            const originRegion = topDef.region;
            const partnerRegion = originRegion === 'Dagorlad' ? 'Udûn' : originRegion === 'Udûn' ? 'Dagorlad' : null;
            if (partnerRegion) {
              for (const sd of allSiteDefs) {
                if (sd.region === partnerRegion) reachableNames.add(sd.name);
              }
            }
          }
        }
      } else if (agentDef && isCharacterCard(agentDef)) {
        // Face-down agent at home: reachable from any home site
        const homesiteNames = parseHomesiteNames(agentDef.homesite);
        for (const homeName of homesiteNames) {
          const homeDef = allSiteDefs.find(s => s.name === homeName);
          if (homeDef) {
            for (const r of getReachableSites(movementMap, homeDef, allSiteDefs, AGENT_MAX_REGION_DISTANCE)) {
              reachableNames.add(r.site.name);
            }
            // Rule 9.08: Ringwraith/Balrog treat Dagorlad ↔ Ûdun as adjacent
            if (hazardAlignment === Alignment.Ringwraith || hazardAlignment === Alignment.Balrog) {
              const originRegion = homeDef.region;
              const partnerRegion = originRegion === 'Dagorlad' ? 'Udûn' : originRegion === 'Udûn' ? 'Dagorlad' : null;
              if (partnerRegion) {
                for (const sd of allSiteDefs) {
                  if (sd.region === partnerRegion) reachableNames.add(sd.name);
                }
              }
            }
          }
        }
      }

      const seenDest = new Set<string>();
      for (const siteInst of player.siteDeck) {
        const destDef = defById(state, siteInst.definitionId);
        if (!destDef || !isSiteCard(destDef)) continue;
        if (seenDest.has(destDef.name)) continue;
        if (!reachableNames.has(destDef.name)) continue;
        // Exclude haven sites (rule 9.07)
        if (isHavenSite(state, siteInst.definitionId as string)) continue;
        // Exclude Under-deeps sites (rule 4.1: agents can only move to non-Under-deeps sites).
        if (destDef.keywords?.includes('under-deeps')) continue;
        // Rule 9.08: Fallen-wizard agents use only hero site cards
        if (hazardAlignment === Alignment.FallenWizard && destDef.cardType !== 'hero-site') continue;
        // Rule 9.08: Balrog agents use only minion site cards
        if (hazardAlignment === Alignment.Balrog && destDef.cardType !== 'minion-site') continue;
        seenDest.add(destDef.name);
        logDetail(`Agent ${agentName}: can move to "${destDef.name}"`);
        push({
          type: 'agent-move',
          player: playerId,
          agentId: agent.id,
          destinationSiteInstanceId: siteInst.instanceId,
        });
      }
    }

    // --- agent-move-back: return to previous site in stack ---
    if (agent.siteStack.length > 1) {
      logDetail(`Agent ${agentName}: can move back (stack depth ${agent.siteStack.length})`);
      push({ type: 'agent-move-back', player: playerId, agentId: agent.id });
    }

    // --- agent-return-home: return all site cards to deck, agent at home ---
    // Does not tap the agent (rule 4.1). For face-down agents: siteStack → [],
    // no site card needed. For face-up agents: must place home site card.
    if (agent.revealed && agentDef && isCharacterCard(agentDef)) {
      // Face-up: emit one action per matching home site in location deck
      const homesiteNames = parseHomesiteNames(agentDef.homesite);
      const seenHome = new Set<string>();
      for (const siteInst of player.siteDeck) {
        const siteDef = defById(state, siteInst.definitionId);
        if (!siteDef || !isSiteCard(siteDef)) continue;
        if (!homesiteNames.includes(siteDef.name)) continue;
        if (seenHome.has(siteDef.name)) continue;
        seenHome.add(siteDef.name);
        logDetail(`Agent ${agentName}: can return home (face-up) to "${siteDef.name}"`);
        push({ type: 'agent-return-home', player: playerId, agentId: agent.id, homeSiteInstanceId: siteInst.instanceId });
      }
    } else {
      // Face-down: single action, no site card needed
      logDetail(`Agent ${agentName}: can return home (face-down) — siteStack cleared`);
      push({ type: 'agent-return-home', player: playerId, agentId: agent.id });
    }

    // --- agent-heal: heal wounded (Inverted) to Tapped ---
    if (status === CardStatus.Inverted) {
      logDetail(`Agent ${agentName}: can heal (wounded → tapped)`);
      push({ type: 'agent-heal', player: playerId, agentId: agent.id });
    }

    // --- agent-untap: untap a tapped agent ---
    if (status === CardStatus.Tapped) {
      logDetail(`Agent ${agentName}: can untap`);
      push({ type: 'agent-untap', player: playerId, agentId: agent.id });
    }

    // --- agent-turn-face-down: face-up untapped agent turns face-down ---
    if (agent.revealed && status === CardStatus.Untapped) {
      logDetail(`Agent ${agentName}: can turn face-down`);
      push({ type: 'agent-turn-face-down', player: playerId, agentId: agent.id });
    }

    // --- agent-key-creatures: tap untapped agent to key creatures to its site ---
    if (status === CardStatus.Untapped) {
      logDetail(`Agent ${agentName}: can tap to key creatures to site`);
      push({ type: 'agent-key-creatures', player: playerId, agentId: agent.id });
    }
  }

  return actions;
}

/**
 * Generate `agent-influence-attempt` actions for agents with the
 * `agent-tap-influence` effect (rule 10.14).
 *
 * - Does NOT count as an agent action (actedThisTurn is not set).
 * - Does NOT count against the hazard limit.
 * - Agent must have been in play at start of turn (inPlayAtTurnStart).
 * - Agent must not be wounded.
 * - Agent must be at the active company's location:
 *     - moving company: agent at destination site
 *     - stationary company: agent at current site
 * - For faction targets: agent must be at a site where the faction is playable.
 * - Cannot reveal identical card → no item targets.
 * - Bonuses applied in the reducer: +2 DI if at home; shared-home mind=0 +2 roll.
 */
function agentInfluenceActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const hazardPlayerIndex = getPlayerIndex(state, playerId);
  const hazardPlayer = state.players[hazardPlayerIndex];
  const resourcePlayerIndex = 1 - hazardPlayerIndex;
  const resourcePlayer = state.players[resourcePlayerIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!company) return [];

  const allSiteDefs = Object.values(state.cardPool).filter(isSiteCard);

  for (const agent of hazardPlayer.agents) {
    if (!agent.inPlayAtTurnStart) continue;
    if (agent.character.status === CardStatus.Inverted) continue; // wounded

    const agentDef = defById(state, agent.character.definitionId);
    if (!agentDef || !isCharacterCard(agentDef)) continue;

    const tapInfluenceEff = (agentDef.effects ?? []).find(e => e.type === 'agent-tap-influence') as
      | { type: 'agent-tap-influence'; targetKinds: readonly ('character' | 'ally' | 'faction')[] }
      | undefined;
    if (!tapInfluenceEff) continue;

    // Determine the agent's current site name
    let agentSiteName: string | null = null;
    if (agent.siteStack.length > 0) {
      const topSite = agent.siteStack[agent.siteStack.length - 1];
      const siteDef = defById(state, topSite.definitionId);
      if (siteDef && isSiteCard(siteDef)) agentSiteName = siteDef.name;
    } else {
      // Face-down at home — site name is one of the home sites
      agentSiteName = parseHomesiteNames(agentDef.homesite)[0] ?? null;
    }

    // Determine the target company's site name
    const destSiteName = mhState.destinationSiteName; // null if stationary
    const currentSiteName: string | null = (() => {
      if (!company.currentSite) return null;
      const d = defById(state, company.currentSite.definitionId);
      return d && isSiteCard(d) ? d.name : null;
    })();
    const companySiteName = destSiteName ?? currentSiteName;

    const isAgentAtCompanySite = agentSiteName !== null && companySiteName !== null && agentSiteName === companySiteName;

    const opponentGI = GENERAL_INFLUENCE - resourcePlayer.generalInfluenceUsed;

    // --- Character and ally targets (agent must be at company's site) ---
    if (isAgentAtCompanySite) {
      // Use the active company directly — for moving companies currentSite is the origin,
      // but we already verified the agent is at the destination via isAgentAtCompanySite.
      for (const oppCharId of company.characters) {
        const oppChar = resourcePlayer.characters[oppCharId as string];
        if (!oppChar) continue;
        const oppCharDef = defById(state, oppChar.definitionId);
        if (!oppCharDef || !isCharacterCard(oppCharDef)) continue;
        if (isAvatarCharacter(oppCharDef)) continue;

        // Character targets
        if (tapInfluenceEff.targetKinds.includes('character')) {
          const influencerDI = agentDef.directInfluence ?? 0;
          const explanation = `Agent ${agentDef.name} DI: ${influencerDI}, opponent GI: ${opponentGI}, target: ${oppCharDef.name} (mind: ${oppCharDef.mind ?? 0})`;
          logDetail(`Agent influence: ${agentDef.name} → character ${oppCharDef.name} (${explanation})`);
          actions.push({
            action: {
              type: 'agent-influence-attempt',
              player: playerId,
              agentId: agent.id,
              targetPlayer: resourcePlayer.id,
              targetInstanceId: oppCharId,
              targetKind: 'character',
              explanation,
            } as AgentInfluenceAttemptAction,
            viable: true,
          });
        }

        // Ally targets on this character
        if (tapInfluenceEff.targetKinds.includes('ally')) {
          for (const allyInst of oppChar.allies) {
            const allyDef = defById(state, allyInst.definitionId);
            if (!allyDef || !isAllyCard(allyDef)) continue;
            const influencerDI = agentDef.directInfluence ?? 0;
            const explanation = `Agent ${agentDef.name} DI: ${influencerDI}, opponent GI: ${opponentGI}, target ally: ${allyDef.name} (mind: ${allyDef.mind})`;
            logDetail(`Agent influence: ${agentDef.name} → ally ${allyDef.name} (${explanation})`);
            actions.push({
              action: {
                type: 'agent-influence-attempt',
                player: playerId,
                agentId: agent.id,
                targetPlayer: resourcePlayer.id,
                targetInstanceId: allyInst.instanceId,
                targetKind: 'ally',
                explanation,
              } as AgentInfluenceAttemptAction,
              viable: true,
            });
          }
        }
      }
    }

    // --- Faction targets (agent must be at a site where faction is playable) ---
    if (tapInfluenceEff.targetKinds.includes('faction') && agentSiteName !== null) {
      const agentSiteDef = allSiteDefs.find(s => s.name === agentSiteName);
      if (agentSiteDef) {
        for (const factionInPlay of resourcePlayer.cardsInPlay) {
          const factionDef = defById(state, factionInPlay.definitionId);
          if (!factionDef || !isFactionCard(factionDef)) continue;
          if (!factionDef.playableAt.some(entry => 'site' in entry && agentSiteDef.name === entry.site)) continue;

          const influencerDI = agentDef.directInfluence ?? 0;
          const targetValue = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;
          const explanation = `Agent ${agentDef.name} DI: ${influencerDI}, opponent GI: ${opponentGI}, faction: ${factionDef.name} (value: ${targetValue})`;
          logDetail(`Agent influence: ${agentDef.name} → faction ${factionDef.name} at ${agentSiteName} (${explanation})`);
          actions.push({
            action: {
              type: 'agent-influence-attempt',
              player: playerId,
              agentId: agent.id,
              targetPlayer: resourcePlayer.id,
              targetInstanceId: factionInPlay.instanceId,
              targetKind: 'faction',
              explanation,
            } as AgentInfluenceAttemptAction,
            viable: true,
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Generate `agent-tap-attack` actions for agents with the `agent-tap-attack`
 * effect (e.g. The Grimburgoth dm-15).
 *
 * - Does NOT count as an agent action (actedThisTurn is not set).
 * - Does NOT count against the hazard limit.
 * - Agent must have been in play at start of turn (inPlayAtTurnStart).
 * - Agent must not be wounded.
 * - Agent must be at the active company's destination site (or current site
 *   if stationary).
 * - Only one attack per agent per M/H phase.
 */
function agentTapAttackActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const hazardPlayerIndex = getPlayerIndex(state, playerId);
  const hazardPlayer = state.players[hazardPlayerIndex];
  const resourcePlayerIndex = 1 - hazardPlayerIndex;
  const resourcePlayer = state.players[resourcePlayerIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!company) return [];

  const destSiteName = mhState.destinationSiteName;
  const currentSiteName: string | null = (() => {
    if (!company.currentSite) return null;
    const d = defById(state, company.currentSite.definitionId);
    return d && isSiteCard(d) ? d.name : null;
  })();
  const companySiteName = destSiteName ?? currentSiteName;

  for (const agent of hazardPlayer.agents) {
    if (!agent.inPlayAtTurnStart) continue;
    if (agent.character.status === CardStatus.Inverted) continue; // wounded

    const agentDef = defById(state, agent.character.definitionId);
    if (!agentDef || !isCharacterCard(agentDef)) continue;

    const tapAttackEff = (agentDef.effects ?? []).find(
      (e): e is AgentTapAttackEffect => e.type === 'agent-tap-attack',
    );
    if (!tapAttackEff) continue;

    // Determine the agent's current site name
    let agentSiteName: string | null = null;
    if (agent.siteStack.length > 0) {
      const topSite = agent.siteStack[agent.siteStack.length - 1];
      const siteDef = defById(state, topSite.definitionId);
      if (siteDef && isSiteCard(siteDef)) agentSiteName = siteDef.name;
    } else {
      const homesiteNames = agentDef.homesite
        ? agentDef.homesite.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      agentSiteName = homesiteNames[0] ?? null;
    }

    const isAgentAtCompanySite =
      agentSiteName !== null && companySiteName !== null && agentSiteName === companySiteName;
    if (!isAgentAtCompanySite) {
      logDetail(`Agent tap-attack ${agentDef.name}: not at company's site (agent: ${agentSiteName ?? 'unknown'}, company: ${companySiteName ?? 'unknown'}) — skipping`);
      continue;
    }

    logDetail(`Agent tap-attack ${agentDef.name}: at company site "${companySiteName}" — offering attack`);

    if (!agent.revealed) {
      // Face-down: offer one action per home site in deck (reveal at attack)
      const homesiteNames = agentDef.homesite
        ? agentDef.homesite.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
      const seenHome = new Set<string>();
      let offeredAny = false;
      for (const siteInst of hazardPlayer.siteDeck) {
        const siteDef = defById(state, siteInst.definitionId);
        if (!siteDef || !isSiteCard(siteDef)) continue;
        if (!homesiteNames.includes(siteDef.name)) continue;
        if (seenHome.has(siteDef.name)) continue;
        seenHome.add(siteDef.name);
        logDetail(`Agent tap-attack ${agentDef.name}: face-down, offering with home site "${siteDef.name}"`);
        actions.push({
          action: {
            type: 'agent-tap-attack',
            player: playerId,
            agentId: agent.id,
            homeSiteInstanceId: siteInst.instanceId,
          } as AgentTapAttackAction,
          viable: true,
        });
        offeredAny = true;
      }
      if (!offeredAny) {
        // No home site in deck — reveal without site, discard at EOT
        logDetail(`Agent tap-attack ${agentDef.name}: face-down, no home site in deck — offering without site`);
        actions.push({
          action: { type: 'agent-tap-attack', player: playerId, agentId: agent.id } as AgentTapAttackAction,
          viable: true,
        });
      }
    } else {
      // Face-up: single action
      actions.push({
        action: { type: 'agent-tap-attack', player: playerId, agentId: agent.id } as AgentTapAttackAction,
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Power Built by Waiting (as-34):
 *
 * For each hazard-player cardsInPlay card carrying a `hazard-limit-swap`
 * effect:
 *
 * - If the card is untapped, offer a `tap-hazard-card-for-limit` action
 *   (taps the card to raise the hazard limit by `tapValue`).
 * - If the card is tapped and the remaining hazard limit is ≥ `untapCost`,
 *   offer a `pay-hazard-limit-to-untap-card` action.
 */
function tapHazardCardForLimitActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  targetCompanyId: CompanyId,
  liveLimit: number,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId)!;
  const remainingLimit = liveLimit - mhState.hazardsPlayedThisCompany;

  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const swapEffect = getCardEffects(def).find((e): e is HazardLimitSwapEffect => e.type === 'hazard-limit-swap');
    if (!swapEffect) continue;

    const tapAction: TapHazardCardForLimitAction = {
      type: 'tap-hazard-card-for-limit',
      player: playerId,
      cardInstanceId: card.instanceId,
      targetCompanyId,
    };
    if (card.status === CardStatus.Untapped) {
      logDetail(`${def.name}: untapped — offering tap-hazard-card-for-limit (+${swapEffect.tapValue} hazard limit)`);
      actions.push({ action: tapAction, viable: true });
    } else {
      logDetail(`${def.name}: already tapped — tap-hazard-card-for-limit not available`);
      actions.push({ action: tapAction, viable: false, reason: `${def.name} is already tapped` });
    }

    const untapAction: PayHazardLimitToUntapCardAction = {
      type: 'pay-hazard-limit-to-untap-card',
      player: playerId,
      cardInstanceId: card.instanceId,
      targetCompanyId,
    };
    if (card.status === CardStatus.Tapped && remainingLimit >= swapEffect.untapCost) {
      logDetail(`${def.name}: tapped, ${remainingLimit} limit remaining ≥ cost ${swapEffect.untapCost} — offering pay-hazard-limit-to-untap-card`);
      actions.push({ action: untapAction, viable: true });
    } else if (card.status !== CardStatus.Tapped) {
      logDetail(`${def.name}: not tapped — pay-hazard-limit-to-untap-card not available`);
      actions.push({ action: untapAction, viable: false, reason: `${def.name} is not tapped` });
    } else {
      logDetail(`${def.name}: tapped but only ${remainingLimit} limit remaining (need ${swapEffect.untapCost}) — pay-hazard-limit-to-untap-card not viable`);
      actions.push({ action: untapAction, viable: false, reason: `Insufficient hazard limit to untap ${def.name} (need ${swapEffect.untapCost})` });
    }
  }

  return actions;
}

/**
 * Generate reserve-creature and play-reserved-creature actions for
 * Summons from Long Sleep (as-39) permanent-event cards in play.
 *
 * - `reserve-creature`: free action that moves a Dragon/Drake from hand
 *   into the AS-39 slot (no hazard limit cost).
 * - `play-reserved-creature`: plays the reserved creature as-if-from-hand
 *   (costs one hazard limit slot; +2 prowess applied at chain resolution).
 */
function summonsFromLongSleepActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  targetCompanyId: CompanyId,
  limitReached: boolean,
  liveLimit: number,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId)!;
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIdx];
  const targetCompany = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!targetCompany) return actions;

  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const shaEffect = getCardEffects(def).find(
      e => e.type === 'summons-from-long-sleep',
    );
    if (!shaEffect) continue;

    const defName = (def as { name?: string })?.name ?? (card.definitionId as string);
    const slotOccupied = player.reservedCreatures.some(
      r => r.sourceCardInstanceId === card.instanceId,
    );

    // reserve-creature: offer for each Dragon/Drake in hand (free, slot must be empty)
    if (!slotOccupied) {
      for (const handCard of player.hand) {
        const hDef = defById(state, handCard.definitionId);
        if (!hDef || hDef.cardType !== 'hazard-creature') continue;
        const race = (hDef).race.toLowerCase();
        if (race !== 'dragon' && race !== 'drake') continue;
        const hName = (hDef as { name?: string })?.name ?? (handCard.definitionId as string);
        logDetail(`${defName}: offering reserve-creature for "${hName}" (slot empty, free action)`);
        actions.push({
          action: {
            type: 'reserve-creature' as const,
            player: playerId,
            cardInstanceId: handCard.instanceId,
            sourceCardInstanceId: card.instanceId,
          },
          viable: true,
        });
      }
    }

    // play-reserved-creature: offer if slot has a creature and chain is null
    const reservation = player.reservedCreatures.find(
      r => r.sourceCardInstanceId === card.instanceId,
    );
    if (reservation) {
      const creatureDef = defById(state, reservation.creature.definitionId);
      const creatureName = (creatureDef as { name?: string })?.name ?? (reservation.creature.definitionId as string);

      // Must initiate a new chain
      if (state.chain !== null) {
        logDetail(`${defName}: play-reserved-creature "${creatureName}" not available — chain in progress`);
        actions.push({
          action: {
            type: 'play-reserved-creature' as const,
            player: playerId,
            sourceCardInstanceId: card.instanceId,
            targetCompanyId,
          },
          viable: false,
          reason: 'Creatures must initiate a new chain',
        });
        continue;
      }

      if (limitReached) {
        logDetail(`${defName}: play-reserved-creature "${creatureName}" not available — hazard limit reached`);
        actions.push({
          action: {
            type: 'play-reserved-creature' as const,
            player: playerId,
            sourceCardInstanceId: card.instanceId,
            targetCompanyId,
          },
          viable: false,
          reason: `Hazard limit reached (${liveLimit})`,
        });
        continue;
      }

      // Keying check (treat as if from hand)
      if (creatureDef && creatureDef.cardType === 'hazard-creature') {
        const cancelSiteName = cancelAttacksSiteName(state, targetCompany);
        if (cancelSiteName) {
          logDetail(`${defName}: play-reserved-creature "${creatureName}" blocked by site-rule on ${cancelSiteName}`);
          actions.push({
            action: {
              type: 'play-reserved-creature' as const,
              player: playerId,
              sourceCardInstanceId: card.instanceId,
              targetCompanyId,
            },
            viable: false,
            reason: `Attacks against this company are canceled at ${cancelSiteName}`,
          });
          continue;
        }

        const matches = findCreatureKeyingMatches(creatureDef, mhState, state, targetCompany);
        const keyingBypassed = hasCreatureKeyingBypass(state, targetCompany.id, (creatureDef).race)
          || siteAllowsCreatureByRace(state, targetCompany, (creatureDef).race);

        if (matches.length === 0 && !keyingBypassed) {
          const keyError = describeKeyingRequirement(creatureDef);
          logDetail(`${defName}: play-reserved-creature "${creatureName}" not keyable: ${keyError}`);
          actions.push({
            action: {
              type: 'play-reserved-creature' as const,
              player: playerId,
              sourceCardInstanceId: card.instanceId,
              targetCompanyId,
            },
            viable: false,
            reason: keyError,
          });
          continue;
        }

        if (matches.length === 0 && keyingBypassed) {
          logDetail(`${defName}: play-reserved-creature "${creatureName}" keyable via keying-bypass`);
          actions.push({
            action: {
              type: 'play-reserved-creature' as const,
              player: playerId,
              sourceCardInstanceId: card.instanceId,
              targetCompanyId,
              keyedBy: { method: 'keying-bypass', value: (creatureDef).race },
            },
            viable: true,
          });
          continue;
        }

        for (const match of matches) {
          logDetail(`${defName}: play-reserved-creature "${creatureName}" keyable by ${match.method}: ${match.value}`);
          actions.push({
            action: {
              type: 'play-reserved-creature' as const,
              player: playerId,
              sourceCardInstanceId: card.instanceId,
              targetCompanyId,
              keyedBy: match,
            },
            viable: true,
          });
        }
        continue;
      }

      logDetail(`${defName}: play-reserved-creature "${creatureName}" — offering action`);
      actions.push({
        action: {
          type: 'play-reserved-creature' as const,
          player: playerId,
          sourceCardInstanceId: card.instanceId,
          targetCompanyId,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Generate play-creature-from-discard actions for hazard short-events carrying
 * a `play-creature-from-discard` effect (Exhalation of Decay, dm-55).
 *
 * For each such event card in the hazard player's hand, enumerate the hazard
 * player's discard pile for hazard-creatures matching the effect's `filter`
 * (e.g. Undead). A creature is offered only if it can be keyed against the
 * target company ("if target Undead can attack") and the chain is null
 * (creatures must initiate a new chain). The play does NOT count against the
 * hazard limit, so no limit gating is applied. One action is emitted per
 * (creature, keying-match) pair, mirroring the play-hazard creature path.
 */
function playCreatureFromDiscardActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  targetCompanyId: CompanyId,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIdx];
  const targetCompany = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!targetCompany) return actions;

  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!def) continue;
    const effect = getCardEffects(def).find(
      (e): e is import('../../index.js').PlayCreatureFromDiscardEffect =>
        e.type === 'play-creature-from-discard',
    );
    if (!effect) continue;

    const defName = (def as { name?: string })?.name ?? (handCard.definitionId as string);

    // Creatures must initiate a new chain — not playable in response (CoE rule 307).
    if (state.chain != null) {
      logDetail(`${defName}: play-creature-from-discard not available — chain in progress`);
      continue;
    }

    // Cancel-attacks site rule (e.g. Dol Guldur, Moria): when the target
    // company's effective site forbids creatures, this play is unavailable.
    const cancelSiteName = cancelAttacksSiteName(state, targetCompany);
    if (cancelSiteName) {
      logDetail(`${defName}: play-creature-from-discard blocked by site-rule on ${cancelSiteName}`);
      continue;
    }

    for (const discardCard of player.discardPile) {
      const creatureDef = defById(state, discardCard.definitionId);
      if (!creatureDef || creatureDef.cardType !== 'hazard-creature') continue;
      if (!matchesCondition(effect.filter, creatureDef as unknown as Record<string, unknown>)) continue;

      const creatureName = (creatureDef as { name?: string })?.name ?? (discardCard.definitionId as string);

      const matches = findCreatureKeyingMatches(creatureDef, mhState, state, targetCompany);
      const keyingBypassed = hasCreatureKeyingBypass(state, targetCompany.id, creatureDef.race)
        || siteAllowsCreatureByRace(state, targetCompany, creatureDef.race);

      if (matches.length === 0 && !keyingBypassed) {
        logDetail(`${defName}: discard creature "${creatureName}" not keyable: ${describeKeyingRequirement(creatureDef)}`);
        continue;
      }

      if (matches.length === 0 && keyingBypassed) {
        logDetail(`${defName}: discard creature "${creatureName}" keyable via keying-bypass`);
        actions.push({
          action: {
            type: 'play-creature-from-discard' as const,
            player: playerId,
            cardInstanceId: handCard.instanceId,
            creatureInstanceId: discardCard.instanceId,
            targetCompanyId,
            keyedBy: { method: 'keying-bypass', value: creatureDef.race },
          },
          viable: true,
        });
        continue;
      }

      for (const match of matches) {
        logDetail(`${defName}: discard creature "${creatureName}" keyable by ${match.method}: ${match.value}`);
        actions.push({
          action: {
            type: 'play-creature-from-discard' as const,
            player: playerId,
            cardInstanceId: handCard.instanceId,
            creatureInstanceId: discardCard.instanceId,
            targetCompanyId,
            keyedBy: match,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Generate actions for the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events from hand (up to the
 * hazard limit). Both players always have a pass action available.
 * The company's M/H phase ends when both players have passed.
 *
 * TODO: creatures, short-events, permanent-events
 */
function playHazardsActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const targetCompanyRef = state.players[activeIdx].companies[mhState.activeCompanyIndex];
  if (!targetCompanyRef) return actions;
  const targetCompanyId = targetCompanyRef.id;
  const liveLimit = currentHazardLimit(state, mhState, targetCompanyId);
  const limitReached = mhState.hazardsPlayedThisCompany >= liveLimit;

  // Hazard player: offer playable hazard long-events
  if (!isResourcePlayer) {
    const playerIndex = getPlayerIndex(state, playerId);
    const player = state.players[playerIndex];
    const activeIndex = getPlayerIndex(state, state.activePlayer!);
    const resourcePlayer = state.players[activeIndex];
    const targetCompany = resourcePlayer.companies[mhState.activeCompanyIndex];

    for (const handCard of player.hand) {
      const cardInstId = handCard.instanceId;
      const def = defById(state, handCard.definitionId);
      if (!def) continue;

      const isCreature = def.cardType === 'hazard-creature';
      const isShortEvent = def.cardType === 'hazard-event' && def.eventType === 'short';
      const isEvent = def.cardType === 'hazard-event'
        && (def.eventType === 'long' || def.eventType === 'permanent');
      const isCorruption = def.cardType === 'hazard-corruption';
      // Resource-events tagged `playable-as-hazard` (e.g. Sudden Call, le-235)
      // piggyback on the hazard short-event path.
      const isResourceAsHazard = (def.cardType === 'hero-resource-event'
        || def.cardType === 'minion-resource-event')
        && hasPlayFlag(def, 'playable-as-hazard');
      if (!isCreature && !isEvent && !isShortEvent && !isCorruption && !isResourceAsHazard) continue;

      // Skip hazards whose play-window pins them to a non-M/H window
      // (e.g. Dragon's Curse: combat/resolve-strike). Those are offered
      // by the combat legal-action emitter instead.
      const hazardPlayWindow = getCardEffects(def).find(e => e.type === 'play-window') as { phase?: string } | undefined;
      if (hazardPlayWindow && hazardPlayWindow.phase !== 'movement-hazard') {
        logDetail(`Hazard "${def.name}" has play-window ${hazardPlayWindow.phase} — skipping in M/H phase`);
        continue;
      }

      const action: PlayHazardAction = {
        type: 'play-hazard',
        player: playerId,
        cardInstanceId: cardInstId,
        targetCompanyId: targetCompany.id,
      };

      // Hazard limit reached (cards with no-hazard-limit bypass this)
      const bypassesLimit = 'effects' in def && hasPlayFlag(def, 'no-hazard-limit');
      const raceExempt = isCreature && isCreatureRaceExemptFromLimit(state, targetCompany.id, def.race);
      if (limitReached && !bypassesLimit && !raceExempt) {
        actions.push({ action, viable: false, reason: `Hazard limit reached (${liveLimit})` });
        continue;
      }

      // --- Creature keying check ---
      if (isCreature) {
        // Creatures must initiate a new chain — not playable in response (CoE rule 307)
        if (state.chain != null) {
          actions.push({ action, viable: false, reason: 'Creatures must initiate a new chain' });
          continue;
        }
        // Cancel-attacks site rule (e.g. Dol Guldur, Moria): when the target
        // company's effective site carries this rule, the hazard player may
        // not play creatures against it.
        const cancelSiteName = cancelAttacksSiteName(state, targetCompany);
        if (cancelSiteName) {
          logDetail(`Creature "${def.name}" cancelled by site-rule on ${cancelSiteName}`);
          actions.push({ action, viable: false, reason: `Attacks against this company are canceled at ${cancelSiteName}` });
          continue;
        }
        const matches = findCreatureKeyingMatches(def, mhState, state, targetCompany);
        const keyingBypassed = hasCreatureKeyingBypass(state, targetCompany.id, def.race)
          || siteAllowsCreatureByRace(state, targetCompany, def.race);
        if (matches.length === 0 && !keyingBypassed) {
          const keyError = describeKeyingRequirement(def);
          logDetail(`Creature "${def.name}" not keyable: ${keyError}`);
          actions.push({ action, viable: false, reason: keyError });
          continue;
        }
        // Check play-condition: target-company (e.g. Horse-lords — not playable
        // against a company containing a character with Edoras as a home site).
        const targetCompanyCond = def.effects?.find(
          (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'target-company',
        );
        if (targetCompanyCond?.condition) {
          const targetCtx = buildTargetCompanyConditionContext(state, targetCompany, defenderAlignmentLabel(resourcePlayer.alignment));
          if (!matchesCondition(targetCompanyCond.condition, targetCtx)) {
            logDetail(`Creature "${def.name}": target-company play-condition not met — not playable against this company`);
            actions.push({ action, viable: false, reason: 'Cannot be played against this company' });
            continue;
          }
        }
        if (matches.length === 0 && keyingBypassed) {
          logDetail(`Creature "${def.name}" keyable via keying-bypass (race "${def.race}")`);
          actions.push({
            action: { ...action, keyedBy: { method: 'keying-bypass', value: def.race } },
            viable: true,
          });
          continue;
        }
        for (const match of matches) {
          logDetail(`Creature "${def.name}" keyable by ${match.method}: ${match.value}`);
          actions.push({
            action: { ...action, keyedBy: match },
            viable: true,
          });
        }
        continue;
      }

      // --- Resource-as-hazard (e.g. Sudden Call, le-235) ---
      // The card is a minion-resource-event with the `playable-as-hazard`
      // flag, played by the hazard player on the opponent's turn. For
      // `call-council` effects (Sudden Call), the defending (resource)
      // player must be non-Wizard and must meet endgame conditions; per
      // rule 10.41 the caller (the hazard player here) gets the last turn.
      if (isResourceAsHazard && !isShortEvent) {
        const hazardPlayer = playerById(state, playerId)!;
        const defendingPlayer = resourcePlayer; // the active (resource) player being attacked
        const callEffect = def.effects?.find(
          (e): e is import('../../index.js').CallCouncilEffect => e.type === 'call-council' && e.lastTurnFor === 'self',
        );
        if (!callEffect) {
          // No hazard-side call-council effect → no viable hazard play of this card
          actions.push({ action, viable: false, reason: `${def.name}: no hazard-side effect defined` });
          continue;
        }
        if (isWizard(defendingPlayer)) {
          actions.push({ action, viable: false, reason: `${def.name}: cannot be played as a hazard against a ${defendingPlayer.alignment} player` });
          continue;
        }
        if (!canCallEndgameNow(defendingPlayer)) {
          actions.push({ action, viable: false, reason: `${def.name}: opponent has not met end-of-game conditions` });
          continue;
        }
        if (hazardPlayer.freeCouncilCalled || state.lastTurnFor !== null) {
          actions.push({ action, viable: false, reason: `${def.name}: endgame already called` });
          continue;
        }
        logDetail(`Resource-as-hazard "${def.name}" playable — opponent ${defendingPlayer.alignment} meets end-of-game conditions`);
        actions.push({ action, viable: true });
        continue;
      }

      // --- Short event ---
      if (isShortEvent) {
        // Exhalation of Decay (dm-55) and similar: these short events play a
        // creature from the discard pile via a dedicated action emitted by
        // playCreatureFromDiscardActions(). Skip the generic short-event path.
        if (getCardEffects(def).some(e => e.type === 'play-creature-from-discard')) {
          continue;
        }

        // Duplication-limit: non-viable if max copies already on chain / in play / still in effect
        {
          let blocked = false;
          for (const effect of getCardEffects(def)) {
            if (effect.type !== 'duplication-limit') continue;
            if (effect.scope !== 'game' && effect.scope !== 'turn') continue;
            const copiesOnChain = state.chain?.entries.filter(e => {
              const cDef = e.card ? defById(state, e.card.definitionId) : undefined;
              return cDef && cDef.name === def.name;
            }).length ?? 0;
            const copiesInPlay = countCopiesInPlay(state, def.name);
            // For turn-scoped duplication limits on short events, a resolved
            // copy still counts as long as it left an active constraint in
            // play (the effect persists past the card's discard).
            const constraintCopies = effect.scope === 'turn'
              ? countConstraintsFromDefinition(state, def.id)
              : 0;
            if (copiesOnChain + copiesInPlay + constraintCopies >= effect.max) {
              logDetail(`Hazard short-event "${def.name}" cannot be duplicated (${copiesOnChain} on chain, ${copiesInPlay} in play, ${constraintCopies} active)`);
              actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated` });
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
        }

        // Environment-cancelers (e.g. Twilight) need an environment target in play
        if (hasPlayFlag(def, 'playable-as-resource')) {
          const envTargets = findEnvironmentTargets(state);
          if (envTargets.length === 0) {
            logDetail(`Hazard short-event "${def.name}": no environment in play to cancel`);
            actions.push({ action, viable: false, reason: 'No environment to cancel' });
            continue;
          }
          for (const target of envTargets) {
            const targetDef = state.cardPool[target.definitionId];
            logDetail(`Hazard short-event "${def.name}": can cancel environment ${targetDef?.name ?? target.definitionId}`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId: cardInstId,
                targetInstanceId: target.instanceId,
              },
              viable: true,
            });
          }
          continue;
        }

        // Skill-cancelers (e.g. Searching Eye): on-event self-enters-play →
        // cancel-chain-entry with select:target + requiredSkill. During the
        // normal M/H hazard play window (no chain active) the card's useful
        // targets are active constraints whose source card has at least one
        // effect carrying a matching `requiredSkill`. One action is emitted
        // per eligible constraint source (the targetInstanceId is the
        // constraint's `source` — the original card that left the ongoing
        // effect behind, e.g. Stealth).
        const skillCancelEffect = def.effects?.find(
          (e): e is import('../../types/effects.js').OnEventEffect =>
            e.type === 'on-event'
            && e.event === 'self-enters-play'
            && e.apply?.type === 'cancel-chain-entry'
            && e.apply?.select === 'target'
            && typeof e.apply?.requiredSkill === 'string',
        );
        if (skillCancelEffect) {
          const requiredSkill = skillCancelEffect.apply.requiredSkill!;
          const seenSources = new Set<string>();
          const eligible: { source: import('../../index.js').CardInstanceId; name: string }[] = [];
          for (const c of state.activeConstraints) {
            if (seenSources.has(c.source as string)) continue;
            const srcDef = defById(state, c.sourceDefinitionId);
            if (!srcDef) continue;
            const hasSkill = getCardEffects(srcDef).some(
              e => (e as { requiredSkill?: string }).requiredSkill === requiredSkill,
            );
            if (!hasSkill) continue;
            seenSources.add(c.source as string);
            eligible.push({ source: c.source, name: srcDef.name ?? (c.sourceDefinitionId as string) });
          }
          if (eligible.length === 0) {
            logDetail(`Hazard short-event "${def.name}": no active ${requiredSkill}-skill ongoing effect to cancel`);
            actions.push({ action, viable: false, reason: `No ${requiredSkill}-skill ongoing effect in play` });
            continue;
          }
          for (const target of eligible) {
            logDetail(`Hazard short-event "${def.name}": can cancel ongoing effect of ${target.name}`);
            actions.push({
              action: {
                type: 'play-short-event',
                player: playerId,
                cardInstanceId: cardInstId,
                targetInstanceId: target.source,
              },
              viable: true,
            });
          }
          continue;
        }

        // Play-condition check (e.g. Two or Three Tribes Present site-path requirement)
        {
          const playCondition = getCardEffects(def).find(
            (e): e is PlayConditionEffect => e.type === 'play-condition',
          );
          if (playCondition && playCondition.requires === 'site-path') {
            if (!checkSitePathCondition(mhState, playCondition, state)) {
              logDetail(`Hazard short-event "${def.name}": site path condition not met`);
              actions.push({ action, viable: false, reason: 'Site path condition not met' });
              continue;
            }
          }

          // Creature-race-choice: generate one action per eligible race.
          // When the effect declares a `fixedRace`, emit a single action
          // with that race instead of offering a choice (e.g. Dragon's
          // Desolation — always Dragon).
          const raceChoice = getCardEffects(def).find(
            (e): e is CreatureRaceChoiceEffect => e.type === 'creature-race-choice',
          );
          if (raceChoice) {
            if (raceChoice.fixedRace) {
              logDetail(`Hazard short-event "${def.name}": playable with fixed race "${raceChoice.fixedRace}"`);
              actions.push({
                action: { ...action, chosenCreatureRace: raceChoice.fixedRace as Race },
                viable: true,
              });
            } else {
              const excludedRaces = new Set(raceChoice.exclude);
              const eligibleRaces = Object.values(Race).filter(r => !excludedRaces.has(r));
              // Restrict choices to races that actually have creature cards in the hazard
              // player's accessible piles (hand + draw deck). Offering races with no
              // creatures produces useless options and was the root cause of a misplay
              // where a player chose "spider" despite having only orc/troll creatures.
              // Fall back to all eligible races only if none are found (e.g. no-creature deck).
              const deckRaces = new Set<Race>();
              for (const pile of [player.hand, player.playDeck]) {
                for (const card of pile) {
                  const cardDef = defById(state, card.definitionId);
                  if (cardDef?.cardType === 'hazard-creature') {
                    deckRaces.add(cardDef.race);
                  }
                }
              }
              const racesToOffer = eligibleRaces.filter(r => deckRaces.has(r));
              for (const race of racesToOffer.length > 0 ? racesToOffer : eligibleRaces) {
                logDetail(`Hazard short-event "${def.name}": playable with creature race "${race}"`);
                actions.push({
                  action: { ...action, chosenCreatureRace: race },
                  viable: true,
                });
              }
            }
            continue;
          }
        }

        const shortPlayTarget = def.effects?.find(
          (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target',
        );

        // Faction-targeting short events (e.g. Muster Disperses)
        if (shortPlayTarget?.target === 'faction') {
          let hasFactionTarget = false;
          for (const p of state.players) {
            for (const cip of p.cardsInPlay) {
              const cipDef = defById(state, cip.definitionId);
              if (cipDef && isFactionCard(cipDef)) {
                logDetail(`Hazard short-event "${def.name}" playable on faction ${cipDef.name} (${cip.instanceId as string})`);
                actions.push({
                  action: { ...action, targetFactionInstanceId: cip.instanceId },
                  viable: true,
                });
                hasFactionTarget = true;
              }
            }
          }
          if (!hasFactionTarget) {
            logDetail(`Hazard short-event "${def.name}" not playable — no factions in play`);
            actions.push({ action, viable: false, reason: 'No factions in play' });
          }
          continue;
        }

        // Character-targeting short events (e.g. Call of Home): one action per eligible character
        if (shortPlayTarget?.target === 'character') {
          for (const charId of targetCompany.characters) {
            if (shortPlayTarget.filter) {
              const charData = resourcePlayer.characters[charId as string];
              if (charData) {
                const charDef = defById(state, charData.definitionId);
                if (charDef && isCharacterCard(charDef)) {
                  const possessionNames = defNamesOf(state, charData.items);
                  const itemKeywords = itemKeywordsOf(state, charData.items);
                  const itemSubtypes = itemSubtypesOf(state, charData.items);
                  const ctx = {
                    target: {
                      race: charDef.race,
                      skills: charDef.skills,
                      name: charDef.name,
                      possessions: possessionNames,
                      itemKeywords,
                      itemSubtypes,
                    },
                  };
                  if (!matchesCondition(shortPlayTarget.filter, ctx)) {
                    logDetail(`Hazard short-event "${def.name}" filter excludes ${charDef.name}`);
                    actions.push({
                      action: { ...action, targetCharacterId: charId },
                      viable: false,
                      reason: `${charDef.name} does not match play target filter`,
                    });
                    continue;
                  }
                }
              }
            }
            logDetail(`Hazard short-event "${def.name}" playable on character ${charId as string}`);
            actions.push({
              action: { ...action, targetCharacterId: charId },
              viable: true,
            });
          }
          continue;
        }

        // Ally-targeting short events (e.g. Stay Her Appetite, le-140):
        // one action per ally in any character of the target company.
        if (shortPlayTarget?.target === 'ally') {
          let hasAllyTarget = false;
          for (const charId of targetCompany.characters) {
            const charData = resourcePlayer.characters[charId as string];
            if (!charData) continue;
            for (const ally of charData.allies) {
              const allyDef = defById(state, ally.definitionId);
              const allyName = (allyDef as { name?: string })?.name ?? (ally.definitionId as string);
              logDetail(`Hazard short-event "${def.name}" playable on ally "${allyName}" (${ally.instanceId as string})`);
              actions.push({
                action: { ...action, targetAllyId: ally.instanceId },
                viable: true,
              });
              hasAllyTarget = true;
            }
          }
          if (!hasAllyTarget) {
            logDetail(`Hazard short-event "${def.name}" not playable — no allies in company`);
            actions.push({ action, viable: false, reason: 'No allies in company' });
          }
          continue;
        }

        // Site-targeting short events (e.g. Incite Defenders): apply filter on destination site
        if (shortPlayTarget?.target === 'site') {
          const destSiteInstanceId = targetCompany.destinationSite?.instanceId
            ?? targetCompany.currentSite?.instanceId
            ?? null;
          if (destSiteInstanceId) {
            const destSiteDefId = resolveInstanceId(state, destSiteInstanceId);
            if (destSiteDefId) {
              const siteDef = defById(state, destSiteDefId);
              const siteDefName = siteDef?.name ?? (destSiteDefId as string);
              if (shortPlayTarget.filter && siteDef && isSiteCard(siteDef)) {
                if (!matchesDefinition(siteDef, shortPlayTarget.filter)) {
                  logDetail(`Hazard short-event "${def.name}" site filter excludes ${siteDefName}`);
                  actions.push({
                    action: { ...action, targetSiteDefinitionId: destSiteDefId },
                    viable: false,
                    reason: `${siteDefName} does not match site filter`,
                  });
                  continue;
                }
              }
              logDetail(`Hazard short-event "${def.name}" playable on site ${siteDefName}`);
              actions.push({
                action: { ...action, targetSiteDefinitionId: destSiteDefId },
                viable: true,
              });
              continue;
            }
          }
          continue;
        }

        // Tap-agent-at-site (e.g. An Article Missing dm-43, Cunning Foes dm-50):
        // taps a scout/warrior agent at the company's new site to initiate
        // an M/H phase attack not counting against the hazard limit.
        const tapAgentEffect = def.effects?.find(
          (e): e is TapAgentEffect => e.type === 'tap-agent-at-site',
        );
        if (tapAgentEffect) {
          // Cannot play against a minion (Ringwraith/Balrog) player.
          if (isMinionOrBalrog(resourcePlayer)) {
            logDetail(`Hazard short-event "${def.name}" not playable — opponent is a minion player`);
            actions.push({ action, viable: false, reason: 'Cannot be played against a minion player' });
            continue;
          }

          // Identify the company's new (destination) site, falling back to current.
          const destSiteInst = targetCompany.destinationSite ?? targetCompany.currentSite ?? null;
          const destSiteDefId = destSiteInst
            ? resolveInstanceId(state, destSiteInst.instanceId)
            : null;
          const destSiteDef = destSiteDefId ? defById(state, destSiteDefId) : undefined;
          const destSiteName = destSiteDef && isSiteCard(destSiteDef) ? destSiteDef.name : undefined;

          if (!destSiteDefId || !destSiteName) {
            logDetail(`Hazard short-event "${def.name}" not playable — cannot resolve destination site`);
            actions.push({ action, viable: false, reason: 'No target site for agent tap' });
            continue;
          }

          // Find agents with the required skill at the destination site.
          let foundAgent = false;
          for (const agent of player.agents) {
            const agentDef = defById(state, agent.character.definitionId);
            if (!agentDef || !isCharacterCard(agentDef)) continue;

            // Skill check
            if (tapAgentEffect.skill && !agentDef.skills.includes(tapAgentEffect.skill as Skill)) continue;

            // Location check: agent must be at the destination site.
            const homesiteNames = agentDef.homesite
              ? agentDef.homesite.split(',').map((s: string) => s.trim()).filter(Boolean)
              : [];
            const isAtDest = agent.revealed
              ? (agent.siteStack.length > 0 && agent.siteStack[agent.siteStack.length - 1].definitionId === destSiteDefId)
              : (agent.siteStack.length > 0
                  ? agent.siteStack[agent.siteStack.length - 1].definitionId === destSiteDefId
                  : homesiteNames.includes(destSiteName));
            if (!isAtDest) continue;

            foundAgent = true;

            if (!agent.revealed) {
              // Face-down: offer one action per available home site card matching the destination.
              // Only the destination site is valid — other home sites of the agent are irrelevant here.
              const seenHome = new Set<string>();
              let offeredAny = false;
              for (const siteInst of player.siteDeck) {
                const siteDef = defById(state, siteInst.definitionId);
                if (!siteDef || !isSiteCard(siteDef)) continue;
                if (siteDef.name !== destSiteName) continue;
                if (seenHome.has(siteDef.name)) continue;
                seenHome.add(siteDef.name);
                logDetail(`Hazard short-event "${def.name}": can tap face-down agent ${agentDef.name} via home site "${siteDef.name}"`);
                actions.push({
                  action: { ...action, agentInstanceId: agent.character.instanceId, homeSiteInstanceId: siteInst.instanceId },
                  viable: true,
                });
                offeredAny = true;
              }
              if (!offeredAny) {
                logDetail(`Hazard short-event "${def.name}": can tap face-down agent ${agentDef.name} (no home site — will discard at EOT)`);
                actions.push({
                  action: { ...action, agentInstanceId: agent.character.instanceId },
                  viable: true,
                });
              }
            } else {
              logDetail(`Hazard short-event "${def.name}": can tap face-up agent ${agentDef.name}`);
              actions.push({
                action: { ...action, agentInstanceId: agent.character.instanceId },
                viable: true,
              });
            }
          }

          if (!foundAgent) {
            logDetail(`Hazard short-event "${def.name}" not playable — no matching agent at company's new site`);
            actions.push({ action, viable: false, reason: 'No matching agent at company\'s new site' });
          }
          continue;
        }

        // play-restriction: only-at-site-with-auto-attack (Tidings of Bold Spies)
        // Card text: "Playable on a company moving to a site with an automatic-attack."
        // The company must be moving (destinationSite !== null) AND the destination
        // site must have ≥1 auto-attack. Never fall back to currentSite — a stationary
        // company does not qualify even if its current site has auto-attacks.
        const requiresAutoAttackSite = def.effects?.some(
          (e): boolean => (e as { type: string; rule?: string }).type === 'play-restriction'
            && (e as { type: string; rule?: string }).rule === 'only-at-site-with-auto-attack',
        );
        if (requiresAutoAttackSite) {
          if (!targetCompany.destinationSite) {
            logDetail(`Hazard short-event "${def.name}" requires a moving company`);
            actions.push({ action, viable: false, reason: `${def.name} can only be played on a moving company` });
            continue;
          }
          const destSiteDef = resolveDef(state, targetCompany.destinationSite.instanceId);
          if (!destSiteDef || !isSiteCard(destSiteDef) || getActiveAutoAttacks(state, destSiteDef).length === 0) {
            logDetail(`Hazard short-event "${def.name}" requires a destination site with automatic-attacks`);
            actions.push({ action, viable: false, reason: 'Destination site has no automatic attacks' });
            continue;
          }
        }

        logDetail(`Hazard short-event "${def.name}" is playable`);
        actions.push({ action, viable: true });
        continue;
      }

      // --- Long/permanent event checks ---
      // Uniqueness: non-viable if already in play
      if (def.unique) {
        const alreadyInPlay = state.players.some(p =>
          p.cardsInPlay.some(c => c.definitionId === def.id),
        );
        if (alreadyInPlay) {
          logDetail(`Hazard event "${def.name}" is unique and already in play`);
          actions.push({ action, viable: false, reason: `${def.name} is unique and already in play` });
          continue;
        }
      }

      // Duplication-limit: non-viable if max copies already in play
      {
        let blocked = false;
        for (const effect of getCardEffects(def)) {
          if (effect.type !== 'duplication-limit') continue;
          if (effect.scope === 'game') {
            const copiesInPlay = countCopiesInPlay(state, def.name);
            if (copiesInPlay >= effect.max) {
              logDetail(`Hazard event "${def.name}" cannot be duplicated (${copiesInPlay}/${effect.max} in play)`);
              actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated` });
              blocked = true;
              break;
            }
          } else if (effect.scope === 'company') {
            // One copy per company: check if this card is already in cardsInPlay bound to the target company
            const targetCompanyId = targetCompany.id;
            const copiesOnCompany = countCompanyBoundCopies(state, def.name, targetCompanyId);
            if (copiesOnCompany >= effect.max) {
              logDetail(`Hazard event "${def.name}" cannot be duplicated on company ${targetCompanyId as string} (${copiesOnCompany}/${effect.max} in play)`);
              actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated on this company` });
              blocked = true;
              break;
            }
          }
        }
        if (blocked) continue;
      }

      // play-target DSL: permanent events / corruption cards targeting a character get one action per character
      const playTarget = def.effects?.find(
        (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target',
      );
      const isCharTargeting = playTarget?.target === 'character';
      // play-target DSL: site-targeting hazards (e.g. River) get one
      // action per candidate site. The candidate sites are the
      // destination of the active company (the obvious target) plus
      // any *current* site of any company on either side that the
      // hazard could meaningfully bind to. CoE rule wording for River
      // says "Playable on a site" with the understanding that the card
      // affects companies arriving at that location — the destination
      // of the company being attacked is the most useful target.
      const isSiteTargeting = playTarget?.target === 'site';
      if (isCharTargeting) {
        // maxCompanySize: card is only playable if the target company
        // has effective size ≤ the declared maximum (Hobbits and Orc
        // scouts count half — CoE rule 3.24, via companyEffectiveSize).
        if (playTarget.maxCompanySize !== undefined) {
          const effectiveSize = companyEffectiveSize(state, targetCompany);
          if (effectiveSize > playTarget.maxCompanySize) {
            logDetail(`Hazard "${def.name}" requires company size ≤ ${playTarget.maxCompanySize} (got ${effectiveSize})`);
            actions.push({ action, viable: false, reason: `${def.name} requires a company of size ≤ ${playTarget.maxCompanySize}` });
            continue;
          }
        }
        // Character-scoped duplication-limit: find the max copies allowed on one character
        const charDupLimit = def.effects?.find(
          (e): e is import('../../index.js').DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'character',
        );
        for (const charId of targetCompany.characters) {
          // Apply play-target filter condition (e.g. non-wizard, non-ringwraith)
          if (playTarget.filter) {
            const charData = resourcePlayer.characters[charId as string];
            if (charData) {
              const charDef = defById(state, charData.definitionId);
              if (charDef && isCharacterCard(charDef)) {
                const possessionNames = defNamesOf(state, charData.items);
                const itemKeywords = itemKeywordsOf(state, charData.items);
                const itemSubtypes = itemSubtypesOf(state, charData.items);
                const ctx = {
                  target: {
                    cardType: charDef.cardType,
                    race: charDef.race,
                    skills: charDef.skills,
                    name: charDef.name,
                    mind: charDef.mind,
                    possessions: possessionNames,
                    itemKeywords,
                    itemSubtypes,
                  },
                };
                if (!matchesCondition(playTarget.filter, ctx)) {
                  logDetail(`Hazard "${def.name}" filter excludes ${charDef.name}`);
                  actions.push({
                    action: { ...action, targetCharacterId: charId },
                    viable: false,
                    reason: `${charDef.name} does not match play target filter`,
                  });
                  continue;
                }
              }
            }
          }
          // Check character-scoped duplication limit
          if (charDupLimit) {
            const charData = resourcePlayer.characters[charId as string];
            if (charData) {
              const copiesOnChar = charData.hazards.filter(h => {
                const hDef = defById(state, h.definitionId);
                return hDef && hDef.name === def.name;
              }).length;
              if (copiesOnChar >= charDupLimit.max) {
                const charName = cardName(state, charData.definitionId, charId as string);
                logDetail(`Hazard "${def.name}" already on ${charName} (${copiesOnChar}/${charDupLimit.max})`);
                actions.push({
                  action: { ...action, targetCharacterId: charId },
                  viable: false,
                  reason: `${def.name} cannot be duplicated on ${charName}`,
                });
                continue;
              }
            }
          }
          // CoE rule 7.2.1: only one corruption card may be played per character per turn.
          // Both hazard-corruption type cards and hazard-events with the "corruption" keyword count.
          const isCorruptionCard = isCorruption || (
            'keywords' in def && (def as { keywords?: readonly string[] }).keywords?.includes('corruption') === true
          );
          if (isCorruptionCard && mhState.corruptionCardsPlayedPerChar[charId as string]) {
            const charName = cardName(state, resourcePlayer.characters[charId as string]?.definitionId, charId as string);
            logDetail(`Hazard "${def.name}" blocked on ${charName}: corruption card already played this turn (CoE 7.2.1)`);
            actions.push({
              action: { ...action, targetCharacterId: charId },
              viable: false,
              reason: `Only one corruption card may be played on ${charName} per turn`,
            });
            continue;
          }
          // Ward check: if the target character carries an item with a
          // ward-bearer effect matching this hazard (e.g. Adamant Helmet
          // vs. dark enchantments), the play is pointless — the engine
          // would cancel it on resolution, so the legal-action computer
          // doesn't offer the character as a target at all.
          if (isWardedAgainst(state, activeIndex, charId, def)) {
            const charName = cardName(state, resourcePlayer.characters[charId as string]?.definitionId, charId as string);
            logDetail(`Hazard "${def.name}" cancelled by ward on ${charName}`);
            actions.push({
              action: { ...action, targetCharacterId: charId },
              viable: false,
              reason: `${charName} is warded against ${def.name}`,
            });
            continue;
          }
          logDetail(`Hazard "${def.name}" playable on character ${charId as string}`);
          actions.push({
            action: { ...action, targetCharacterId: charId },
            viable: true,
          });
        }
      } else if (isSiteTargeting) {
        // The destination site of the active company is the canonical
        // target — that's the site the company is moving to, which is
        // exactly what River cares about.
        const destSiteInstanceId = targetCompany.destinationSite?.instanceId
          ?? targetCompany.currentSite?.instanceId
          ?? null;
        if (destSiteInstanceId) {
          const destSiteDefId = resolveInstanceId(state, destSiteInstanceId);
          if (destSiteDefId) {
            const siteDef = defById(state, destSiteDefId);
            const siteDefName = siteDef?.name ?? (destSiteDefId as string);
            // Apply play-target filter (e.g. Incite Defenders: border-hold or free-hold)
            if (playTarget.filter && siteDef && isSiteCard(siteDef)) {
              if (!matchesDefinition(siteDef, playTarget.filter)) {
                logDetail(`Hazard "${def.name}" site filter excludes ${siteDefName}`);
                actions.push({
                  action: { ...action, targetSiteDefinitionId: destSiteDefId },
                  viable: false,
                  reason: `${siteDefName} does not match site filter`,
                });
                continue;
              }
            }
            logDetail(`Hazard event "${def.name}" playable on site ${siteDefName}`);
            actions.push({
              action: { ...action, targetSiteDefinitionId: destSiteDefId },
              viable: true,
            });
          }
        }
      } else if (playTarget?.target === 'company') {
        // Company-targeting permanent hazard events: filter on alignment + siteType of target company.
        // Use destination site if the company is moving, otherwise current site.
        const destSiteInstId = targetCompany.destinationSite?.instanceId ?? targetCompany.currentSite?.instanceId ?? null;
        let compSiteType: string | null = null;
        if (destSiteInstId) {
          const compSiteDefId = resolveInstanceId(state, destSiteInstId);
          if (compSiteDefId) {
            const compSiteDef = defById(state, compSiteDefId);
            if (compSiteDef && isSiteCard(compSiteDef)) compSiteType = compSiteDef.siteType;
          }
        }
        const allyCount = targetCompany.characters.reduce((sum, cId) => {
          const ch = resourcePlayer.characters[cId as string];
          return sum + (ch ? ch.allies.length : 0);
        }, 0);
        const memberCount = targetCompany.characters.length + allyCount;
        const companyCtx = { target: { siteType: compSiteType, alignment: resourcePlayer.alignment, memberCount } };
        if (playTarget.filter && !matchesContext(playTarget.filter, companyCtx)) {
          logDetail(`Hazard "${def.name}": company filter not met (siteType=${compSiteType ?? 'none'}, alignment=${resourcePlayer.alignment})`);
          actions.push({ action, viable: false, reason: `${def.name} cannot be played on this company` });
        } else {
          logDetail(`Hazard "${def.name}" playable on company (siteType=${compSiteType ?? 'none'}, alignment=${resourcePlayer.alignment})`);
          actions.push({ action, viable: true });
        }
      } else {
        // Company-targeting permanent events (e.g. Nothing to Eat or Drink).

        // Company-scope duplication-limit: one copy per target company.
        const companyDupLimit = def.effects?.find(
          (e): e is import('../../index.js').DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'company',
        );
        if (companyDupLimit) {
          const existingCopies = countCompanyBoundCopies(state, def.name, targetCompany.id);
          if (existingCopies >= companyDupLimit.max) {
            logDetail(`Hazard event "${def.name}" already bound to target company (${existingCopies}/${companyDupLimit.max})`);
            actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated on this company` });
            continue;
          }
        }

        // Play-target filter for company-targeting events: check company.alignment
        // and company.destinationSiteType (e.g. Nothing to Eat or Drink — minion
        // company at free/border-hold, or hero company at shadow/dark-hold).
        if (playTarget?.filter) {
          const destSiteInst = targetCompany.destinationSite ?? targetCompany.currentSite ?? null;
          const destSiteDef = destSiteInst ? resolveDef(state, destSiteInst.instanceId) : undefined;
          const destSiteType = destSiteDef && isSiteCard(destSiteDef) ? destSiteDef.siteType : undefined;
          const companyCtx = {
            company: {
              alignment: resourcePlayer.alignment,
              destinationSiteType: destSiteType,
            },
          };
          if (!matchesContext(playTarget.filter, companyCtx)) {
            logDetail(`Hazard event "${def.name}" company filter not met (alignment=${resourcePlayer.alignment}, siteType=${destSiteType ?? 'unknown'})`);
            actions.push({ action, viable: false, reason: `${def.name} cannot be played against this company at this site` });
            continue;
          }
        }

        logDetail(`Hazard event "${def.name}" is playable`);
        actions.push({ action, viable: true });
      }
    }

    // --- On-guard placement ---
    // One on-guard card per company per M/H phase; any hand card is eligible (bluffing allowed).
    // Counts against hazard limit. Must not be in a chain (placement starts no chain).
    if (!mhState.onGuardPlacedThisCompany && state.chain == null) {
      for (const handCard of player.hand) {
        const ogAction: PlaceOnGuardAction = {
          type: 'place-on-guard',
          player: playerId,
          cardInstanceId: handCard.instanceId,
        };
        if (limitReached) {
          actions.push({ action: ogAction, viable: false, reason: `Hazard limit reached (${liveLimit})` });
        } else {
          logDetail(`On-guard: card ${handCard.instanceId} eligible for placement`);
          actions.push({ action: ogAction, viable: true });
        }
      }
    }

    // --- Agent hazard play ---
    // The hazard player may play agent character cards from hand as face-down
    // hazards (rule 2.IV.vii.1). One action per (agent, home-site) pair.
    actions.push(...playAgentHazardActions(state, playerId, mhState, liveLimit, limitReached));

    // --- Agent reveal ---
    // Revealing a face-down agent is not an agent action and does not cost
    // a hazard slot (rule 4.2). Legal any time during play-hazards step.
    actions.push(...revealAgentActions(state, playerId));

    // --- Agent turn actions (move, return home, heal, untap, face-down, key creatures) ---
    // Each costs 1 hazard slot (rule 9.02). Agent must have been in play at
    // start of turn and not yet acted this turn.
    actions.push(...agentTurnActions(state, playerId, limitReached, liveLimit));

    // --- Agent influence attempts (rule 10.14) ---
    // Agents with the `agent-tap-influence` effect tap (not as an agent action,
    // not against hazard limit) to make an influence attempt during M/H phase.
    actions.push(...agentInfluenceActions(state, playerId, mhState));

    // --- Agent tap attacks (e.g. The Grimburgoth dm-15) ---
    // Agents with the `agent-tap-attack` effect tap (not as an agent action,
    // not against hazard limit) to attack during M/H phase.
    actions.push(...agentTapAttackActions(state, playerId, mhState));

    // --- Power Built by Waiting (as-34): tap cardsInPlay card for +hazard limit ---
    // --- Power Built by Waiting (as-34): spend hazard limit to untap cardsInPlay card ---
    actions.push(...tapHazardCardForLimitActions(state, playerId, mhState, targetCompanyId, liveLimit));

    // --- Summons from Long Sleep (as-39): reserve a Dragon/Drake from hand (free) ---
    // --- Summons from Long Sleep (as-39): play a reserved creature (costs hazard limit) ---
    actions.push(...summonsFromLongSleepActions(state, playerId, mhState, targetCompanyId, limitReached, liveLimit));

    // --- Exhalation of Decay (dm-55): play a creature from the discard pile (no hazard limit) ---
    actions.push(...playCreatureFromDiscardActions(state, playerId, mhState, targetCompanyId));
  }

  // Rule 2.1.1: resource player may play resource permanent-events and
  // resource short-events during any phase of their turn. This covers both
  // hazard-event short-events flagged `playable-as-resource` (e.g. Twilight
  // cancelling an environment) and hero-resource-event short-events
  // (e.g. Marvels Told tapping a sage to discard a hazard long-event).
  if (isResourcePlayer) {
    actions.push(...playPermanentEventActions(state, playerId));
    actions.push(...playShortEventActions(state, playerId));
    actions.push(...heroResourceShortEventActions(state, playerId, 'movement-hazard'));
    // Granted-action constraints (Great Ship's cancel-chain-entry, etc.)
    const playerIndex = getPlayerIndex(state, playerId);
    const company = state.players[playerIndex].companies[mhState.activeCompanyIndex];
    if (company) {
      actions.push(...emitGrantedActionConstraintActions(state, playerId, company, 'movement-hazard', 'play-hazards', {
        path: mhState.resolvedSitePath,
        chain: {
          hazardCount: countUnresolvedChainHazards(state),
        },
      }));
    }
    actions.push(...grantedActionActivations(state, playerId, 'anyPhase'));
  }

  // Player who already passed gets no actions (waiting for opponent)
  const alreadyPassed = isResourcePlayer ? mhState.resourcePlayerPassed : mhState.hazardPlayerPassed;
  if (alreadyPassed) {
    logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player already passed — waiting for opponent`);
    return [];
  }

  // Pass is always available if not already passed
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });

  const agentActionTypes = new Set(['play-hazard', 'play-short-event', 'place-on-guard', 'play-agent-hazard', 'agent-move', 'agent-move-back', 'agent-return-home', 'agent-heal', 'agent-untap', 'agent-turn-face-down', 'agent-key-creatures']);
  const viableCount = actions.filter(a => a.viable && agentActionTypes.has(a.action.type)).length;
  logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player has ${viableCount} viable hazard(s), ${actions.length} total action(s)`);
  return actions;
}



/**
 * Find all environment cards currently in play or declared in the active chain.
 * Searches player cardsInPlay and unresolved chain entries.
 */
function findEnvironmentTargets(state: GameState): { instanceId: CardInstanceId; definitionId: string }[] {
  const isEnv = (defId: string): boolean => {
    const d = state.cardPool[defId];
    return !!d && 'keywords' in d
      && !!(d as { keywords?: readonly string[] }).keywords?.includes('environment');
  };
  const targets: { instanceId: CardInstanceId; definitionId: string }[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      if (isEnv(c.definitionId as string)) targets.push(c);
    }
  }
  if (state.chain) {
    for (const entry of state.chain.entries) {
      if (entry.resolved || entry.negated) continue;
      if (!entry.card) continue;
      if (isEnv(entry.card.definitionId as string)) {
        targets.push({ instanceId: entry.card.instanceId, definitionId: entry.card.definitionId as string });
      }
    }
  }
  return targets;
}

/**
 * Generate actions for the reset-hand step (CoE step 8).
 *
 * Players whose hand exceeds the base hand size must choose which cards
 * to discard. Each card in hand is offered as a `discard-card` action.
 * Players already at or below hand size get no actions.
 */
function resetHandActions(
  state: GameState,
  playerId: PlayerId,
): EvaluatedAction[] {
  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handSize = resolveHandSize(state, playerIndex);

  if (player.hand.length <= handSize) {
    logDetail(`Reset-hand: player ${player.name} at hand size (${player.hand.length}/${handSize}) — no actions`);
    return [];
  }

  const excess = player.hand.length - handSize;
  logDetail(`Reset-hand: player ${player.name} must discard ${excess} card(s) (${player.hand.length}/${handSize})`);

  return player.hand.map(handCard => ({
    action: { type: 'discard-card' as const, player: playerId, cardInstanceId: handCard.instanceId },
    viable: true,
  }));
}

/**
 * Count occurrences of each region type in a path. Returns a flat record
 * keyed by `{type}Count` so DSL conditions can reference counts directly
 * (e.g. `destinationSite.sitePath.wildernessCount >= 2`).
 */
function regionTypeCounts(path: readonly RegionType[]): Record<string, number> {
  const counts: Record<string, number> = {
    wildernessCount: 0, shadowCount: 0, darkCount: 0,
    coastalCount: 0, freeCount: 0, borderCount: 0,
  };
  for (const rt of path) {
    switch (rt) {
      case RegionType.Wilderness: counts.wildernessCount++; break;
      case RegionType.Shadow: counts.shadowCount++; break;
      case RegionType.Dark: counts.darkCount++; break;
      case RegionType.Coastal: counts.coastalCount++; break;
      case RegionType.Free: counts.freeCount++; break;
      case RegionType.Border: counts.borderCount++; break;
    }
  }
  return counts;
}

/**
 * Check whether any of the creature's region types can be keyed to the
 * site path. Each distinct type is an independent option (OR). If the
 * same type appears N times, the path must have at least N of that type.
 */
function regionTypesMatch(required: readonly RegionType[], path: readonly RegionType[]): boolean {
  const requiredCounts = new Map<RegionType, number>();
  for (const rt of required) requiredCounts.set(rt, (requiredCounts.get(rt) ?? 0) + 1);
  const pathCounts = new Map<RegionType, number>();
  for (const rt of path) pathCounts.set(rt, (pathCounts.get(rt) ?? 0) + 1);
  for (const [rt, need] of requiredCounts) {
    if ((pathCounts.get(rt) ?? 0) >= need) return true;
  }
  return false;
}

/**
 * Find all keying matches for a creature against the current company's
 * travel path and destination site. Returns one entry per distinct match.
 *
 * Active `site-type-override` / `region-type-override` constraints (e.g.
 * from Choking Shadows with Doors of Night) extend the set of eligible
 * site-type and region-type keys — the override type is tried in
 * addition to the natural type.
 */
function findCreatureKeyingMatches(
  def: CreatureCard,
  mhState: MovementHazardPhaseState,
  state: GameState,
  targetCompany: { readonly destinationSite?: { readonly instanceId: CardInstanceId } | null },
): CreatureKeyingMatch[] {
  const matches: CreatureKeyingMatch[] = [];
  const seen = new Set<string>();

  // Gather attribute-modifier overrides in scope for this company's
  // arrival. See `ActiveConstraint.kind.attribute-modifier`.
  const destSiteDefId = targetCompany.destinationSite?.instanceId
    ? resolveInstanceId(state, targetCompany.destinationSite.instanceId)
    : null;
  const overriddenRegionTypes = new Map<string, import('../../types/common.js').RegionType>();
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier' || c.kind.attribute !== 'region.type' || c.kind.op !== 'override') continue;
    const regionName = (c.kind.filter as { 'region.name'?: string } | undefined)?.['region.name'];
    if (!regionName || typeof regionName !== 'string') continue;
    if (mhState.resolvedSitePathNames.includes(regionName)) {
      overriddenRegionTypes.set(regionName, c.kind.value as import('../../types/common.js').RegionType);
    }
  }
  const effectiveRegionTypes: import('../../types/common.js').RegionType[] = [...mhState.resolvedSitePath];
  for (const rt of overriddenRegionTypes.values()) {
    if (!effectiveRegionTypes.includes(rt)) effectiveRegionTypes.push(rt);
  }
  const effectiveSiteTypes: import('../../types/common.js').SiteType[] = [];
  if (mhState.destinationSiteType) effectiveSiteTypes.push(mhState.destinationSiteType);
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'attribute-modifier' || c.kind.attribute !== 'site.type' || c.kind.op !== 'override') continue;
    const filterSiteDefId = (c.kind.filter as { 'site.definitionId'?: string } | undefined)?.['site.definitionId'];
    if (destSiteDefId === null || filterSiteDefId !== (destSiteDefId as string)) continue;
    const overrideType = c.kind.value as import('../../types/common.js').SiteType;
    if (!effectiveSiteTypes.includes(overrideType)) {
      effectiveSiteTypes.push(overrideType);
    }
  }

  const inPlayNames = buildInPlayNames(state);
  const destSiteDef = destSiteDefId ? defById(state, destSiteDefId) : undefined;
  const destSitePath = (destSiteDef && isSiteCard(destSiteDef)) ? destSiteDef.sitePath : [];
  const destSitePathCounts = regionTypeCounts(destSitePath);
  const whenContext: Record<string, unknown> = {
    inPlay: inPlayNames,
    destinationSite: { sitePath: destSitePathCounts },
  };
  // region-keying-boost environments (Withered Lands): build the candidate
  // paths once. Each is the effective path with at most one boost applied.
  const keyingBoosts = collectRegionKeyingBoosts(state);
  const candidateRegionPaths = regionPathsWithBoosts(effectiveRegionTypes, keyingBoosts);
  for (const key of def.keyedTo) {
    if (key.when && !matchesCondition(key.when, whenContext)) continue;
    // Region type matches — try the effective path plus each boosted variant.
    if (key.regionTypes && key.regionTypes.length > 0) {
      for (const candidate of candidateRegionPaths) {
        if (!regionTypesMatch(key.regionTypes, candidate)) continue;
        // Report each matching region type individually
        for (const rt of key.regionTypes) {
          if (candidate.includes(rt)) {
            const k = `region-type:${rt}`;
            if (!seen.has(k)) { seen.add(k); matches.push({ method: 'region-type', value: rt }); }
          }
        }
      }
    }
    // Region name matches
    if (key.regionNames && key.regionNames.length > 0) {
      for (const rn of key.regionNames) {
        if (mhState.resolvedSitePathNames.includes(rn)) {
          const k = `region-name:${rn}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'region-name', value: rn }); }
        }
      }
    }
    // Site type matches
    if (key.siteTypes && key.siteTypes.length > 0) {
      for (const st of effectiveSiteTypes) {
        if (key.siteTypes.includes(st)) {
          const k = `site-type:${st}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'site-type', value: st }); }
        }
      }
    }
    // Site name matches (e.g. Smaug at "The Lonely Mountain")
    if (key.siteNames && key.siteNames.length > 0 && mhState.destinationSiteName) {
      for (const sn of key.siteNames) {
        if (sn === mhState.destinationSiteName) {
          const k = `site-name:${sn}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'site-name', value: sn }); }
        }
      }
    }
    // Site keyword matches — destination site must carry at least one of the keywords.
    // Resolved from the destination site definition by name (consistent with how siteTypes
    // uses mhState.destinationSiteType). Falls back to the instance-based destSiteDef when
    // the company's destinationSite instance is already resolved.
    if (key.siteKeywords && key.siteKeywords.length > 0 && mhState.destinationSiteName) {
      const resolvedDest = (destSiteDef && isSiteCard(destSiteDef))
        ? destSiteDef
        : (Object.values(state.cardPool).find(
          c => isSiteCard(c) && c.name === mhState.destinationSiteName,
        ) as SiteCard | undefined);
      if (resolvedDest) {
        const destKeywords = resolvedDest.keywords ?? [];
        for (const kw of key.siteKeywords) {
          if (destKeywords.includes(kw)) {
            const k = `site-keyword:${kw}`;
            if (!seen.has(k)) { seen.add(k); matches.push({ method: 'site-keyword', value: kw }); }
          }
        }
      }
    }
    // Adjacent-to site keyword matches — destination site must be adjacent (under-deeps sense)
    // to any site carrying at least one of the listed keywords.
    // Looks up the destination site by name from the card pool.
    if (key.adjacentToSiteKeywords && key.adjacentToSiteKeywords.length > 0 && mhState.destinationSiteName) {
      const resolvedDest = (destSiteDef && isSiteCard(destSiteDef))
        ? destSiteDef
        : (Object.values(state.cardPool).find(
          c => isSiteCard(c) && c.name === mhState.destinationSiteName,
        ) as SiteCard | undefined);
      if (resolvedDest) {
        for (const kw of key.adjacentToSiteKeywords) {
          const kwSites = Object.values(state.cardPool).filter(
            c => isSiteCard(c) && (c.keywords ?? []).includes(kw),
          ) as SiteCard[];
          for (const kwSite of kwSites) {
            if (isUnderDeepsAdjacent(state, kwSite, resolvedDest)) {
              const k = `adjacent-to-site-keyword:${kw}`;
              if (!seen.has(k)) { seen.add(k); matches.push({ method: 'adjacent-to-site-keyword', value: kw }); }
              break;
            }
          }
        }
      }
    }
  }

  return matches;
}

/**
 * Builds the condition-matcher context for `play-condition` effects with
 * `requires: 'target-company'`. Exposes the flat list of all individual
 * home-site names from every character in the target company so that
 * card-level restrictions like "may not be played against a company
 * containing a character with Edoras as a home site" can be expressed
 * in the DSL without per-card engine branches.
 */
function buildTargetCompanyConditionContext(
  state: GameState,
  company: { readonly characters: readonly CardInstanceId[] },
  alignment?: string,
): Record<string, unknown> {
  const homeSites: string[] = [];
  for (const charInstId of company.characters) {
    const defId = resolveInstanceId(state, charInstId);
    if (!defId) continue;
    const charDef = defById(state, defId);
    if (!charDef || !isCharacterCard(charDef)) continue;
    if (charDef.homesite) {
      homeSites.push(...charDef.homesite.split(',').map(s => s.trim()));
    }
  }
  return { company: { homeSites, alignment: alignment ?? null } };
}

/**
 * If the target company's effective site (destination if moving, else
 * current) carries a `cancel-attacks` site-rule, return the site's name
 * so callers can mark creature plays non-viable and surface a reason.
 * Returns null when no such rule applies.
 */
function cancelAttacksSiteName(
  state: GameState,
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
): string | null {
  const effectiveSiteInstanceId = targetCompany.destinationSite?.instanceId
    ?? targetCompany.currentSite?.instanceId
    ?? null;
  if (!effectiveSiteInstanceId) return null;
  const siteDefId = resolveInstanceId(state, effectiveSiteInstanceId);
  if (!siteDefId) return null;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return null;
  const cancels = siteDef.effects.some(e => e.type === 'site-rule' && e.rule === 'cancel-attacks');
  return cancels ? siteDef.name : null;
}

/**
 * Check whether the target company's effective site (destination if moving,
 * else current) carries an `allow-creature-by-race` site-rule that matches
 * the given creature race. When it does, the creature's normal keying check
 * is bypassed (e.g. Geann a-Lisch: "Any Man hazard creature can be played
 * at this site.").
 */
function siteAllowsCreatureByRace(
  state: GameState,
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
  race: string,
): boolean {
  const effectiveSiteInstanceId = targetCompany.destinationSite?.instanceId
    ?? targetCompany.currentSite?.instanceId
    ?? null;
  if (!effectiveSiteInstanceId) return false;
  const siteDefId = resolveInstanceId(state, effectiveSiteInstanceId);
  if (!siteDefId) return false;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return false;
  return siteDef.effects.some(
    e => e.type === 'site-rule' && e.rule === 'allow-creature-by-race'
      && 'race' in e && e.race === race,
  );
}

/** Build a human-readable keying requirement string for error messages. */
function describeKeyingRequirement(def: CreatureCard): string {
  const keyDesc = def.keyedTo.map(k => {
    const parts: string[] = [];
    if (k.regionTypes?.length) parts.push(k.regionTypes.join('/'));
    if (k.regionNames?.length) parts.push(k.regionNames.join('/'));
    if (k.siteTypes?.length) parts.push(k.siteTypes.join('/'));
    if (k.siteNames?.length) parts.push(k.siteNames.join('/'));
    if (k.siteKeywords?.length) parts.push(`site-keyword:${k.siteKeywords.join('/')}`);
    if (k.adjacentToSiteKeywords?.length) parts.push(`adjacent-to:${k.adjacentToSiteKeywords.join('/')}`);
    return parts.join(', ');
  }).join(' or ');
  return `Not keyable (requires ${keyDesc})`;
}

/**
 * Generate legal actions during the deck exhaust exchange sub-flow.
 * The player may exchange up to 5 cards between discard and sideboard,
 * then pass to complete the reshuffle.
 */
export function deckExhaustExchangeActions(
  state: GameState,
  player: { readonly discardPile: readonly import('../../index.js').CardInstance[]; readonly sideboard: readonly import('../../index.js').CardInstance[]; readonly deckExhaustExchangeCount: number },
  playerId: PlayerId,
): GameAction[] {
  const actions: GameAction[] = [];
  const MAX_EXCHANGES = 5;

  if (player.deckExhaustExchangeCount < MAX_EXCHANGES
    && player.discardPile.length > 0
    && player.sideboard.length > 0) {
    // Generate one exchange action per (discard, sideboard) pair
    for (const discardCard of player.discardPile) {
      for (const sideboardCard of player.sideboard) {
        actions.push({
          type: 'exchange-sideboard',
          player: playerId,
          discardCardInstanceId: discardCard.instanceId,
          sideboardCardInstanceId: sideboardCard.instanceId,
        });
      }
    }
  }

  // Pass is always available (0 exchanges is fine)
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Check whether a creature's race is exempted from the hazard limit by
 * a `creature-type-no-hazard-limit` active constraint on the target company.
 */
function isCreatureRaceExemptFromLimit(
  state: GameState,
  companyId: CompanyId,
  race: string,
): boolean {
  if (!state.activeConstraints) return false;
  return state.activeConstraints.some(
    c => c.target.kind === 'company'
      && c.target.companyId === companyId
      && c.kind.type === 'creature-type-no-hazard-limit'
      && c.kind.exemptRace === race,
  );
}

/**
 * Check whether a creature's race is whitelisted by an active
 * `creature-keying-bypass` constraint on the target company with at
 * least one remaining use. Used by Dragon's Desolation Mode B to allow
 * a Dragon creature that would otherwise fail its path-keying check.
 */
function hasCreatureKeyingBypass(
  state: GameState,
  companyId: CompanyId,
  race: string,
): boolean {
  if (!state.activeConstraints) return false;
  return state.activeConstraints.some(
    c => c.target.kind === 'company'
      && c.target.companyId === companyId
      && c.kind.type === 'creature-keying-bypass'
      && c.kind.race === race
      && c.kind.remainingPlays > 0,
  );
}

/**
 * Evaluate a play-condition effect with `requires: 'site-path'` against
 * the current M/H phase state. Builds a context with:
 *
 * - `sitePath.*Count` — region-type counts from the resolved site path.
 * - `destinationSiteType` — the site type of the destination (e.g.
 *   `ruins-and-lairs`), enabling cards like Dragon's Desolation Mode B
 *   that gate on both path composition and destination site type.
 * - `inPlay` — names of all cards currently in play for both players,
 *   matching the shared `inPlay` condition semantics (e.g. Doors of
 *   Night as an alt-keying modifier).
 */
function checkSitePathCondition(
  mhState: MovementHazardPhaseState,
  effect: PlayConditionEffect,
  state?: GameState,
): boolean {
  const ctx: Record<string, unknown> = { sitePath: regionTypeCounts(mhState.resolvedSitePath) };
  if (mhState.destinationSiteType) {
    ctx['destinationSiteType'] = mhState.destinationSiteType;
  }
  // Expose the destination region type (the region the destination site sits
  // in) so play conditions can gate on it (e.g. Choking Shadows Mode B2).
  if (mhState.resolvedSitePath.length > 0) {
    ctx['destinationRegionType'] = mhState.resolvedSitePath[mhState.resolvedSitePath.length - 1];
  }
  if (state) {
    const inPlayNames: string[] = [];
    for (const p of state.players) {
      for (const c of p.cardsInPlay) {
        const d = defById(state, c.definitionId);
        if (d && 'name' in d) inPlayNames.push((d as { name: string }).name);
      }
    }
    ctx['inPlay'] = inPlayNames;
  }
  return effect.condition ? matchesCondition(effect.condition, ctx) : true;
}

// mhWoundCorruptionCheckActions removed: wound corruption checks are
// now produced via the unified pending-resolution system. See
// `legal-actions/pending.ts` (corruptionCheckActions) and
// `engine/pending-reducers.ts` (applyCorruptionCheckResolution).
