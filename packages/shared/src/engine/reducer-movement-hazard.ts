/**
 * @module reducer-movement-hazard
 *
 * Movement/Hazard phase handlers for the game reducer. Covers company selection,
 * site revelation, hazard play, creature keying, on-guard placement, draw cards,
 * and hand reset sub-steps.
 */

import type { GameState, MovementHazardPhaseState, Company, CreatureCard, GameAction, CombatState, CharacterInPlay, AgentInPlay, SiteInPlay, CardDefinition, PlayHazardAction, SiteCard } from '../index.js';
import type { AhuntAttackEffect, CallCouncilEffect, TapAgentEffect, AgentTapInfluenceEffect, AgentTapAttackEffect, HazardLimitSwapEffect, RegionKeyingBoostEffect } from '../types/effects.js';
import type { TapHazardCardForLimitAction, PayHazardLimitToUntapCardAction, TapAllyDiscardHazardAction } from '../types/actions-movement-hazard.js';
import { triggerCouncilCall } from './reducer-end-of-turn.js';
import type { CardInstanceId, CompanyId } from '../types/common.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { buildMovementMap, getReachableSites } from '../movement-map.js';
import { BASE_MAX_REGION_DISTANCE } from '../rules/definitions/movement.js';
import { getPlayerIndex, isMinionOrBalrog, requirePhaseState } from '../state-utils.js';
import { isCharacterCard, isAllyCard, isFactionCard, isSiteCard, isResourceEventCard } from '../types/cards.js';
import { CardStatus, RegionType, Race, Skill, Alignment } from '../types/common.js';
import { ZERO_EFFECTIVE_STATS } from '../types/state-cards.js';
import { Phase } from '../types/state-phases.js';
import { resolveHandSize, collectCharacterEffects, resolveDrawModifier } from './effects/index.js';
import { resolveAttackProwess, resolveAttackStrikes, getItemGrantedSkills } from './effects/resolver.js';
import type { ResolverContext } from './effects/index.js';
import { matchesCondition, matchesContext } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { initiateChain, initiateOrPushChain } from './chain-reducer.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { controlCostOf } from './control-cost.js';
import { autoMergeNonHavenCompanies, cardName, companyEffectiveSize, characterEntries, cleanupEmptyCompanies, clonePlayers, companyById, completeDeckExhaust, defById, findById, getCardEffects, getOnEventEffects, handleExchangeSideboard, hazardPlayer, playerById, removeById, startDeckExhaust, toCardInstance, updateCharacter, updatePlayer, wrongActionType, roll2d6, diceRollEffect, effectiveGeneralInfluence, parseHomesiteNames } from './reducer-utils.js';
import { handlePlayShortEvent, handlePlayResourceShortEvent, handlePlayPermanentEvent } from './reducer-events.js';
import { handleGrantActionApply, handlePlayCharacter } from './reducer-organization.js';
import { sweepExpired, addConstraint, enqueueCorruptionCheck, enqueueResolution } from './pending.js';
import { allyEffectiveMind } from './ally-stats.js';
import { availableDI } from './legal-actions/organization.js';
import { resolveAdjacency } from './legal-actions/organization-companies.js';
import { crossAlignmentInfluencePenalty } from '../alignment-rules.js';
import { buildInPlayNames, applyRegionMovementReduction } from './recompute-derived.js';
import { collectRegionKeyingBoosts, regionPathsWithBoosts } from './region-keying.js';
import { isDetainmentAttack } from './detainment.js';


/**
 * Handle actions during the Movement/Hazard phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the Site phase.
 */
type MHHandler = (state: GameState, action: GameAction, mhState: MovementHazardPhaseState) => ReducerResult;

/**
 * Per-step dispatch for the Movement/Hazard phase. Pending wound corruption
 * checks (Barrow-wight et al.) are intercepted by the unified
 * pending-resolution dispatcher before this table is consulted.
 */
const MH_STEP_HANDLERS: Readonly<Record<MovementHazardPhaseState['step'], MHHandler>> = {
  'select-company': handleSelectCompany,
  'reveal-new-site': handleRevealNewSite,
  'under-deeps-roll': handleUnderDeepsRoll,
  'set-hazard-limit': handleSetHazardLimit,
  'order-effects': handleOrderEffectsStep,
  'draw-cards': handleDrawCards,
  'play-hazards': handlePlayHazards,
  'reset-hand': handleResetHand,
};

export function handleMovementHazard(state: GameState, action: GameAction): ReducerResult {
  const mhState = requirePhaseState(state, Phase.MovementHazard);
  const handler = MH_STEP_HANDLERS[mhState.step];
  if (!handler) return { state, error: `Unexpected step '${mhState.step as string}' in movement/hazard phase` };
  return handler(state, action, mhState);
}

/**
 * Snapshot the hazard limit and immediately process order-effects,
 * bypassing both the set-hazard-limit and order-effects interactive steps.
 *
 * Called from every transition point that previously set step: 'set-hazard-limit'.
 * The supplied `mhState` must already have all path/site fields populated
 * (destinationSiteType, destinationSiteName, movementType, resolvedSitePath, etc.);
 * this function computes hazardLimitAtReveal, sets step to 'order-effects',
 * and delegates to handleOrderEffects which either initiates ahunt combat or
 * advances straight to draw-cards.
 */
function enterSetHazardLimitAndAutoAdvance(
  state: GameState,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activeIndex].companies[mhState.activeCompanyIndex];
  const { limit, preRevealConstraintIds } = snapshotHazardLimit(state, company);
  logDetail(`Movement/Hazard: hazard limit snapshot ${limit} → auto-advancing through set-hazard-limit and order-effects`);
  const orderEffectsMhState: MovementHazardPhaseState = {
    ...mhState,
    step: 'order-effects' as const,
    hazardLimitAtReveal: limit,
    preRevealHazardLimitConstraintIds: preRevealConstraintIds,
  };
  return handleOrderEffects(state, orderEffectsMhState);
}

/**
 * Auto-advance through the order-effects step.
 *
 * Called when the state lands on order-effects with no active combat —
 * specifically after each ahunt combat resolves — to immediately process
 * the next ahunt or transition to draw-cards without requiring a player pass.
 * Exported so reducer.ts can apply it as a post-combat-resolution hook.
 */
export function autoAdvanceMHOrderEffects(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  logDetail(`Movement/Hazard: auto-advancing through order-effects (post-ahunt or initial entry)`);
  return handleOrderEffects(state, mhState);
}

/** @deprecated No longer reachable; set-hazard-limit is now auto-advanced. Kept for step dispatch map. */
function handleSetHazardLimit(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass', 'set-hazard-limit step');
  return enterSetHazardLimitAndAutoAdvance(state, mhState);
}

/** Advance from the order-effects step once the hazard player passes. */
function handleOrderEffectsStep(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'pass') return wrongActionType(state, action, 'pass', 'order-effects step');
  return handleOrderEffects(state, mhState);
}

/**
 * Handle actions during the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events (and eventually creatures,
 * short-events, permanent-events, on-guard cards) up to the hazard limit.
 * Both players may pass; the company's M/H phase ends when both have passed.
 * If the hazard player takes an action after the resource player passed,
 * the resource player's pass is reset.
 */
function handlePlayHazards(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const isResourcePlayer = action.player === state.activePlayer;

  // --- Pass ---
  if (action.type === 'pass') {
    const newMhState = {
      ...mhState,
      ...(isResourcePlayer
        ? { resourcePlayerPassed: true }
        : { hazardPlayerPassed: true }),
    };

    // Both passed → fire end-of-MH corruption triggers, then end this company's M/H phase
    if (newMhState.resourcePlayerPassed && newMhState.hazardPlayerPassed) {
      const withChecks = fireEndOfCompanyMHCorruptionChecks(state, newMhState);
      return endCompanyMH(withChecks, newMhState);
    }

    logDetail(`Play-hazards: ${isResourcePlayer ? 'resource' : 'hazard'} player passed`);
    return { state: { ...state, phaseState: newMhState } };
  }

  // --- Play hazard ---
  if (action.type === 'play-hazard') {
    return handlePlayHazardCard(state, action, mhState);
  }

  // --- Play agent as hazard ---
  if (action.type === 'play-agent-hazard') {
    return handlePlayAgentHazard(state, action, mhState);
  }

  // --- Reveal face-down agent (no hazard slot cost) ---
  if (action.type === 'reveal-agent') {
    return handleRevealAgent(state, action);
  }

  // --- Tap an ally to discard an attached hazard permanent-event (le-153) ---
  if (action.type === 'tap-ally-discard-hazard') {
    return handleTapAllyDiscardHazard(state, action, mhState);
  }

  // --- Agent turn actions (each costs 1 hazard slot) ---
  if (action.type === 'agent-move') return handleAgentMove(state, action, mhState);
  if (action.type === 'agent-move-back') return handleAgentMoveBack(state, action, mhState);
  if (action.type === 'agent-return-home') return handleAgentReturnHome(state, action, mhState);
  if (action.type === 'agent-heal') return handleAgentHeal(state, action, mhState);
  if (action.type === 'agent-untap') return handleAgentUntap(state, action, mhState);
  if (action.type === 'agent-turn-face-down') return handleAgentTurnFaceDown(state, action, mhState);
  if (action.type === 'agent-key-creatures') return handleAgentKeyCreatures(state, action, mhState);
  if (action.type === 'agent-influence-attempt') return handleAgentInfluenceAttempt(state, action, mhState);
  if (action.type === 'agent-tap-attack') return handleAgentTapAttack(state, action, mhState);

  // --- Tap cardsInPlay hazard permanent event for +1 hazard limit (Power Built by Waiting) ---
  if (action.type === 'tap-hazard-card-for-limit') return handleTapHazardCardForLimit(state, action, mhState);

  // --- Pay hazard limit to untap a cardsInPlay hazard permanent event (Power Built by Waiting) ---
  if (action.type === 'pay-hazard-limit-to-untap-card') return handlePayHazardLimitToUntapCard(state, action, mhState);

  // --- Reserve a Dragon/Drake creature in the Summons from Long Sleep (as-39) slot ---
  if (action.type === 'reserve-creature') return handleReserveCreature(state, action, mhState);

  // --- Play a reserved creature from the Summons from Long Sleep (as-39) slot ---
  if (action.type === 'play-reserved-creature') return handlePlayReservedCreature(state, action, mhState);

  // --- Play a creature from the discard pile (Exhalation of Decay, dm-55) ---
  if (action.type === 'play-creature-from-discard') return handlePlayCreatureFromDiscard(state, action, mhState);

  // For all resource-player actions below: after the action resolves,
  // reset hazardPlayerPassed so the hazard player may resume (rule 5.27).
  let result: ReducerResult;

  // --- Character-recruitment event (A Chance Meeting tw-188): bring a
  //     character into play during M/H. Routed to the shared play-character
  //     reducer, which discards the enabling event and skips the
  //     one-character-per-turn bookkeeping. ---
  if (action.type === 'play-character' && action.viaEventInstanceId) {
    result = handlePlayCharacter(state, action);
  }

  // --- Resource permanent event (e.g. Gates of Morning, rule 2.1.1) ---
  else if (action.type === 'play-permanent-event') {
    result = handlePlayPermanentEvent(state, action);
  }

  // --- Short event ---
  // Route by card type: resource short-events (hero or minion, e.g.
  // Marvels Told, Voices of Malice) go through the resource handler so
  // their tap cost and discard-in-play target resolve inline. Hazard
  // short-events (e.g. Twilight canceling an environment) go through
  // the chain-initiating hazard handler.
  else if (action.type === 'play-short-event') {
    const actingPlayer = playerById(state, action.player);
    const handCard = actingPlayer?.hand.find(c => c.instanceId === action.cardInstanceId);
    const def = handCard ? defById(state, handCard.definitionId) : undefined;
    if (isResourceEventCard(def)) {
      result = handlePlayResourceShortEvent(state, action);
    } else {
      result = handlePlayShortEvent(state, action);
    }
  }

  // --- Granted-action (e.g. Cram untap-bearer; Great Ship
  //     cancel-chain-entry; River ranger-cancel — all via the shared
  //     handler that resolves the apply from either the source card's
  //     grant-action effect or an active granted-action constraint). ---
  else if (action.type === 'activate-granted-action') {
    result = handleGrantActionApply(state, action);
  }

  // --- Place on-guard ---
  else if (action.type === 'place-on-guard') {
    result = handlePlaceOnGuard(state, action, mhState);
  }

  else {
    return { state, error: `Unexpected action '${action.type}' during play-hazards step` };
  }

  // Rule 5.27: if the resource player took an action, the hazard player's
  // prior pass is cleared — they may resume playing hazards.
  if (isResourcePlayer && !result.error) {
    const ps = result.state.phaseState;
    if (ps.phase === Phase.MovementHazard && ps.hazardPlayerPassed) {
      logDetail(`Play-hazards: resource player acted → resetting hazard player's pass (rule 5.27)`);
      result = { ...result, state: { ...result.state, phaseState: { ...ps, hazardPlayerPassed: false } } };
    }
  }

  return result;
}


/**
 * Generate a unique CompanyId for a new agent in-play record.
 *
 * Uses an "agent-" prefix namespace (different from "company-") so that
 * `SelectCompanyAction` can distinguish agents from companies if needed in the
 * future, while still being a valid `CompanyId` for existing action routing.
 */
function nextAgentId(player: { readonly agents: readonly AgentInPlay[] }): CompanyId {
  const maxIdx = player.agents.reduce((max, a) => {
    const match = (a.id as string).match(/agent-.*-(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, -1);
  return `agent-${player.agents.length}-${maxIdx + 1}` as CompanyId;
}

/**
 * Handle the `play-agent-hazard` action during the play-hazards step.
 *
 * Removes the agent character from hand and the chosen home site from the
 * hazard player's site deck. Creates a face-down `AgentInPlay` with the site
 * as the initial stack entry. Increments the hazard count.
 */
function handlePlayAgentHazard(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'play-agent-hazard') return wrongActionType(state, action, 'play-agent-hazard');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  const agentHandCard = findById(hazardPlayer.hand, action.agentCardInstanceId);
  if (!agentHandCard) return { state, error: 'Agent card not in hand' };

  const agentDef = defById(state, agentHandCard.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent card definition not found' };

  logDetail(`Play agent hazard: "${agentDef.name}" (${agentHandCard.instanceId as string}) — placed face-down, site chosen at reveal (${mhState.hazardsPlayedThisCompany + 1} hazards played)`);

  const agentChar: CharacterInPlay = {
    instanceId: agentHandCard.instanceId,
    definitionId: agentHandCard.definitionId,
    status: CardStatus.Untapped,
    items: [],
    allies: [],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: ZERO_EFFECTIVE_STATS,
  };

  const agentInPlay: AgentInPlay = {
    id: nextAgentId(hazardPlayer),
    character: agentChar,
    revealed: false,
    siteStack: [],
    remainingActions: 0,
    inPlayAtTurnStart: false,
    attackedThisSitePhase: false,
    discardAtEndOfTurn: false,
  };

  const newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    hand: removeById(p.hand, action.agentCardInstanceId),
    agents: [...p.agents, agentInPlay],
  }));

  return {
    state: {
      ...newState,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        resourcePlayerPassed: false,
      },
    },
  };
}

/**
 * Check whether a single movement hop between two site names is legal.
 *
 * Returns `true` if the sites are adjacent by starter or region movement
 * (within the 4-region default limit). Used when revealing an agent to
 * validate the site stack's movement history.
 *
 * Revealing at a home site is not movement (rule 9.04); callers skip
 * the check for a stack of size 1.
 */
function isLegalMovementHop(
  state: GameState,
  fromSiteName: string,
  toSiteName: string,
  alignment: Alignment,
): boolean {
  // Restrict the map and candidate sites to the moving (agent owner's)
  // alignment so same-named sites of other sides don't create phantom hops.
  const movementMap = buildMovementMap(state.cardPool, alignment);
  const allSites = Object.values(state.cardPool).filter(
    (s): s is SiteCard => isSiteCard(s) && s.alignment === alignment,
  );
  const fromDef = allSites.find(s => s.name === fromSiteName);
  if (!fromDef) return false;
  const reachable = getReachableSites(movementMap, fromDef, allSites);
  return reachable.some(r => r.site.name === toSiteName);
}

/**
 * Handle the `reveal-agent` action during the play-hazards step.
 *
 * Revealing does not cost a hazard slot. The engine:
 * 1. Places the chosen home site (from the location deck) as the agent's
 *    current site (rule 9.04). The site is removed from the location deck.
 * 2. Validates movement legality of the complete site stack (rule 4.2.1).
 *    Revealing at the home site with an empty prior stack is always legal.
 *    If any hop is illegal, the agent and home site are discarded.
 * 3. Sets `revealed = true`, returns earlier stack sites to the location deck.
 * 4. Checks uniqueness: if a face-up unique character/agent with the
 *    same definitionId already exists, the newly-revealed agent is
 *    discarded (rule 4.2.3), and the home site is returned to the deck.
 */
function handleRevealAgent(state: GameState, action: GameAction): ReducerResult {
  if (action.type !== 'reveal-agent') return wrongActionType(state, action, 'reveal-agent');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  if (agent.revealed) return { state, error: 'Agent is already revealed' };

  const agentDef = defById(state, agent.character.definitionId);
  const agentName = agentDef?.name ?? String(agent.character.definitionId);

  // --- No home site available: reveal without site, discard at end of turn (rule 9.04) ---
  if (!action.homeSiteInstanceId) {
    logDetail(`Reveal agent: ${agentName} (${agent.id as string}) — no home site available, will be discarded at end of turn`);
    const revealedAgent: AgentInPlay = {
      ...agent,
      revealed: true,
      siteStack: [],
      discardAtEndOfTurn: true,
    };
    return {
      state: updatePlayer(state, hazardIndex, p => ({
        ...p,
        agents: p.agents.map((a, i) => i === agentIdx ? revealedAgent : a),
        // Return any prior stack sites to deck (they were never in play)
        siteDeck: [...p.siteDeck, ...agent.siteStack],
      })),
    };
  }

  // Pick the home site from the location deck
  const homeSiteCard = hazardPlayer.siteDeck.find(s => s.instanceId === action.homeSiteInstanceId);
  if (!homeSiteCard) return { state, error: 'Home site not in location deck' };
  const homeSiteDef = defById(state, homeSiteCard.definitionId);

  const homeSiteName = homeSiteDef && isSiteCard(homeSiteDef) ? homeSiteDef.name : String(homeSiteCard.definitionId);
  logDetail(`Reveal agent: ${agentName} (${agent.id as string}) at home site "${homeSiteName}", prior stack length ${agent.siteStack.length}`);

  // Build the full site stack with the home site appended as the new current site
  const homeSiteEntry: AgentInPlay['siteStack'][0] = {
    instanceId: homeSiteCard.instanceId,
    definitionId: homeSiteCard.definitionId,
    status: CardStatus.Untapped,
  };
  const fullStack = [...agent.siteStack, homeSiteEntry];

  // --- Step 1: Validate movement history ---
  // Revealing at home site with empty prior stack is not movement (rule 9.04).
  let movementLegal = true;
  for (let i = 0; i < fullStack.length - 1; i++) {
    const fromDef = state.cardPool[fullStack[i].definitionId as string];
    const toDef = state.cardPool[fullStack[i + 1].definitionId as string];
    if (!fromDef || !toDef || !isSiteCard(fromDef) || !isSiteCard(toDef)) {
      logDetail(`Agent reveal: site definition missing at stack index ${i} — treating as illegal`);
      movementLegal = false;
      break;
    }
    if (!isLegalMovementHop(state, fromDef.name, toDef.name, hazardPlayer.alignment)) {
      logDetail(`Agent reveal: illegal hop ${fromDef.name} → ${toDef.name} — discarding agent`);
      movementLegal = false;
      break;
    }
  }

  // --- Rule 9.07: Discard if any site in the movement path is a Haven ---
  // An agent revealed with a Haven site anywhere in its prior siteStack is
  // immediately discarded (the agent moved through a restricted site).
  // Note: movement TO haven sites is already blocked in agentTurnActions.
  if (movementLegal && agent.siteStack.length > 0) {
    for (const stackEntry of agent.siteStack) {
      const stackDef = defById(state, stackEntry.definitionId);
      if (stackDef && isSiteCard(stackDef) && stackDef.siteType === 'haven') {
        logDetail(`Agent ${agentName}: discarded — moved through Haven site "${stackDef.name}" (rule 9.07)`);
        movementLegal = false;
        break;
      }
    }
  }

  // --- Discard path: return all sites to deck, put character in discard ---
  if (!movementLegal) {
    logDetail(`Agent ${agentName}: discarded due to illegal movement history`);
    return {
      state: updatePlayer(state, hazardIndex, p => ({
        ...p,
        agents: p.agents.filter((_, i) => i !== agentIdx),
        discardPile: [...p.discardPile, toCardInstance(agent.character)],
        // Return old stack sites + home site to deck
        siteDeck: removeById([...p.siteDeck, ...agent.siteStack], homeSiteCard.instanceId),
      })),
    };
  }

  // --- Step 2: Check uniqueness ---
  const isUnique = agentDef && 'unique' in agentDef && (agentDef as { unique?: boolean }).unique === true;
  if (isUnique) {
    let duplicate = false;
    for (const player of state.players) {
      for (const char of Object.values(player.characters)) {
        if (char.definitionId === agent.character.definitionId) { duplicate = true; break; }
      }
      if (duplicate) break;
      for (const a of player.agents) {
        if (a.revealed && a.id !== agent.id && a.character.definitionId === agent.character.definitionId) {
          duplicate = true; break;
        }
      }
      if (duplicate) break;
    }
    if (duplicate) {
      logDetail(`Agent ${agentName}: discarded due to uniqueness conflict`);
      return {
        state: updatePlayer(state, hazardIndex, p => ({
          ...p,
          agents: p.agents.filter((_, i) => i !== agentIdx),
          discardPile: [...p.discardPile, toCardInstance(agent.character)],
          // Return old stack sites + home site to deck
          siteDeck: removeById([...p.siteDeck, ...agent.siteStack], homeSiteCard.instanceId),
        })),
      };
    }
  }

  // --- Step 3: Reveal — current site = home site, return earlier stack sites to deck ---
  const returnedSites = agent.siteStack; // all prior sites go back (they were never in play)
  const revealedAgent: AgentInPlay = {
    ...agent,
    revealed: true,
    siteStack: [homeSiteEntry],
  };

  logDetail(`Agent ${agentName}: revealed at "${homeSiteName}", returning ${returnedSites.length} earlier site(s) to deck`);

  return {
    state: updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map((a, i) => i === agentIdx ? revealedAgent : a),
      // Remove home site from deck; return all prior stack sites
      siteDeck: [...removeById(p.siteDeck, homeSiteCard.instanceId), ...returnedSites],
    })),
  };
}

/**
 * Count the total extra agent actions granted by `extra-agent-actions` effects
 * currently in play across all players (e.g. Great Need or Purpose).
 * Exported so legal-actions can reuse the same logic.
 */
export function countExtraAgentActions(state: GameState): number {
  return state.players.reduce((sum, p) =>
    sum + p.cardsInPlay.reduce((s, card) =>
      s + getCardEffects(defById(state, card.definitionId)).reduce(
        (n, e) => e.type === 'extra-agent-actions' ? n + ((e as { value?: number }).value ?? 0) : n, 0,
      ),
    0),
  0);
}

/**
 * Shared helper: charge a hazard slot for an agent action (unless it is an
 * extra action granted by an effect like Great Need or Purpose, which is free).
 *
 * Rule: only the agent's BASE action costs a hazard slot. Extra actions
 * (remainingActions <= extraAgentActions before decrement) are free.
 */
function chargeAgentAction(mhState: MovementHazardPhaseState, isExtraAction: boolean): MovementHazardPhaseState {
  return {
    ...mhState,
    hazardsPlayedThisCompany: isExtraAction ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1,
    resourcePlayerPassed: false,
  };
}

/**
 * Shared helper: update one agent in the hazard player's agents array.
 */
function updateAgent(
  state: GameState,
  hazardIndex: number,
  agentIdx: number,
  updater: (a: AgentInPlay) => AgentInPlay,
): GameState {
  return updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i === agentIdx ? updater(a) : a),
  }));
}

/**
 * Handle `agent-move`: move agent to an adjacent site from its location deck.
 *
 * Pushes destination site onto `siteStack`, taps agent, increments hazard count.
 */
function handleAgentMove(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-move') return wrongActionType(state, action, 'agent-move');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const destCard = findById(hazardPlayer.siteDeck, action.destinationSiteInstanceId);
  if (!destCard) return { state, error: 'Destination site not in location deck' };

  const destDef = defById(state, destCard.definitionId);
  const destName = destDef && isSiteCard(destDef) ? destDef.name : String(destCard.definitionId);
  logDetail(`Agent ${action.agentId as string}: moving to "${destName}"`);

  const destEntry: SiteInPlay = {
    instanceId: destCard.instanceId,
    definitionId: destCard.definitionId,
    status: CardStatus.Untapped,
  };

  const agentBeforeMove = hazardPlayer.agents[agentIdx];
  const isExtraMove = agentBeforeMove.remainingActions <= countExtraAgentActions(state);

  const newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i !== agentIdx ? a : {
      ...a,
      character: { ...a.character, status: CardStatus.Tapped },
      siteStack: [...a.siteStack, destEntry],
      remainingActions: a.remainingActions - 1,
    }),
    siteDeck: removeById(p.siteDeck, destCard.instanceId),
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraMove) } };
}

/**
 * Handle `agent-move-back`: move agent one step back along its site stack.
 *
 * Pops the top site from `siteStack` (returning it to location deck), taps agent.
 */
function handleAgentMoveBack(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-move-back') return wrongActionType(state, action, 'agent-move-back');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  if (agent.siteStack.length <= 1) return { state, error: 'Cannot move back: no prior site in stack' };

  const topSite = agent.siteStack[agent.siteStack.length - 1];
  const backDef = state.cardPool[agent.siteStack[agent.siteStack.length - 2].definitionId as string];
  const backName = backDef && isSiteCard(backDef) ? backDef.name : 'previous site';
  logDetail(`Agent ${action.agentId as string}: moving back to "${backName}", returning ${topSite.instanceId as string} to deck`);

  const isExtraMoveBack = agent.remainingActions <= countExtraAgentActions(state);
  const newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i !== agentIdx ? a : {
      ...a,
      character: { ...a.character, status: CardStatus.Tapped },
      siteStack: a.siteStack.slice(0, -1),
      remainingActions: a.remainingActions - 1,
    }),
    siteDeck: [...p.siteDeck, topSite],
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraMoveBack) } };
}

/**
 * Handle `agent-return-home`: return agent to a home site, clearing the site stack.
 *
 * All current siteStack entries are returned to location deck; chosen home site becomes sole entry.
 * Taps agent.
 */
/**
 * Handle `agent-return-home`: return agent to its home site.
 *
 * All siteStack entries are returned to the location deck. Does NOT tap
 * the agent (rule 4.1). For face-down agents, siteStack becomes empty.
 * For face-up agents, the chosen home site card is placed with the agent.
 */
function handleAgentReturnHome(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-return-home') return wrongActionType(state, action, 'agent-return-home');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];

  if (agent.revealed) {
    // Face-up: home site card must be placed with agent
    const homeCard = hazardPlayer.siteDeck.find(s => s.instanceId === action.homeSiteInstanceId);
    if (!homeCard) return { state, error: 'Home site not in location deck (required for face-up agent)' };

    const homeDef = defById(state, homeCard.definitionId);
    const homeName = homeDef && isSiteCard(homeDef) ? homeDef.name : String(homeCard.definitionId);
    logDetail(`Agent ${action.agentId as string}: returning home (face-up) to "${homeName}", returning ${agent.siteStack.length} site(s) to deck`);

    const homeSiteEntry: SiteInPlay = {
      instanceId: homeCard.instanceId,
      definitionId: homeCard.definitionId,
      status: CardStatus.Untapped,
    };

    const isExtraReturnFaceUp = agent.remainingActions <= countExtraAgentActions(state);
    const newState = updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map((a, i) => i !== agentIdx ? a : {
        ...a,
        siteStack: [homeSiteEntry],
        remainingActions: a.remainingActions - 1,
        // does NOT tap (rule 4.1)
      }),
      siteDeck: [...removeById(p.siteDeck, homeCard.instanceId), ...agent.siteStack],
    }));
    return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraReturnFaceUp) } };
  }

  // Face-down: siteStack becomes empty, no site card needed
  logDetail(`Agent ${action.agentId as string}: returning home (face-down), returning ${agent.siteStack.length} site(s) to deck`);

  const isExtraReturnFaceDown = agent.remainingActions <= countExtraAgentActions(state);
  const newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.map((a, i) => i !== agentIdx ? a : {
      ...a,
      siteStack: [],
      remainingActions: a.remainingActions - 1,
      // does NOT tap (rule 4.1)
    }),
    siteDeck: [...p.siteDeck, ...agent.siteStack],
  }));
  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraReturnFaceDown) } };
}

/**
 * Handle `agent-heal`: heal a wounded (Inverted) agent to Tapped.
 */
function handleAgentHeal(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-heal') return wrongActionType(state, action, 'agent-heal');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  if (hazardPlayer.agents[agentIdx].character.status !== CardStatus.Inverted) {
    return { state, error: 'Agent is not wounded' };
  }

  logDetail(`Agent ${action.agentId as string}: healed (inverted → tapped)`);

  const isExtraHeal = hazardPlayer.agents[agentIdx].remainingActions <= countExtraAgentActions(state);
  const newState = updateAgent(state, hazardIndex, agentIdx, a => ({
    ...a,
    character: { ...a.character, status: CardStatus.Tapped },
    remainingActions: a.remainingActions - 1,
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraHeal) } };
}

/**
 * Handle `agent-untap`: untap a tapped agent.
 */
function handleAgentUntap(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-untap') return wrongActionType(state, action, 'agent-untap');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  if (hazardPlayer.agents[agentIdx].character.status !== CardStatus.Tapped) {
    return { state, error: 'Agent is not tapped' };
  }

  logDetail(`Agent ${action.agentId as string}: untapped`);

  const isExtraUntap = hazardPlayer.agents[agentIdx].remainingActions <= countExtraAgentActions(state);
  const newState = updateAgent(state, hazardIndex, agentIdx, a => ({
    ...a,
    character: { ...a.character, status: CardStatus.Untapped },
    remainingActions: a.remainingActions - 1,
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraUntap) } };
}

/**
 * Handle `agent-turn-face-down`: turn a revealed untapped agent face-down.
 *
 * Does not tap the agent. The current site remains in siteStack (now face-down).
 */
function handleAgentTurnFaceDown(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-turn-face-down') return wrongActionType(state, action, 'agent-turn-face-down');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  if (!agent.revealed) return { state, error: 'Agent is not revealed' };
  if (agent.character.status !== CardStatus.Untapped) return { state, error: 'Agent must be untapped to turn face-down' };

  logDetail(`Agent ${action.agentId as string}: turned face-down`);

  const isExtraTurnDown = hazardPlayer.agents[agentIdx].remainingActions <= countExtraAgentActions(state);
  const newState = updateAgent(state, hazardIndex, agentIdx, a => ({
    ...a,
    revealed: false,
    remainingActions: a.remainingActions - 1,
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraTurnDown) } };
}

/**
 * Handle `agent-key-creatures`: tap an untapped agent to key creatures to its site.
 *
 * Taps the agent. (The actual keying logic for creature hazards is handled
 * by the hazard-play legal-action computer which checks `keyedAgents`.)
 */
function handleAgentKeyCreatures(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'agent-key-creatures') return wrongActionType(state, action, 'agent-key-creatures');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  if (hazardPlayer.agents[agentIdx].character.status !== CardStatus.Untapped) {
    return { state, error: 'Agent must be untapped to key creatures' };
  }

  logDetail(`Agent ${action.agentId as string}: tapped to key creatures to its site`);

  const isExtraKeyCreatures = hazardPlayer.agents[agentIdx].remainingActions <= countExtraAgentActions(state);
  const newState = updateAgent(state, hazardIndex, agentIdx, a => ({
    ...a,
    character: { ...a.character, status: CardStatus.Tapped },
    remainingActions: a.remainingActions - 1,
  }));

  return { state: { ...newState, phaseState: chargeAgentAction(mhState, isExtraKeyCreatures) } };
}

/**
 * Handle `agent-influence-attempt` (rule 10.14).
 *
 * The agent taps (not as an agent action, not against hazard limit) and is
 * revealed. The influence attempt is resolved using the standard
 * `opponent-influence-defend` pending resolution with rule 10.14 bonuses:
 *   - +2 to influencer DI if agent is at one of its home sites
 *   - Target mind treated as 0, +2 to attacker roll if target shares a home
 *     site with the agent (character/ally) or faction is playable at agent's
 *     home site (faction)
 */
function handleAgentInfluenceAttempt(
  state: GameState,
  action: GameAction,
  _mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'agent-influence-attempt') return wrongActionType(state, action, 'agent-influence-attempt');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const resourceIndex = 1 - hazardIndex;
  const resourcePlayer = state.players[resourceIndex];

  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };

  // Reveal agent, tap agent (not actedThisTurn — rule 10.14)
  const tapInfluenceEff = (agentDef.effects ?? []).find(
    (e): e is AgentTapInfluenceEffect => e.type === 'agent-tap-influence',
  );
  if (!tapInfluenceEff) return { state, error: 'Agent does not have agent-tap-influence effect' };

  logDetail(`Agent influence attempt: ${agentDef.name} (agent-${agent.id as string}) → ${action.targetKind} ${action.targetInstanceId as string}`);

  // Determine home site and whether agent is at home
  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  let agentSiteName: string | null = null;
  if (agent.siteStack.length > 0) {
    const topSite = agent.siteStack[agent.siteStack.length - 1];
    const siteDef = defById(state, topSite.definitionId);
    if (siteDef && isSiteCard(siteDef)) agentSiteName = siteDef.name;
  } else {
    agentSiteName = homesiteNames[0] ?? null;
  }
  const isAtHome = agentSiteName !== null && homesiteNames.includes(agentSiteName);

  // Rule 10.14 bonus: +2 DI if at home site
  // Agents are in hazardPlayer.agents, not .characters, so availableDI won't find them.
  // Read DI directly from the card definition.
  let influencerDI = agentDef.directInfluence ?? 0;
  if (isAtHome) {
    influencerDI += 2;
    logDetail(`Agent influence: ${agentDef.name} is at home site ${agentSiteName} → +2 DI (total: ${influencerDI})`);
  }

  // Resolve target mind / value and roll bonus
  let targetMind = 0;
  let controllerDI = 0;
  let rollBonus = 0;

  if (action.targetKind === 'character') {
    const targetChar = resourcePlayer.characters[action.targetInstanceId as string];
    if (!targetChar) return { state, error: 'Target character not found' };
    const targetDef = defById(state, targetChar.definitionId);
    if (!targetDef || !isCharacterCard(targetDef)) return { state, error: 'Target is not a character' };
    // A `control-restriction` overrides the influence-to-control threshold.
    targetMind = controlCostOf(state, targetChar, targetDef.mind ?? null) ?? 0;

    // Rule 10.14: shared home site → mind = 0, +2 roll
    const targetHomesites = parseHomesiteNames((targetDef as { homesite?: string }).homesite ?? '');
    const sharesHome = targetHomesites.some(h => homesiteNames.includes(h));
    if (sharesHome) {
      targetMind = 0;
      rollBonus += 2;
      logDetail(`Agent influence: ${targetDef.name} shares home site → mind = 0, +2 roll`);
    }

    if (targetChar.controlledBy !== 'general') {
      controllerDI = availableDI(state, targetChar.controlledBy, resourcePlayer);
    }
  } else if (action.targetKind === 'ally') {
    let allyFound = false;
    for (const [oppCharId, oppChar] of characterEntries(resourcePlayer)) {
      const allyInst = oppChar.allies.find(a => a.instanceId === action.targetInstanceId);
      if (allyInst) {
        const allyDef = defById(state, allyInst.definitionId);
        // A converted-creature ally (Ready to His Will) carries its mind on the
        // instance override; otherwise the target must be a real ally card.
        if (!allyInst.statOverride && (!allyDef || !isAllyCard(allyDef))) return { state, error: 'Target is not an ally' };
        targetMind = allyEffectiveMind(state, allyInst);
        controllerDI = availableDI(state, oppCharId, resourcePlayer);

        // Rule 10.14: shared home site → mind = 0, +2 roll
        const allyHomesites = parseHomesiteNames((allyDef as { homesite?: string }).homesite ?? '');
        const sharesHome = allyHomesites.some(h => homesiteNames.includes(h));
        if (sharesHome) {
          targetMind = 0;
          rollBonus += 2;
          logDetail(`Agent influence: ally shares home site → mind = 0, +2 roll`);
        }
        allyFound = true;
        break;
      }
    }
    if (!allyFound) return { state, error: 'Target ally not found' };
  } else if (action.targetKind === 'faction') {
    const targetFaction = findById(resourcePlayer.cardsInPlay, action.targetInstanceId);
    if (!targetFaction) return { state, error: 'Target faction not found' };
    const factionDef = defById(state, targetFaction.definitionId);
    if (!factionDef || !isFactionCard(factionDef)) return { state, error: 'Target is not a faction' };
    targetMind = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;

    // Rule 10.14: faction playable at agent's home site → value = 0, +2 roll
    if (agentSiteName !== null) {
      const factionAtHome = (factionDef.playableAt ?? []).some(e =>
        'site' in e && homesiteNames.includes(e.site),
      );
      if (factionAtHome) {
        targetMind = 0;
        rollBonus += 2;
        logDetail(`Agent influence: faction playable at agent's home → value = 0, +2 roll`);
      }
    }
  }

  const opponentGI = effectiveGeneralInfluence(state, resourcePlayer.id) - resourcePlayer.generalInfluenceUsed;
  const crossAlignmentPenalty = crossAlignmentInfluencePenalty(hazardPlayer.alignment, resourcePlayer.alignment);

  // Reveal and tap the agent (not actedThisTurn — this is NOT an agent action)
  let newState = updateAgent(state, hazardIndex, agentIdx, a => ({
    ...a,
    revealed: true,
    character: { ...a.character, status: CardStatus.Tapped },
  }));

  // Roll attacker 2d6 and apply roll bonus
  const { roll, rng, cheatRollTotal } = roll2d6(newState);
  const attackerRoll = roll.die1 + roll.die2 + rollBonus;

  const rollEffect = diceRollEffect(hazardPlayer.name, roll, `Agent influence: ${agentDef.name}${rollBonus > 0 ? ` (+${rollBonus} bonus)` : ''}`);

  logDetail(`Agent influence: ${agentDef.name} rolls ${roll.die1}+${roll.die2}${rollBonus > 0 ? `+${rollBonus}` : ''}=${attackerRoll} vs target ${targetMind} (DI: ${influencerDI}, GI: ${opponentGI})`);

  newState = { ...newState, rng, cheatRollTotal };

  const stateAfterAttempt = enqueueResolution(newState, {
    source: agent.character.instanceId,
    actor: resourcePlayer.id,
    scope: { kind: 'phase-step', phase: Phase.MovementHazard, step: 'play-hazards' },
    kind: {
      type: 'opponent-influence-defend',
      attempt: {
        influencerId: agent.character.instanceId,
        targetInstanceId: action.targetInstanceId,
        targetKind: action.targetKind,
        targetPlayer: action.targetPlayer,
        attackerRoll,
        influencerDI,
        opponentGI,
        targetMind,
        controllerDI,
        crossAlignmentPenalty,
        revealedCard: null,
      },
    },
  });

  return { state: stateAfterAttempt, effects: [rollEffect] };
}

/**
 * Handle `agent-tap-attack` — an agent taps itself during the M/H phase to
 * attack the active company (e.g. The Grimburgoth dm-15, rule 10.14 analog).
 *
 * - Does NOT count as an agent action (remainingActions unchanged).
 * - Does NOT count against the hazard limit.
 * - Prowess computed before reveal (rule 9.06).
 * - Agent is revealed if face-down, then tapped.
 */
function handleAgentTapAttack(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'agent-tap-attack') return wrongActionType(state, action, 'agent-tap-attack');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };

  const tapAttackEff = (agentDef.effects ?? []).find(
    (e): e is AgentTapAttackEffect => e.type === 'agent-tap-attack',
  );
  if (!tapAttackEff) return { state, error: 'Agent does not have agent-tap-attack effect' };

  // Get destination site name for prowess/home-site checks
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[mhState.activeCompanyIndex];
  const destSiteInst = company?.destinationSite ?? company?.currentSite ?? null;
  let destSiteName: string | undefined;
  if (destSiteInst) {
    const destSiteDef = defById(state, destSiteInst.definitionId);
    if (destSiteDef && isSiteCard(destSiteDef)) destSiteName = destSiteDef.name;
  }

  // Compute prowess BEFORE reveal (rule 9.06)
  const isFaceDown = !agent.revealed;
  const isWounded = agent.character.status === CardStatus.Inverted;
  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  const isAtHome = destSiteName !== undefined && homesiteNames.includes(destSiteName);

  let prowess = agentDef.prowess;
  const body = agentDef.body;
  if (isWounded) prowess -= 2;
  if (isFaceDown && !isAtHome) prowess += 2;
  if (isFaceDown && isAtHome) prowess += 5;
  if (!isFaceDown && isAtHome) prowess += 2;
  prowess += tapAttackEff.prowessBonus;

  logDetail(`Agent tap-attack "${agentDef.name}": prowess ${prowess} (faceDown: ${isFaceDown}, atHome: ${isAtHome}, bonus: +${tapAttackEff.prowessBonus})`);

  // Reveal agent if face-down (same logic as handleTapAgentAtSite)
  let newState: GameState;
  if (isFaceDown) {
    const currentSiteEntry = agent.siteStack.length > 0
      ? agent.siteStack[agent.siteStack.length - 1]
      : destSiteInst;
    const emptyStack = agent.siteStack.length === 0;

    if (action.homeSiteInstanceId) {
      const homeSiteCard = findById(hazardPlayer.siteDeck, action.homeSiteInstanceId);
      if (!homeSiteCard) {
        return { state, error: `Home site ${action.homeSiteInstanceId as string} not in hazard player's site deck` };
      }
      const priorStackSites = agent.siteStack.slice(0, -1);
      const newSiteStack = emptyStack
        ? [{ instanceId: homeSiteCard.instanceId, definitionId: homeSiteCard.definitionId, status: CardStatus.Untapped as const }]
        : [{ instanceId: currentSiteEntry!.instanceId, definitionId: currentSiteEntry!.definitionId, status: CardStatus.Untapped as const }];
      const returnedSites = emptyStack ? [] : priorStackSites;
      newState = updatePlayer(state, hazardIndex, p => ({
        ...p,
        agents: p.agents.map(a => a.character.instanceId === agent.character.instanceId
          ? { ...a, revealed: true, character: { ...a.character, status: CardStatus.Tapped as const }, siteStack: newSiteStack }
          : a,
        ),
        siteDeck: [...removeById(p.siteDeck, homeSiteCard.instanceId), ...returnedSites],
      }));
    } else {
      // No home site — reveal without site, discard at EOT (rule 9.04)
      const priorStackSites = emptyStack ? [] : agent.siteStack.slice(0, -1);
      const newSiteStack = emptyStack
        ? []
        : [{ instanceId: currentSiteEntry!.instanceId, definitionId: currentSiteEntry!.definitionId, status: CardStatus.Untapped as const }];
      newState = updatePlayer(state, hazardIndex, p => ({
        ...p,
        agents: p.agents.map(a => a.character.instanceId === agent.character.instanceId
          ? { ...a, revealed: true, character: { ...a.character, status: CardStatus.Tapped as const }, siteStack: newSiteStack, discardAtEndOfTurn: true }
          : a,
        ),
        siteDeck: [...p.siteDeck, ...priorStackSites],
      }));
    }
  } else {
    // Already face-up: just tap (do NOT set remainingActions — not an agent action)
    newState = updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map(a => a.character.instanceId === agent.character.instanceId
        ? { ...a, character: { ...a.character, status: CardStatus.Tapped as const } }
        : a,
      ),
    }));
  }

  // Build CombatState
  const combat: CombatState = {
    attackSource: { type: 'agent', instanceId: agent.character.instanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer.id,
    strikesTotal: 1,
    strikeProwess: prowess,
    creatureBody: body,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: tapAttackEff.attackerAssigns ? 'attacker' : 'defender',
    bodyCheckTarget: null,
    detainment: false,
    ...(tapAttackEff.attackerAssigns ? { forceSingleTarget: true } : {}),
  };

  return {
    state: {
      ...newState,
      combat,
      phaseState: { ...mhState, hazardPlayerPassed: false, resourcePlayerPassed: false },
    },
  };
}

/**
 * Play a hazard card from hand during the play-hazards step.
 *
 * Currently supports hazard long-events. Playing a hazard counts as one
 * against the hazard limit. If the resource player had passed, their
 * pass is reset (they may resume taking actions).
 *
 * TODO: creatures, short-events, permanent-events, on-guard cards
 */
function handlePlayHazardCard(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'play-hazard') return wrongActionType(state, action, 'play-hazard');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  const handCard = findById(hazardPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const def = defById(state, handCard.definitionId);
  if (!def) return { state, error: 'Card definition not found' };

  // --- Resource-as-hazard (e.g. Sudden Call) with call-council effect ---
  // Playing a resource-event as a hazard on the opponent's turn, solely
  // to trigger the endgame. Bypasses the chain: the effect resolves
  // immediately with the Sudden Call player getting one last turn.
  const hazardCallCouncil = getCardEffects(def).find(
    (e): e is CallCouncilEffect => e.type === 'call-council' && e.lastTurnFor === 'self',
  );
  if (hazardCallCouncil
    && (def.cardType === 'hero-resource-event' || def.cardType === 'minion-resource-event')
    && hasPlayFlag(def, 'playable-as-hazard')) {
    logDetail(`Play-hazards: ${action.player as string} plays resource-as-hazard "${def.name}" → triggering endgame (caller gets last turn)`);
    const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
    const afterDiscard = updatePlayer(state, hazardIndex, p => ({
      ...p,
      hand: newHand,
      discardPile: [...p.discardPile, handCard],
    }));
    return { state: triggerCouncilCall(afterDiscard, action.player, 'self') };
  }

  // --- Creature handling (via chain of effects) ---
  if (def.cardType === 'hazard-creature') {
    const viaKeyingBypass = action.type === 'play-hazard' && action.keyedBy?.method === 'keying-bypass';
    if (!viaKeyingBypass) {
      const keyError = checkCreatureKeying(state, def, mhState);
      if (keyError) return { state, error: keyError };
    } else {
      logDetail(`Creature "${def.name}" played via keying-bypass constraint (race "${def.race}")`);
    }

    const raceExempt = isCreatureRaceExempt(state, action, def);
    const newHazardCount = raceExempt ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;
    logDetail(`Play-hazards: hazard player plays creature "${def.name}" (${newHazardCount}/${currentHazardLimit(state, mhState, action.targetCompanyId)})${raceExempt ? ` [race "${def.race}" exempt from hazard limit]` : ''} — initiating chain`);

    // Remove card from hand — it resides on the chain entry until combat resolves
    const newHand = removeById(hazardPlayer.hand, handCard.instanceId);

    let newState: GameState = {
      ...updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand })),
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
      },
    };

    // Consume one charge of any matching creature-keying-bypass constraint
    // on the target company when the creature was keyed via bypass.
    if (viaKeyingBypass) {
      newState = consumeCreatureKeyingBypass(newState, action.targetCompanyId, def.race);
    }

    // Initiate chain — when creature entry resolves, combat will start (TODO)
    newState = initiateChain(newState, action.player, handCard, { type: 'creature' });

    return { state: newState };
  }

  // --- Short event handling (via chain of effects) ---
  if (def.cardType === 'hazard-event' && def.eventType === 'short') {
    // Tap-agent-at-site (An Article Missing, Cunning Foes): taps an agent at
    // the company's new site to initiate an M/H phase attack, bypassing the
    // chain mechanism entirely.
    const tapAgentEff = def.effects?.find(
      (e): e is TapAgentEffect => e.type === 'tap-agent-at-site',
    );
    if (tapAgentEff && action.type === 'play-hazard' && action.agentInstanceId) {
      return handleTapAgentAtSite(state, action, mhState, hazardPlayer, hazardIndex, handCard, def, tapAgentEff);
    }

    const bypassesLimit = hasPlayFlag(def, 'no-hazard-limit');
    const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;
    logDetail(`Play-hazards: hazard player plays short-event "${def.name}" (${newHazardCount}/${currentHazardLimit(state, mhState, action.targetCompanyId)})${bypassesLimit ? ' [no-hazard-limit]' : ''}`);

    // Move card from hand to discard (short events are discarded after resolution)
    const newHand = removeById(hazardPlayer.hand, handCard.instanceId);

    // CoE rule 7.2.1: only one corruption card may be played per character per
    // turn. Corruption-keyword short-events played on a character (e.g.
    // Weariness of the Heart le-149) mark the target so a second corruption
    // card on the same character is rejected by the legal-action generator.
    const shortTargetCharId = action.type === 'play-hazard' ? action.targetCharacterId : undefined;
    const isCorruptionShort = def.keywords?.includes('corruption') === true;
    const shortCorruptionPerChar = isCorruptionShort && shortTargetCharId
      ? { ...mhState.corruptionCardsPlayedPerChar, [shortTargetCharId as string]: true as const }
      : mhState.corruptionCardsPlayedPerChar;

    let newState: GameState = {
      ...updatePlayer(state, hazardIndex, p => ({
        ...p,
        hand: newHand,
        discardPile: [...p.discardPile, handCard],
      })),
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
        corruptionCardsPlayedPerChar: shortCorruptionPerChar,
      },
    };

    // creature-race-choice: add constraint for the chosen race. The kind
    // of constraint depends on the effect's `apply.constraint` name —
    // `creature-type-no-hazard-limit` (Two or Three Tribes Present) or
    // `creature-keying-bypass` (Dragon's Desolation Mode B).
    if (action.type === 'play-hazard' && action.chosenCreatureRace && def.effects) {
      const raceChoice = def.effects.find(
        e => e.type === 'creature-race-choice',
      );
      const activePlayerId = newState.activePlayer;
      if (raceChoice && activePlayerId) {
        const activeIndex = getPlayerIndex(newState, activePlayerId);
        const targetCompany = newState.players[activeIndex].companies[mhState.activeCompanyIndex];
        if (targetCompany) {
          const constraintName = raceChoice.apply.constraint;
          if (constraintName === 'creature-keying-bypass') {
            logDetail(`Short-event "${def.name}": adding creature-keying-bypass constraint for race "${action.chosenCreatureRace}" on company ${targetCompany.id as string}`);
            newState = addConstraint(newState, {
              source: handCard.instanceId,
              sourceDefinitionId: handCard.definitionId,
              scope: { kind: 'company-mh-phase', companyId: targetCompany.id },
              target: { kind: 'company', companyId: targetCompany.id },
              kind: { type: 'creature-keying-bypass', race: action.chosenCreatureRace, remainingPlays: 1 },
            });
          } else {
            logDetail(`Short-event "${def.name}": adding creature-type-no-hazard-limit constraint for race "${action.chosenCreatureRace}" on company ${targetCompany.id as string}`);
            newState = addConstraint(newState, {
              source: handCard.instanceId,
              sourceDefinitionId: handCard.definitionId,
              scope: { kind: 'company-mh-phase', companyId: targetCompany.id },
              target: { kind: 'company', companyId: targetCompany.id },
              kind: { type: 'creature-type-no-hazard-limit', exemptRace: action.chosenCreatureRace },
            });
          }
        }
      }
    }

    // region-keying-boost (Withered Lands): the short-event leaves a
    // turn-scoped environment constraint that softens creature keying for
    // the rest of the turn. Added at play time (like creature-keying-bypass
    // above) so an environment-cancel that targets this card removes it.
    const boostEffect = def.effects?.find(
      (e): e is RegionKeyingBoostEffect => e.type === 'region-keying-boost',
    );
    if (boostEffect) {
      logDetail(`Short-event "${def.name}": adding region-keying-boost constraint (until end of turn)`);
      newState = addConstraint(newState, {
        source: handCard.instanceId,
        sourceDefinitionId: handCard.definitionId,
        scope: { kind: 'turn' },
        target: { kind: 'player', playerId: action.player },
        kind: { type: 'region-keying-boost', boosts: boostEffect.boosts },
      });
    }

    // Initiate chain or push onto existing chain
    const shortEventPayload: import('../index.js').ChainEntryPayload = {
      type: 'short-event',
      ...(action.type === 'play-hazard' && action.targetFactionInstanceId
        ? { targetFactionInstanceId: action.targetFactionInstanceId }
        : {}),
      ...(action.type === 'play-hazard' && action.targetCharacterId
        ? { targetCharacterId: action.targetCharacterId }
        : {}),
      ...(action.type === 'play-hazard' && action.targetAllyId
        ? { targetAllyId: action.targetAllyId }
        : {}),
      ...(action.type === 'play-hazard' && action.optionId
        ? { optionId: action.optionId }
        : {}),
    };
    newState = initiateOrPushChain(newState, action.player, handCard, shortEventPayload);

    return { state: newState };
  }

  // --- Hazard-corruption handling (attaches to character like permanent events) ---
  if (def.cardType === 'hazard-corruption') {
    logDetail(`Play-hazards: hazard player plays corruption "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${currentHazardLimit(state, mhState, action.targetCompanyId)}) → enters chain`);
    const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
    const targetCharId = action.type === 'play-hazard' ? action.targetCharacterId : undefined;
    const updatedCorruptionPerChar = targetCharId
      ? { ...mhState.corruptionCardsPlayedPerChar, [targetCharId as string]: true as const }
      : mhState.corruptionCardsPlayedPerChar;
    let newState: GameState = {
      ...updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand })),
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        resourcePlayerPassed: false,
        corruptionCardsPlayedPerChar: updatedCorruptionPerChar,
      },
    };
    const payload: import('../index.js').ChainEntryPayload = {
      type: 'permanent-event',
      targetCharacterId: targetCharId,
    };
    newState = initiateOrPushChain(newState, action.player, handCard, payload);
    return { state: newState };
  }

  // --- Event handling (long / permanent) ---
  // The narrowing here is load-bearing for downstream `def.eventType` access.
  if (def.cardType !== 'hazard-event' || (def.eventType !== 'long' && def.eventType !== 'permanent')) {
    return { state, error: `Unsupported hazard card type during play-hazards` };
  }

  logDetail(`Play-hazards: hazard player plays ${def.eventType}-event "${def.name}" (${mhState.hazardsPlayedThisCompany + 1}/${currentHazardLimit(state, mhState, action.targetCompanyId)}) → enters chain`);

  // Remove card from hand — it now resides on the chain
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);

  const eventTargetCharId = def.eventType === 'permanent' && action.type === 'play-hazard'
    ? action.targetCharacterId
    : undefined;
  const isCorruptionEvent = def.keywords?.includes('corruption') === true;
  const updatedCorruptionPerChar = isCorruptionEvent && eventTargetCharId
    ? { ...mhState.corruptionCardsPlayedPerChar, [eventTargetCharId as string]: true as const }
    : mhState.corruptionCardsPlayedPerChar;

  let newState: GameState = {
    ...updatePlayer(state, hazardIndex, p => ({ ...p, hand: newHand })),
    phaseState: {
      ...mhState,
      hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
      // Reset resource player's pass — they may respond
      resourcePlayerPassed: false,
      corruptionCardsPlayedPerChar: updatedCorruptionPerChar,
    },
  };

  // Initiate or push onto chain — card enters play upon resolution
  const payload: import('../index.js').ChainEntryPayload = def.eventType === 'permanent'
    ? {
        type: 'permanent-event',
        targetCharacterId: action.type === 'play-hazard' ? action.targetCharacterId : undefined,
        targetSiteDefinitionId: action.type === 'play-hazard' ? action.targetSiteDefinitionId : undefined,
        targetCompanyId: action.type === 'play-hazard' ? action.targetCompanyId : undefined,
      }
    : { type: 'long-event' };
  newState = initiateOrPushChain(newState, action.player, handCard, payload);

  return { state: newState };
}

/**
 * Handle a tap-agent-at-site hazard short-event (e.g. An Article Missing,
 * Cunning Foes). Resolves the effect directly without going through the chain:
 *  - Removes the card from hand and discards it (short event)
 *  - Reveals the targeted agent if face-down (applying face-down prowess
 *    modifiers before reveal, per rule 9.06)
 *  - Taps the agent and marks it as having acted this turn
 *  - Builds and sets CombatState so the M/H phase attack can proceed
 */
function handleTapAgentAtSite(
  state: GameState,
  action: PlayHazardAction,
  mhState: MovementHazardPhaseState,
  hazardPlayer: GameState['players'][number],
  hazardIndex: number,
  handCard: GameState['players'][number]['hand'][number],
  def: CardDefinition,
  tapAgentEff: TapAgentEffect,
): ReducerResult {
  const agentInstanceId = action.agentInstanceId!;

  // Locate the agent
  const agent = hazardPlayer.agents.find(a => a.character.instanceId === agentInstanceId);
  if (!agent) return { state, error: `Agent ${agentInstanceId as string} not found` };

  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) {
    return { state, error: `Agent definition not found for ${agentInstanceId as string}` };
  }

  // Get active company and its new site for prowess/home-site checks
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[mhState.activeCompanyIndex];
  const destSiteInst = company?.destinationSite ?? company?.currentSite ?? null;
  let destSiteName: string | undefined;
  if (destSiteInst) {
    const destSiteDef = defById(state, destSiteInst.definitionId);
    if (destSiteDef && isSiteCard(destSiteDef)) destSiteName = destSiteDef.name;
  }

  // --- Compute prowess NOW, before any reveal (rule 9.06) ---
  const isFaceDown = !agent.revealed;
  const isWounded = agent.character.status === CardStatus.Inverted;
  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  const isAtHome = destSiteName !== undefined && homesiteNames.includes(destSiteName);

  let prowess = agentDef.prowess;
  const body = agentDef.body;
  if (isWounded) prowess -= 2;
  if (isFaceDown && !isAtHome) prowess += 2;
  if (isFaceDown && isAtHome) prowess += 5;
  if (!isFaceDown && isAtHome) prowess += 2;
  prowess += tapAgentEff.prowessBonus;

  logDetail(`Tap-agent-at-site "${def.name}": agent "${agentDef.name}" prowess ${prowess} (faceDown: ${isFaceDown}, atHome: ${isAtHome}, bonus: +${tapAgentEff.prowessBonus})`);

  // --- Reveal agent if face-down ---
  let stateAfterReveal: GameState;
  if (isFaceDown) {
    const currentSiteEntry = agent.siteStack.length > 0
      ? agent.siteStack[agent.siteStack.length - 1]
      : destSiteInst;
    const emptyStack = agent.siteStack.length === 0;

    if (action.homeSiteInstanceId) {
      const homeSiteCard = findById(hazardPlayer.siteDeck, action.homeSiteInstanceId);
      if (!homeSiteCard) {
        return { state, error: `Home site ${action.homeSiteInstanceId as string} not in hazard player's site deck` };
      }
      const priorStackSites = agent.siteStack.slice(0, -1);
      const newSiteStack = emptyStack
        ? [{ instanceId: homeSiteCard.instanceId, definitionId: homeSiteCard.definitionId, status: CardStatus.Untapped as const }]
        : [{ instanceId: currentSiteEntry!.instanceId, definitionId: currentSiteEntry!.definitionId, status: CardStatus.Untapped as const }];
      const returnedSites = emptyStack ? [] : priorStackSites;
      stateAfterReveal = updatePlayer(state, hazardIndex, p => ({
        ...p,
        agents: p.agents.map(a => a.character.instanceId === agentInstanceId
          ? {
              ...a,
              revealed: true,
              character: { ...a.character, status: CardStatus.Tapped as const },
              siteStack: newSiteStack,
              remainingActions: 0,
            }
          : a,
        ),
        siteDeck: [...removeById(p.siteDeck, homeSiteCard.instanceId), ...returnedSites],
      }));
    } else {
      // No home site — reveal without site, discard at EOT (rule 9.04)
      const priorStackSites = emptyStack ? [] : agent.siteStack.slice(0, -1);
      const newSiteStack = emptyStack
        ? []
        : [{ instanceId: currentSiteEntry!.instanceId, definitionId: currentSiteEntry!.definitionId, status: CardStatus.Untapped as const }];
      stateAfterReveal = updatePlayer(state, hazardIndex, p => ({
        ...p,
        agents: p.agents.map(a => a.character.instanceId === agentInstanceId
          ? {
              ...a,
              revealed: true,
              character: { ...a.character, status: CardStatus.Tapped as const },
              siteStack: newSiteStack,
              remainingActions: 0,
              discardAtEndOfTurn: true,
            }
          : a,
        ),
        siteDeck: [...p.siteDeck, ...priorStackSites],
      }));
    }
  } else {
    // Already face-up: just tap and mark acted
    stateAfterReveal = updatePlayer(state, hazardIndex, p => ({
      ...p,
      agents: p.agents.map(a => a.character.instanceId === agentInstanceId
        ? { ...a, character: { ...a.character, status: CardStatus.Tapped as const }, remainingActions: 0 }
        : a,
      ),
    }));
  }

  // --- Remove card from hand, add to discard ---
  const newHand = removeById(stateAfterReveal.players[hazardIndex].hand, handCard.instanceId);
  stateAfterReveal = updatePlayer(stateAfterReveal, hazardIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, handCard],
  }));

  // --- Increment hazard count (the card counts; the attack does not) ---
  const bypassesLimit = hasPlayFlag(def as { effects?: readonly import('../types/effects.js').CardEffect[] }, 'no-hazard-limit');
  const newHazardCount = bypassesLimit
    ? mhState.hazardsPlayedThisCompany
    : mhState.hazardsPlayedThisCompany + 1;

  // --- Build CombatState ---
  const combat: CombatState = {
    attackSource: { type: 'agent', instanceId: agentInstanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer.id,
    strikesTotal: 1,
    strikeProwess: prowess,
    creatureBody: body,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: tapAgentEff.attackerAssigns ? 'attacker' : 'defender',
    bodyCheckTarget: null,
    detainment: false,
    ...(tapAgentEff.attackerAssigns ? { forceSingleTarget: true } : {}),
    ...(tapAgentEff.strikeEffect ? { strikeEffect: tapAgentEff.strikeEffect } : {}),
  };

  return {
    state: {
      ...stateAfterReveal,
      combat,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
      },
    },
  };
}

/**
 * Place a card from the hazard player's hand face-down on the active
 * company as an on-guard card. Any card may be placed (bluffing is
 * allowed). Counts against the hazard limit and resets the resource
 * player's pass.
 */
function handlePlaceOnGuard(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'place-on-guard') return wrongActionType(state, action, 'place-on-guard');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const targetCompanyId = state.players[activeIdx].companies[mhState.activeCompanyIndex].id;

  const handCard = findById(hazardPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };

  logDetail(`Play-hazards: hazard player places on-guard card "${action.cardInstanceId}" (${mhState.hazardsPlayedThisCompany + 1}/${currentHazardLimit(state, mhState, targetCompanyId)})`);

  // Remove card from hand
  const newHand = removeById(hazardPlayer.hand, handCard.instanceId);

  // Add card to the active company's on-guard cards
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const newPlayers = clonePlayers(state);
  newPlayers[hazardIndex] = { ...hazardPlayer, hand: newHand };

  const resourcePlayer = newPlayers[activeIndex];
  const newCompanies = [...resourcePlayer.companies];
  const company = newCompanies[mhState.activeCompanyIndex];
  newCompanies[mhState.activeCompanyIndex] = {
    ...company,
    onGuardCards: [...company.onGuardCards, { instanceId: handCard.instanceId, definitionId: handCard.definitionId, revealed: false }],
  };
  newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        onGuardPlacedThisCompany: true,
        resourcePlayerPassed: false,
      },
    },
  };
}

/**
 * Fires end-of-company-MH corruption checks for characters with attached
 * hazards carrying `on-event: end-of-company-mh`. Enqueues one corruption
 * check per region traversed in the site path for each matching character.
 * When the effect declares a `regionTypeFilter`, only regions whose type
 * appears in the filter count (e.g. *Lure of Nature* — wilderness only).
 */
function fireEndOfCompanyMHCorruptionChecks(
  state: GameState,
  mhState: MovementHazardPhaseState,
): GameState {
  const sitePath = mhState.resolvedSitePath;
  if (sitePath.length === 0) return state;

  const resourcePlayer = playerById(state, state.activePlayer)!;
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];

  let newState = state;
  for (const charId of company.characters) {
    const char = resourcePlayer.characters[charId as string];
    if (!char) continue;
    for (const hazard of char.hazards) {
      const hDef = newState.cardPool[hazard.definitionId as string] as { name?: string; effects?: readonly import('../index.js').CardEffect[] } | undefined;
      for (const onEvent of getOnEventEffects(hDef, 'end-of-company-mh')) {
        if (onEvent.apply.type !== 'force-check' || onEvent.apply.check !== 'corruption') continue;

        const regionIndices = onEvent.regionTypeFilter
          ? sitePath
              .map((rt, i) => (onEvent.regionTypeFilter!.includes(rt) ? i : -1))
              .filter(i => i >= 0)
          : sitePath.map((_, i) => i);
        if (regionIndices.length === 0) {
          logDetail(`end-of-company-mh: "${hDef?.name}" skipped for character ${charId as string} — no regions matching filter ${JSON.stringify(onEvent.regionTypeFilter)}`);
          continue;
        }

        logDetail(`end-of-company-mh: "${hDef?.name}" triggers ${regionIndices.length} corruption check(s) for character ${charId as string}`);
        const possessions = [
          ...char.items.map(i => i.instanceId),
          ...char.allies.map(a => a.instanceId),
          ...char.hazards.map(h => h.instanceId),
        ];
        const total = regionIndices.length;
        for (let k = 0; k < total; k++) {
          newState = enqueueCorruptionCheck(newState, {
            source: hazard.instanceId,
            actor: state.activePlayer!,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            characterId: charId,
            reason: `${hDef?.name} (region ${k + 1}/${total})`,
            possessions,
          });
        }
      }
    }
  }
  return newState;
}

/**
 * End the current company's M/H phase (CoE step 8).
 *
 * 1. Complete movement: update currentSite, handle site of origin.
 * 2. Draw up to hand size (automatic for both players).
 * 3. If either player exceeds hand size, transition to 'reset-hand' step
 *    for interactive discard. Otherwise advance directly.
 *
 * TODO: passive conditions at end of M/H phase
 * TODO: check if other companies have unresolved movement to site of origin
 */
/**
 * Handle `tap-ally-discard-hazard` (le-153): tap the ally in the active
 * company, then remove the targeted hazard permanent-event (attached to the
 * company or to one of its characters) and return it to its owner's discard
 * pile. CoE no-card-disappears: the removed instance lands in a discard pile.
 */
function handleTapAllyDiscardHazard(
  state: GameState,
  action: TapAllyDiscardHazardAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.player !== state.activePlayer) {
    return { state, error: 'tap-ally-discard-hazard: only the active player may activate this ability' };
  }
  const activeIndex = getPlayerIndex(state, state.activePlayer);
  const company = state.players[activeIndex].companies[mhState.activeCompanyIndex];
  if (!company) return { state, error: 'tap-ally-discard-hazard: active company not found' };

  // Tap the ally (must be an untapped ally in the active company).
  let allyTapped = false;
  let newState = updatePlayer(state, activeIndex, p => {
    const characters = { ...p.characters };
    for (const charId of company.characters) {
      const ch = characters[charId as string];
      if (!ch) continue;
      const idx = ch.allies.findIndex(a => a.instanceId === action.allyInstanceId);
      if (idx === -1) continue;
      const ally = ch.allies[idx];
      if (ally.status !== CardStatus.Untapped) return p;
      const newAllies = [...ch.allies];
      newAllies[idx] = { ...ally, status: CardStatus.Tapped };
      characters[charId as string] = { ...ch, allies: newAllies };
      allyTapped = true;
      break;
    }
    return allyTapped ? { ...p, characters } : p;
  });
  if (!allyTapped) return { state, error: 'tap-ally-discard-hazard: untapped ally not found in active company' };

  // Locate and remove the target hazard permanent-event (company- or
  // character-attached).
  let removed: import('../index.js').CardInPlay | undefined;
  newState = updatePlayer(newState, activeIndex, p => {
    const companies = [...p.companies];
    const co = companies[mhState.activeCompanyIndex];
    const cIdx = co.hazards.findIndex(h => h.instanceId === action.targetInstanceId);
    if (cIdx !== -1) {
      removed = co.hazards[cIdx];
      companies[mhState.activeCompanyIndex] = { ...co, hazards: co.hazards.filter(h => h.instanceId !== action.targetInstanceId) };
      return { ...p, companies };
    }
    const characters = { ...p.characters };
    for (const charId of co.characters) {
      const ch = characters[charId as string];
      if (!ch) continue;
      const hIdx = ch.hazards.findIndex(h => h.instanceId === action.targetInstanceId);
      if (hIdx !== -1) {
        removed = ch.hazards[hIdx];
        characters[charId as string] = { ...ch, hazards: ch.hazards.filter(h => h.instanceId !== action.targetInstanceId) };
        return { ...p, characters };
      }
    }
    return p;
  });
  if (!removed) return { state, error: 'tap-ally-discard-hazard: target hazard not found on the active company' };

  // Return the discarded hazard to its owner's discard pile.
  const ownerId = ownerOf(action.targetInstanceId);
  const ownerIdx = getPlayerIndex(newState, ownerId);
  const removedCard = removed;
  newState = updatePlayer(newState, ownerIdx, p => ({ ...p, discardPile: [...p.discardPile, toCardInstance(removedCard)] }));
  logDetail(`tap-ally-discard-hazard: discarded "${defById(state, removedCard.definitionId)?.name ?? removedCard.definitionId as string}" to ${ownerId as string}'s discard pile`);

  // Rule 5.27: the resource player acted → the hazard player may resume.
  const updatedMh = mhState.hazardPlayerPassed ? { ...mhState, hazardPlayerPassed: false } : mhState;
  return { state: { ...newState, phaseState: updatedMh } };
}

/**
 * Rule 5.31 — Company Returned to Origin (force-return-to-origin enforcement).
 *
 * Scans every in-play environment (long-event) carrying a
 * `force-return-to-origin` effect and tests it against the given moving
 * company's site path. Each effect's `condition` is evaluated against a
 * context exposing the company's site-path terrain counts and the moving
 * player's alignment (`player.minion` — true for Ringwraith/Balrog, used by
 * "no effect on a minion player" gating). `rangerException` exempts a
 * company that contains a ranger (printed skill or item-granted).
 *
 * Returns the forcing environment card (used for logging and as the
 * `site-phase-do-nothing` constraint source) or null if no environment
 * forces this company back. The actual return is applied by
 * {@link endCompanyMH}: the company keeps its current site, `moved` is not
 * set, and a `site-phase-do-nothing` constraint blocks its site phase
 * (CoE rule 5.31: "the company's player cannot initiate any actions during
 * that company's site phase").
 */
function findForcingEnvironment(
  state: GameState,
  company: Company,
  mhState: MovementHazardPhaseState,
  movingPlayer: import('../index.js').PlayerState,
): import('../index.js').CardInPlay | null {
  const path = mhState.resolvedSitePath;
  const terrainCount = (t: RegionType): number => path.filter(r => r === t).length;
  const context = {
    sitePath: {
      wildernessCount: terrainCount(RegionType.Wilderness),
      shadowCount: terrainCount(RegionType.Shadow),
      darkCount: terrainCount(RegionType.Dark),
      coastalCount: terrainCount(RegionType.Coastal),
      borderCount: terrainCount(RegionType.Border),
      freeCount: terrainCount(RegionType.Free),
      length: path.length,
    },
    player: { minion: isMinionOrBalrog(movingPlayer) },
  };

  const companyHasRanger = company.characters.some(charId => {
    const charData = movingPlayer.characters[charId as string];
    const charDef = charData ? defById(state, charData.definitionId) : undefined;
    if (!charDef || !isCharacterCard(charDef)) return false;
    const skills = [...charDef.skills, ...(charData ? getItemGrantedSkills(state, charData) : [])];
    return skills.includes(Skill.Ranger);
  });

  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      for (const eff of getCardEffects(def)) {
        if (eff.type !== 'force-return-to-origin') continue;
        if (eff.rangerException && companyHasRanger) {
          logDetail(`Rule 5.31: "${def?.name ?? card.definitionId as string}" exempts company ${company.id as string} — contains a ranger`);
          continue;
        }
        if (eff.condition && !matchesCondition(eff.condition, context as unknown as Record<string, unknown>)) {
          continue;
        }
        logDetail(`Rule 5.31: "${def?.name ?? card.definitionId as string}" forces company ${company.id as string} to return to origin (site path: ${path.join(',') || 'none'})`);
        return card;
      }
    }
  }
  return null;
}

function endCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const newPlayers = clonePlayers(state);

  // --- Step 8a: Complete movement ---
  const resourcePlayer = newPlayers[activeIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];

  // --- Rule 5.31: Company Returned to Origin ---
  // Before committing movement, check whether any in-play environment carrying
  // a force-return-to-origin effect applies to this moving company. If so, the
  // company does not move: it stays at its current site, `moved` stays false,
  // and a site-phase-do-nothing constraint blocks its upcoming site phase.
  let mhStateLocal = mhState;
  let workingState = state;
  if (company.destinationSite && !mhState.returnedToOrigin) {
    const forcing = findForcingEnvironment(state, company, mhState, resourcePlayer);
    if (forcing) {
      workingState = addConstraint(workingState, {
        source: forcing.instanceId,
        sourceDefinitionId: forcing.definitionId,
        scope: { kind: 'company-site-phase', companyId: company.id },
        target: { kind: 'company', companyId: company.id },
        kind: { type: 'site-phase-do-nothing' },
      });
      mhStateLocal = { ...mhState, returnedToOrigin: true };
    }
  }

  // Track an optional `company-arrives-at-site` event to fire after the
  // base move completes. We compute the post-move state first, then run
  // the event hook on the resulting state so the destination is the
  // company's *current* site.
  let companyArrivedAt: { companyId: typeof company.id; siteInstanceId: typeof company.destinationSite extends null ? never : NonNullable<typeof company.destinationSite>['instanceId'] } | null = null;

  if (company.destinationSite && !mhStateLocal.returnedToOrigin) {
    const originSite = company.currentSite;

    // Rule 2.II.7.2: detect whether another of this player's companies is
    // already at the destination — the moving company then shares the site
    // without taking a physical copy (same invariant as split-at-haven).
    const sharedDestinationOwner = resourcePlayer.companies.find(
      (c, idx) => idx !== mhState.activeCompanyIndex
        && c.currentSite?.instanceId === company.destinationSite!.instanceId,
    );

    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      currentSite: { instanceId: company.destinationSite.instanceId, definitionId: company.destinationSite.definitionId, status: CardStatus.Untapped },
      destinationSite: null,
      moved: true,
      siteOfOrigin: null,
      siteCardOwned: sharedDestinationOwner ? false : true,
    };

    if (sharedDestinationOwner) {
      logDetail(`Step 8: arrived at site already in play at sibling company ${sharedDestinationOwner.id as string} — siteCardOwned=false`);
    }

    // Handle site of origin (CoE rule 2.IV.vii): if no sibling company is
    // still at the origin, either discard it (tapped non-haven) or return it
    // to the location deck (untapped or haven).
    let newSiteDeck = [...resourcePlayer.siteDeck];
    const newSiteDiscardPile = [...resourcePlayer.siteDiscardPile];
    let newOutOfPlayPile = [...resourcePlayer.outOfPlayPile];
    if (originSite) {
      const siblingStillAtOrigin = resourcePlayer.companies.some(
        (c, idx) => idx !== mhState.activeCompanyIndex
          && c.currentSite?.instanceId === originSite.instanceId,
      );
      if (siblingStillAtOrigin) {
        logDetail(`Step 8: site of origin remains in play — still occupied by a sibling company`);
      } else {
        const originDef = defById(state, originSite.definitionId);
        const isHaven = originDef && isSiteCard(originDef) && originDef.siteType === 'haven';
        const alwaysReturnToDeck = originDef && isSiteCard(originDef)
          && (originDef.effects ?? []).some(e => e.type === 'site-rule' && e.rule === 'always-return-to-deck');
        const stolenKnowledge = originDef && isSiteCard(originDef)
          && (originDef.effects ?? []).some(e => e.type === 'site-rule' && e.rule === 'stolen-knowledge');
        const isTapped = originSite.status === CardStatus.Tapped;
        newSiteDeck = newSiteDeck.filter(c => c.instanceId !== originSite.instanceId);
        const entry = toCardInstance(originSite);
        if (!isHaven && isTapped && !alwaysReturnToDeck) {
          if (stolenKnowledge) {
            logDetail(`Step 8: site of origin carries stolen-knowledge — storing in out-of-play pile for marshalling points`);
            newOutOfPlayPile = [...newOutOfPlayPile, entry];
          } else {
            logDetail(`Step 8: site of origin is tapped non-haven — discarding to site discard pile`);
            newSiteDiscardPile.push(entry);
          }
        } else if (isHaven) {
          logDetail(`Step 8: site of origin is a haven — returning to location deck`);
          newSiteDeck.push(entry);
        } else {
          if (alwaysReturnToDeck && isTapped) {
            logDetail(`Step 8: site of origin carries always-return-to-deck — returning tapped site to location deck`);
          } else {
            logDetail(`Step 8: site of origin is untapped non-haven — returning to location deck`);
          }
          newSiteDeck.push(entry);
        }
      }
    }

    logDetail(`Step 8: company moved to ${mhState.destinationSiteName ?? '?'}, origin site handled`);
    newPlayers[activeIndex] = {
      ...resourcePlayer,
      companies: updatedCompanies,
      siteDeck: newSiteDeck,
      siteDiscardPile: newSiteDiscardPile,
      outOfPlayPile: newOutOfPlayPile,
    };

    // Defer firing the company-arrives-at-site event until we've
    // assembled the final state below.
    companyArrivedAt = {
      companyId: company.id,
      siteInstanceId: company.destinationSite.instanceId as never,
    };
  } else if (mhStateLocal.returnedToOrigin) {
    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      destinationSite: null,
      movementPath: [],
      siteOfOrigin: null,
    };
    logDetail(`Step 8: company was returned to origin — staying at current site (Rule 5.31)`);
    newPlayers[activeIndex] = { ...resourcePlayer, companies: updatedCompanies };
  } else {
    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      siteOfOrigin: null,
    };
    newPlayers[activeIndex] = { ...resourcePlayer, companies: updatedCompanies };
  }

  // --- Step 8a-2: Fire bearer-company-moves discard ---
  // When a company has moved, discard any character items with an
  // on-event: bearer-company-moves + discard-self effect (e.g. Align Palantír).
  if (company.destinationSite && !mhStateLocal.returnedToOrigin) {
    const movedCompany = newPlayers[activeIndex].companies[mhState.activeCompanyIndex];
    let discardedAny = false;
    for (const charId of movedCompany.characters) {
      const charData = newPlayers[activeIndex].characters[charId as string];
      if (!charData) continue;
      const itemsToKeep: import('../index.js').ItemInPlay[] = [];
      const itemsToDiscard: import('../index.js').CardInstance[] = [];
      for (const item of charData.items) {
        const itemDef = state.cardPool[item.definitionId as string] as { name?: string; effects?: readonly import('../index.js').CardEffect[] } | undefined;
        const hasTrigger = getOnEventEffects(itemDef, 'bearer-company-moves').some(
          e => e.apply.type === 'move' && e.apply.select === 'self' && e.apply.to === 'discard',
        );
        if (hasTrigger) {
          logDetail(`bearer-company-moves: discarding "${itemDef?.name ?? item.definitionId}" from ${charId as string}`);
          itemsToDiscard.push(toCardInstance(item));
        } else {
          itemsToKeep.push(item);
        }
      }
      if (itemsToDiscard.length > 0) {
        discardedAny = true;
        newPlayers[activeIndex] = {
          ...newPlayers[activeIndex],
          characters: {
            ...newPlayers[activeIndex].characters,
            [charId as string]: { ...charData, items: itemsToKeep },
          },
          discardPile: [...newPlayers[activeIndex].discardPile, ...itemsToDiscard],
        };
      }
    }
    if (discardedAny) {
      logDetail('bearer-company-moves: finished discarding items from moving company');
    }
  }

  // --- Step 8a-3: Discard leader-controlled factions whose leader moved ---
  // LE "Orcs of Udûn"-style factions are discarded when the controlling leader
  // moves ("Discard the faction if the leader moves or leaves play"). The leave
  // half is handled by the post-action orphan sweep; here we catch movement
  // while the leader is still in play.
  if (company.destinationSite && !mhStateLocal.returnedToOrigin) {
    const movedCompany = newPlayers[activeIndex].companies[mhState.activeCompanyIndex];
    const movedCharIds = new Set(movedCompany.characters.map(id => id as string));
    const factionsToDiscard = newPlayers[activeIndex].cardsInPlay.filter(
      c => c.controlledBy !== undefined && movedCharIds.has(c.controlledBy as string),
    );
    if (factionsToDiscard.length > 0) {
      const discardSet = new Set(factionsToDiscard.map(c => c.instanceId as string));
      for (const f of factionsToDiscard) {
        const fDef = state.cardPool[f.definitionId as string] as { name?: string } | undefined;
        logDetail(`leader-control: discarding "${fDef?.name ?? f.definitionId}" — controlling leader moved`);
      }
      newPlayers[activeIndex] = {
        ...newPlayers[activeIndex],
        cardsInPlay: newPlayers[activeIndex].cardsInPlay.filter(c => !discardSet.has(c.instanceId as string)),
        discardPile: [...newPlayers[activeIndex].discardPile, ...factionsToDiscard.map(toCardInstance)],
      };
    }
  }

  // --- Step 8b: Draw up to hand size (automatic) ---
  // Use intermediate state for hand size resolution so updated companies are visible
  let intermediateState = { ...workingState, players: newPlayers };
  for (let i = 0; i < 2; i++) {
    const p = newPlayers[i];
    const handSize = resolveHandSize(intermediateState, i);
    if (p.hand.length < handSize) {
      const drawCount = Math.min(handSize - p.hand.length, p.playDeck.length);
      if (drawCount > 0) {
        logDetail(`Step 8: player ${p.name} draws ${drawCount} card(s) to reach hand size ${handSize}`);
        newPlayers[i] = {
          ...p,
          hand: [...p.hand, ...p.playDeck.slice(0, drawCount)],
          playDeck: p.playDeck.slice(drawCount),
        };
        intermediateState = { ...intermediateState, players: newPlayers };
      }
    }
  }

  // --- Step 8c: If anyone needs to discard, go to reset-hand step ---
  const needsDiscard = newPlayers.some((p, i) => p.hand.length > resolveHandSize(intermediateState, i));
  let updatedState: GameState = { ...workingState, players: newPlayers };

  // Fire the company-arrives-at-site event hook (River, etc.) on the
  // post-move state. The hook scans both players' cardsInPlay for
  // hazards with a matching `on-event: company-arrives-at-site` and
  // dispatches them to the on-event handler.
  if (companyArrivedAt) {
    updatedState = fireCompanyArrivesAtSite(
      updatedState,
      companyArrivedAt.companyId,
      companyArrivedAt.siteInstanceId,
    );
  }

  // Hall of Fire (dm-134): immediately following this company's M/H phase,
  // if it is at a Haven where a Hall of Fire is in play, the controlling
  // player may untap or heal one of its characters. Enqueued as a pending
  // resolution so it is offered before the company proceeds (whether the
  // turn advances to reset-hand or to the next sub-phase).
  updatedState = fireHavenRestoreTriggers(updatedState, mhStateLocal);

  if (needsDiscard) {
    logDetail(`Step 8: player(s) over hand size — entering reset-hand for discard`);
    return {
      state: {
        ...updatedState,
        phaseState: {
          ...mhStateLocal,
          step: 'reset-hand' as const,
        },
      },
    };
  }

  return advanceAfterCompanyMH(updatedState, mhStateLocal);
}

/**
 * Fire the Hall of Fire (dm-134) restore offer for the active company once
 * its movement/hazard phase has ended. Hall of Fire is a permanent event
 * attached to a Haven (`attachedToSite` = the haven's definition id); when a
 * company controlled by the same player finishes its M/H phase at that haven,
 * the player "may choose for one of its characters to untap or heal (from
 * wounded to tapped)".
 *
 * One `haven-restore-character` pending resolution is enqueued per Hall of
 * Fire copy on the haven, but only when the company actually has a tapped or
 * wounded character to act on — the benefit is optional, so there is no point
 * forcing a pass when nothing can change. The resolution is scoped to the
 * company's M/H sub-phase so it auto-clears if left unresolved.
 */
function fireHavenRestoreTriggers(
  state: GameState,
  mhState: MovementHazardPhaseState,
): GameState {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company?.currentSite) return state;

  const siteDefId = company.currentSite.definitionId;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef) || siteDef.siteType !== 'haven') return state;

  const hasRestorable = company.characters.some(charId => {
    const ch = player.characters[charId as string];
    return ch && (ch.status === CardStatus.Tapped || ch.status === CardStatus.Inverted);
  });

  let result = state;
  for (const card of player.cardsInPlay) {
    if (card.attachedToSite !== siteDefId) continue;
    const def = result.cardPool[card.definitionId as string] as { name?: string; effects?: readonly import('../index.js').CardEffect[] } | undefined;
    for (const e of getOnEventEffects(def, 'company-mh-end-at-site')) {
      if (e.apply?.type !== 'offer-restore-character') continue;
      if (!hasRestorable) {
        logDetail(`company-mh-end-at-site: "${def?.name ?? card.definitionId}" — company ${company.id as string} at ${siteDef.name} has no tapped/wounded character; no offer`);
        continue;
      }
      logDetail(`company-mh-end-at-site: "${def?.name ?? card.definitionId}" fires for company ${company.id as string} at ${siteDef.name}`);
      // Scope to the upcoming Site phase: the company's M/H sub-phase is about
      // to end (advanceAfterCompanyMH sweeps `company-mh-subphase` immediately),
      // so a sub-phase scope would be dropped before the player could act. A
      // Site-phase scope survives the M/H→Site boundary; because any pending
      // resolution short-circuits every phase action, the player resolves it at
      // the very next decision point — i.e. immediately following the company's
      // movement/hazard phase, before the next company's M/H or the site phase.
      result = enqueueResolution(result, {
        source: card.instanceId,
        actor: state.activePlayer!,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: {
          type: 'haven-restore-character',
          companyId: company.id,
          sourceDefinitionId: card.definitionId,
        },
      });
    }
  }

  return result;
}

/**
 * Dispatch the `company-arrives-at-site` on-event hook for the given
 * company arriving at the given site. Scans both players' cardsInPlay
 * for cards whose effects array contains an
 * `on-event: company-arrives-at-site` entry; for each match, applies
 * the configured triggered action (typically `add-constraint`).
 *
 * Site-attached hazards (those with `card.attachedToSite` set, e.g.
 * *River*) only fire when the company is arriving at the bound site
 * location — the binding is by site definition ID, so multiple
 * players' copies of the same site share one trigger condition.
 * Cards without `attachedToSite` fire on every arrival (no current
 * card uses this; reserved for future "any arrival" effects).
 */
function fireCompanyArrivesAtSite(
  state: GameState,
  arrivingCompanyId: import('../index.js').CompanyId,
  siteInstanceId: import('../index.js').CardInstanceId,
): GameState {
  // Resolve the destination site's definition ID so we can match it
  // against any `attachedToSite` bindings on cards in play.
  const arrivalSiteDefId = resolveInstanceId(state, siteInstanceId);

  let newState = state;
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      // Site-attached hazards only fire for the bound site location.
      if (card.attachedToSite && card.attachedToSite !== arrivalSiteDefId) {
        continue;
      }
      const def = state.cardPool[card.definitionId as string] as { name?: string; effects?: readonly import('../index.js').CardEffect[] } | undefined;
      for (const effect of getOnEventEffects(def, 'company-arrives-at-site')) {
        if (effect.apply.type !== 'add-constraint') continue;
        const constraintKind = effect.apply.constraint;
        const scopeName = effect.apply.scope;
        if (!constraintKind || !scopeName) continue;

        // Map scope name to ConstraintScope
        let scope: import('../types/pending.js').ConstraintScope;
        switch (scopeName) {
          case 'company-site-phase':
            scope = { kind: 'company-site-phase', companyId: arrivingCompanyId };
            break;
          case 'turn':
            scope = { kind: 'turn' };
            break;
          case 'until-cleared':
            scope = { kind: 'until-cleared' };
            break;
          default:
            continue;
        }
        let kind: import('../types/pending.js').ActiveConstraint['kind'];
        switch (constraintKind) {
          case 'site-phase-do-nothing':
            kind = { type: 'site-phase-do-nothing' };
            break;
          case 'no-creature-hazards-on-company':
            kind = { type: 'no-creature-hazards-on-company' };
            break;
          case 'deny-scout-resources':
            kind = { type: 'deny-scout-resources' };
            break;
          case 'granted-action': {
            const payload = effect.apply.grantedAction;
            if (!payload) continue;
            kind = {
              type: 'granted-action',
              action: payload.action,
              phase: payload.phase as import('../types/state-phases.js').Phase | undefined,
              window: payload.window,
              cost: payload.cost,
              when: payload.when,
              apply: payload.apply,
            };
            break;
          }
          default:
            continue;
        }
        logDetail(`company-arrives-at-site: "${def?.name}" fires → adding constraint ${constraintKind} on company ${arrivingCompanyId as string}`);
        newState = addConstraint(newState, {
          source: card.instanceId,
          sourceDefinitionId: card.definitionId,
          scope,
          target: { kind: 'company', companyId: arrivingCompanyId },
          kind,
        });
      }
    }
  }

  // Scan allies in the arriving company for discard-self on-event effects.
  newState = fireAllyArrivalEffects(newState, arrivingCompanyId, siteInstanceId);

  return newState;
}

/**
 * Scan allies attached to characters in the arriving company for
 * `on-event: company-arrives-at-site` effects with `discard-self`.
 * When the effect's `when` condition matches the arrival site context,
 * the ally is discarded from its bearer to the owning player's discard pile.
 */
function fireAllyArrivalEffects(
  state: GameState,
  arrivingCompanyId: import('../index.js').CompanyId,
  siteInstanceId: import('../index.js').CardInstanceId,
): GameState {
  const siteDef = state.cardPool[resolveInstanceId(state, siteInstanceId) as string];
  const siteRegion = siteDef && isSiteCard(siteDef) ? siteDef.region : '';

  let newState = state;
  for (let pIdx = 0; pIdx < 2; pIdx++) {
    const player = newState.players[pIdx];
    const company = companyById(player.companies, arrivingCompanyId);
    if (!company) continue;

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char) continue;

      for (const ally of char.allies) {
        const def = newState.cardPool[ally.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
        const context: Record<string, unknown> = { site: { region: siteRegion } };
        const trigger = getOnEventEffects(def, 'company-arrives-at-site').find(
          e => e.apply.type === 'move' && e.apply.select === 'self' && e.apply.to === 'discard'
            && (!e.when || matchesCondition(e.when, context)),
        );
        if (trigger) {
          logDetail(`company-arrives-at-site: ally "${def?.name}" move(self→discard) triggered (site region: ${siteRegion})`);
          const updatedAllies = char.allies.filter(a => a.instanceId !== ally.instanceId);
          newState = updatePlayer(newState, pIdx, p => ({
            ...updateCharacter(p, charInstId, c => ({ ...c, allies: updatedAllies })),
            discardPile: [...p.discardPile, toCardInstance(ally)],
          }));
        }
      }
    }
  }
  return newState;
}

/**
 * Handle the reset-hand step: players with hand > HAND_SIZE must discard.
 * Each discard-card action removes one card. Once both players are at or
 * below hand size, advance to the next company or Site phase.
 */
function handleResetHand(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'discard-card') return wrongActionType(state, action, 'discard-card', 'reset-hand step');

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const discardedCard = findById(player.hand, action.cardInstanceId);
  if (!discardedCard) return { state, error: 'Card not found in hand' };
  const newHand = removeById(player.hand, discardedCard.instanceId);

  const updatedState = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: newHand,
    discardPile: [...p.discardPile, discardedCard],
  }));

  logDetail(`Reset-hand: player ${player.name} discards 1 card (hand now ${newHand.length})`);

  // Check if both players are now at hand size
  if (updatedState.players.every((p, i) => p.hand.length <= resolveHandSize(updatedState, i))) {
    logDetail(`Reset-hand: all players at hand size → advancing`);
    return advanceAfterCompanyMH(updatedState, mhState);
  }

  return { state: updatedState };
}

/**
 * Advance to the next company's M/H sub-phase or to the Site phase
 * after the current company's step 8 is fully resolved.
 */


/**
 * Advance to the next company's M/H sub-phase or to the Site phase
 * after the current company's step 8 is fully resolved.
 */
function advanceAfterCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const currentCompany = state.players[activeIndex].companies[mhState.activeCompanyIndex];
  const updatedHandled = [...mhState.handledCompanyIds, currentCompany.id];

  // Sweep any active constraints / pending resolutions scoped to the
  // company that just finished its M/H sub-phase.
  state = sweepExpired(state, { kind: 'company-mh-end', companyId: currentCompany.id });

  const remainingCount = state.players[activeIndex].companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    // Rule 2.IV.6: auto-merge any of the resource player's companies that
    // ended up at the same non-haven site. Run before resetting moved flags
    // so the merge sees the post-movement company layout.
    const mergedState = autoMergeNonHavenCompanies(state, activeIndex);
    // Reset moved flags and per-site-phase agent flags so the site phase shows a clean slate
    const resetHazardIndex = mergedState.players.findIndex(p => p.id !== mergedState.activePlayer);
    const withAgentReset = resetHazardIndex >= 0
      ? updatePlayer(mergedState, resetHazardIndex, p => ({
          ...p,
          agents: p.agents.map(a => ({ ...a, attackedThisSitePhase: false })),
        }))
      : mergedState;
    const cleanedState = cleanupEmptyCompanies({
      ...updatePlayer(withAgentReset, activeIndex, p => ({
        ...p,
        companies: p.companies.map(c => ({ ...c, moved: false, specialMovement: undefined, extraRegionDistance: undefined })),
      })),
      phaseState: {
        phase: Phase.Site,
        step: 'select-company',
        activeCompanyIndex: 0,
        handledCompanyIds: [],
        automaticAttacksResolved: 0,
        siteEntered: false,
        resourcePlayed: false,
        minorItemAvailable: false,
        hoardBountyAvailable: false,
        thoroughSearchAvailable: false,
        declaredAgentAttack: null,
        awaitingOnGuardReveal: false,
        pendingResourceAction: null,
        opponentInteractionThisTurn: null,
        pendingOpponentInfluence: null,
      },
    });

    // Rule 6.17: if the resource player has no companies, skip the site phase entirely
    if (cleanedState.players[activeIndex].companies.length === 0) {
      logDetail(`Movement/Hazard: all companies handled and none remain → skipping Site phase (rule 6.17), advancing to End-of-Turn`);
      return {
        state: {
          ...cleanedState,
          phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const, resetHandDone: [false, false] as const },
        },
      };
    }

    logDetail(`Movement/Hazard: all companies handled → advancing to Site phase`);
    return { state: cleanedState };
  }

  logDetail(`Movement/Hazard: company ${currentCompany.id} done → returning to select-company (${remainingCount} remaining)`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'select-company' as const,
        handledCompanyIds: updatedHandled,
        movementType: null,
        declaredRegionPath: [],
        maxRegionDistance: BASE_MAX_REGION_DISTANCE,
        hazardsPlayedThisCompany: 0,
        hazardLimitAtReveal: 0,
        preRevealHazardLimitConstraintIds: [],
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: null,
        destinationSiteName: null,
        resourceDrawMax: 0,
        hazardDrawMax: 0,
        resourceDrawCount: 0,
        hazardDrawCount: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
        siteRevealed: false,
        onGuardPlacedThisCompany: false,
        returnedToOrigin: false,
        hazardsEncountered: [],
        ahuntAttacksResolved: 0,
      },
    },
  };
}

/**
 * Check whether any of the creature's region types can be keyed to the
 * company's site path.
 *
 * Each distinct region type is an independent keying option (OR). If the
 * same type appears N times on the creature card, the path must contain
 * at least N regions of that type.
 *
 * Per CoE: "If multiple of the same region type appear on the creature card,
 * the company must be moving through at least that many corresponding regions
 * (but which need not be consecutive)."
 */


/**
 * Check whether any of the creature's region types can be keyed to the
 * company's site path.
 *
 * Each distinct region type is an independent keying option (OR). If the
 * same type appears N times on the creature card, the path must contain
 * at least N regions of that type.
 *
 * Per CoE: "If multiple of the same region type appear on the creature card,
 * the company must be moving through at least that many corresponding regions
 * (but which need not be consecutive)."
 */
function regionTypesMatch(required: readonly RegionType[], path: readonly RegionType[]): boolean {
  // Count how many of each type the creature requires
  const requiredCounts = new Map<RegionType, number>();
  for (const rt of required) requiredCounts.set(rt, (requiredCounts.get(rt) ?? 0) + 1);
  // Count how many of each type are in the path
  const pathCounts = new Map<RegionType, number>();
  for (const rt of path) pathCounts.set(rt, (pathCounts.get(rt) ?? 0) + 1);
  // Any type with enough matches in the path is sufficient (OR)
  for (const [rt, need] of requiredCounts) {
    if ((pathCounts.get(rt) ?? 0) >= need) return true;
  }
  return false;
}

/**
 * Check whether a creature can be keyed to the current company's site path
 * or destination site (CoE rule 2.IV.vii.2).
 *
 * A creature is keyable if any of its {@link CreatureKeyRestriction} entries
 * match at least one of:
 * - A region type on the company's resolved site path
 * - A region name on the company's resolved site path
 * - The destination site type
 * - The destination site name (TODO: not yet checked)
 *
 * @returns An error string if the creature cannot be keyed, or undefined if legal.
 */
function checkCreatureKeying(state: GameState, def: CreatureCard, mhState: MovementHazardPhaseState): string | undefined {
  // Look up the destination site definition by name for keyword checks.
  // The destination belongs to the active (moving) player, so restrict the
  // by-name lookup to that player's alignment — the same physical location
  // has a separate site card per side (e.g. The Under-gates exists as hero,
  // minion, and balrog versions with different keywords/types).
  const moverAlignment = state.players[getPlayerIndex(state, state.activePlayer ?? state.players[0].id)]?.alignment;
  const destSiteDef = mhState.destinationSiteName
    ? Object.values(state.cardPool).find(
        c => isSiteCard(c) && c.name === mhState.destinationSiteName
          && (moverAlignment === undefined || c.alignment === moverAlignment),
      )
    : undefined;
  const destSiteCard = destSiteDef && isSiteCard(destSiteDef) ? destSiteDef : undefined;

  // Build sitePath counts from the destination site's own sitePath (for Rain-drake
  // and similar cards that gate on destinationSite.sitePath.*Count conditions).
  const destSitePath = destSiteCard?.sitePath ?? [];
  const destPathCounts: Record<string, number> = {};
  for (const rt of destSitePath) {
    const key2 = `${rt}Count`;
    destPathCounts[key2] = (destPathCounts[key2] ?? 0) + 1;
  }
  const inPlayNames = buildInPlayNames(state);
  const whenCtxBase: Record<string, unknown> = {
    inPlay: inPlayNames,
    destinationSite: { sitePath: destPathCounts },
  };

  // region-keying-boost environments (Withered Lands): build the candidate
  // paths once. Each is the resolved path with at most one boost applied.
  const keyingBoosts = collectRegionKeyingBoosts(state);
  const candidateRegionPaths = regionPathsWithBoosts(mhState.resolvedSitePath, keyingBoosts);

  for (const key of def.keyedTo) {
    // When-condition guards the entry (DoN, sitePath-count conditions, etc.)
    if (key.when) {
      if (!matchesCondition(key.when, whenCtxBase)) continue;
    }
    // Check region types against site path (count-based: if the creature
    // lists a region type N times, the path must contain at least N of that
    // type). Each boosted variant of the path is tried in addition to the base.
    if (key.regionTypes && key.regionTypes.length > 0) {
      if (candidateRegionPaths.some(p => regionTypesMatch(key.regionTypes!, p))) {
        logDetail(`Creature "${def.name}" keyable to region type(s): ${key.regionTypes.join(', ')}`);
        return undefined;
      }
    }
    // Check region names against site path names
    if (key.regionNames && key.regionNames.length > 0) {
      const pathNames = mhState.resolvedSitePathNames;
      if (key.regionNames.some(rn => pathNames.includes(rn))) {
        logDetail(`Creature "${def.name}" keyable to region name: ${key.regionNames.join(', ')}`);
        return undefined;
      }
    }
    // Check site types against destination
    if (key.siteTypes && key.siteTypes.length > 0 && mhState.destinationSiteType) {
      if (key.siteTypes.includes(mhState.destinationSiteType)) {
        logDetail(`Creature "${def.name}" keyable to site type: ${mhState.destinationSiteType}`);
        return undefined;
      }
    }
    // Check site names against destination site name
    if (key.siteNames && key.siteNames.length > 0 && mhState.destinationSiteName) {
      if (key.siteNames.includes(mhState.destinationSiteName)) {
        logDetail(`Creature "${def.name}" keyable to site name: ${mhState.destinationSiteName}`);
        return undefined;
      }
    }
    // Check site keywords against destination site's keywords
    if (key.siteKeywords && key.siteKeywords.length > 0 && destSiteCard) {
      const kws = destSiteCard.keywords ?? [];
      if (key.siteKeywords.some(kw => kws.includes(kw))) {
        logDetail(`Creature "${def.name}" keyable to site keyword: ${key.siteKeywords.join('/')}`);
        return undefined;
      }
    }
    // Check adjacentToSiteKeywords — destination must be adjacent to a site with the keyword
    if (key.adjacentToSiteKeywords && key.adjacentToSiteKeywords.length > 0 && destSiteCard && mhState.destinationSiteName) {
      for (const kw of key.adjacentToSiteKeywords) {
        const kwSites = Object.values(state.cardPool).filter(c => isSiteCard(c) && (c.keywords ?? []).includes(kw));
        for (const kwSite of kwSites) {
          if (isSiteCard(kwSite)) {
            const r1 = resolveAdjacency(state, kwSite, mhState.destinationSiteName);
            const r2 = destSiteCard.name ? resolveAdjacency(state, destSiteCard, kwSite.name) : undefined;
            if (r1 !== undefined || r2 !== undefined) {
              logDetail(`Creature "${def.name}" keyable — destination adjacent to ${kw} site "${kwSite.name}"`);
              return undefined;
            }
          }
        }
      }
    }
  }

  const keyDesc = def.keyedTo.map(k => {
    const parts: string[] = [];
    if (k.regionTypes?.length) parts.push(`regions: ${k.regionTypes.join('/')}`);
    if (k.regionNames?.length) parts.push(`named: ${k.regionNames.join('/')}`);
    if (k.siteTypes?.length) parts.push(`sites: ${k.siteTypes.join('/')}`);
    if (k.siteNames?.length) parts.push(`at: ${k.siteNames.join('/')}`);
    if (k.siteKeywords?.length) parts.push(`site-keyword: ${k.siteKeywords.join('/')}`);
    if (k.adjacentToSiteKeywords?.length) parts.push(`adjacent-to: ${k.adjacentToSiteKeywords.join('/')}`);
    return parts.join(', ');
  }).join(' OR ');
  return `${def.name} cannot be keyed to this company's path (requires ${keyDesc})`;
}

/**
 * Handle the 'select-company' action: resource player picks which company
 * resolves its M/H sub-phase next.
 */


/**
 * Handle the 'select-company' action: resource player picks which company
 * resolves its M/H sub-phase next.
 */
function handleSelectCompany(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'select-company') {
    return { state, error: `Expected 'select-company' action during select-company step, got '${action.type}'` };
  }

  const player = playerById(state, state.activePlayer)!;
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIndex === -1) return { state, error: 'Company not found' };
  const company = player.companies[companyIndex];
  const isMoving = company.destinationSite !== null;

  // Compute effective max region distance from base + card effects (e.g. Cram's extra-region-movement),
  // then apply any game-wide environment reduction (e.g. No Way Forward, dm-75).
  const baseMaxRegionDistance = BASE_MAX_REGION_DISTANCE + (company.extraRegionDistance ?? 0);
  const maxRegionDistance = applyRegionMovementReduction(state, baseMaxRegionDistance);
  logDetail(`Movement/Hazard: selected company ${action.companyId} (index ${companyIndex}), moving=${isMoving}, maxRegions=${maxRegionDistance} (base ${BASE_MAX_REGION_DISTANCE} + extra ${company.extraRegionDistance ?? 0}${maxRegionDistance < baseMaxRegionDistance ? `, reduced from ${baseMaxRegionDistance} by environment` : ''}) → advancing to reveal-new-site`);
  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'reveal-new-site' as const,
        activeCompanyIndex: companyIndex,
        siteRevealed: isMoving,
        maxRegionDistance,
      },
    },
  };
}

/**
 * Handle the 'reveal-new-site' step (CoE step 1): the new site card is
 * revealed and the resource player declares their movement path.
 *
 * For non-moving companies, accepts a 'pass' action to advance.
 * For moving companies, accepts a 'declare-path' action that sets the
 * movement type and (for region movement) the region path.
 * For Under-deeps movement, transitions to `under-deeps-roll` when a roll
 * is required, or directly to `set-hazard-limit` when the roll is 0.
 *
 * TODO: triggering events on site reveal
 */
function handleRevealNewSite(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  // Non-moving company: pass to advance (skip declare-path, go to set-hazard-limit)
  // Set destinationSiteType/Name to current site so creatures can be keyed to it
  if (action.type === 'pass') {
    const playerIdx = getPlayerIndex(state, action.player);
    const nonMovingCompany = state.players[playerIdx].companies[mhState.activeCompanyIndex];
    const currentSiteDef = nonMovingCompany.currentSite ? defById(state, nonMovingCompany.currentSite.definitionId) : undefined;
    const currentSite = currentSiteDef && isSiteCard(currentSiteDef) ? currentSiteDef : undefined;
    logDetail(`Movement/Hazard: non-moving company → auto-advancing through set-hazard-limit`);
    return enterSetHazardLimitAndAutoAdvance(state, {
      ...mhState,
      destinationSiteType: currentSite?.siteType ?? null,
      destinationSiteName: currentSite?.name ?? null,
    });
  }

  if (action.type !== 'declare-path') {
    return { state, error: `Expected 'pass' or 'declare-path' during reveal-new-site step, got '${action.type}'` };
  }

  // Resolve origin and destination sites
  const player = playerById(state, action.player)!;
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company?.destinationSite) {
    return { state, error: `Active company has no destination site` };
  }

  const originDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  const destDefId = company.destinationSite.definitionId;
  const destDef = destDefId ? defById(state, destDefId) : undefined;

  if (!originDef || !isSiteCard(originDef) || !destDef || !isSiteCard(destDef)) {
    return { state, error: `Could not resolve origin or destination site definitions` };
  }

  // Compute resolved site path (region types) and region names
  let resolvedSitePath: RegionType[] = [];
  const resolvedSitePathNames: string[] = [];

  if (action.movementType === 'starter') {
    // Starter: use the site card's sitePath for region types
    const originIsHaven = originDef.siteType === 'haven';
    const destIsHaven = destDef.siteType === 'haven';
    if (originIsHaven && destIsHaven && originDef.havenPaths) {
      resolvedSitePath = [...(originDef.havenPaths[destDef.name] ?? [])];
    } else if (originIsHaven && !destIsHaven) {
      resolvedSitePath = [...destDef.sitePath];
    } else if (!originIsHaven && destIsHaven) {
      resolvedSitePath = [...originDef.sitePath];
    }
    // Names: origin and destination regions
    if (originDef.region) resolvedSitePathNames.push(originDef.region);
    if (destDef.region && destDef.region !== originDef.region) resolvedSitePathNames.push(destDef.region);
  } else if (action.movementType === 'region' && action.regionPath) {
    // Region: look up each region's regionType and name
    for (const regionDefId of action.regionPath) {
      const regionDef = defById(state, regionDefId);
      if (regionDef && regionDef.cardType === 'region') {
        resolvedSitePath.push(regionDef.regionType);
        resolvedSitePathNames.push(regionDef.name);
      }
    }
  } else if (action.movementType === 'special') {
    // Special movement (e.g. Gwaihir): no region path traversed.
    // Only site-type keyed creatures can be played against this company.
    logDetail(`Special movement: no region path — only site-keyed hazards apply`);
  } else if (action.movementType === 'under-deeps') {
    // Under-deeps: no region path — only site-type keyed hazards apply.
    // Determine required roll and either advance directly or enter the roll step.
    logDetail(`Under-deeps movement: no region path — only site-keyed hazards apply`);
    const required = getUnderDeepsRequiredRoll(state, originDef, destDef);
    logDetail(`Under-deeps roll required: ${required}`);
    if (required === 0) {
      logDetail(`Under-deeps: roll not required (0) — auto-advancing through set-hazard-limit`);
      return enterSetHazardLimitAndAutoAdvance(state, {
        ...mhState,
        movementType: action.movementType,
        declaredRegionPath: [],
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: destDef.siteType,
        destinationSiteName: destDef.name,
      });
    }
    logDetail(`Under-deeps: roll required (>= ${required}) — entering under-deeps-roll step`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'under-deeps-roll' as const,
          movementType: action.movementType,
          declaredRegionPath: [],
          resolvedSitePath: [],
          resolvedSitePathNames: [],
          destinationSiteType: destDef.siteType,
          destinationSiteName: destDef.name,
          underDeepsRollRequired: required,
        },
      },
    };
  }

  logDetail(`Movement/Hazard: path declared (${action.movementType}, ${resolvedSitePath.length} region types: ${resolvedSitePath.join(', ')}) → auto-advancing through set-hazard-limit`);
  return enterSetHazardLimitAndAutoAdvance(state, {
    ...mhState,
    movementType: action.movementType,
    declaredRegionPath: action.regionPath ?? [],
    resolvedSitePath,
    resolvedSitePathNames,
    destinationSiteType: destDef.siteType,
    destinationSiteName: destDef.name,
  });
}

/**
 * Look up the required 2d6 roll for Under-deeps movement between two sites.
 *
 * Checks origin's `adjacentSites` for the destination, then (if not found)
 * checks the destination's `adjacentSites` for the origin. When the origin
 * is a surface site (not under-deeps), the roll is always 0.
 */
function getUnderDeepsRequiredRoll(state: GameState, origin: import('../index.js').SiteCard, dest: import('../index.js').SiteCard): number {
  const originIsUD = origin.keywords?.includes('under-deeps') ?? false;
  if (!originIsUD) return 0;

  const fromOrigin = resolveAdjacency(state, origin, dest.name);
  if (fromOrigin !== undefined) return fromOrigin;

  const fromDest = resolveAdjacency(state, dest, origin.name);
  if (fromDest !== undefined) return fromDest;

  return 0;
}

/**
 * Handle the `under-deeps-roll` step: the resource player rolls 2d6.
 *
 * - Roll >= required: company moves; advance to `set-hazard-limit`.
 * - Roll < required: company stays; destination returned to location deck;
 *   advance to next company (does NOT count as "returned to origin").
 */
function handleUnderDeepsRoll(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
  if (action.type !== 'under-deeps-roll') {
    return { state, error: `Expected 'under-deeps-roll' during under-deeps-roll step, got '${action.type}'` };
  }

  const required = mhState.underDeepsRollRequired ?? 0;
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const rollTotal = roll.die1 + roll.die2;
  logDetail(`Under-deeps roll: ${roll.die1}+${roll.die2}=${rollTotal} vs required ${required}`);

  const activeIndex = getPlayerIndex(state, action.player);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  const destName = company.destinationSite ? cardName(state, company.destinationSite.definitionId, '?') : '?';

  const outcome = rollTotal >= required ? 'travels' : 'stays';
  const rollEffect = diceRollEffect(
    player.name,
    roll,
    `Under-deeps movement to ${destName}: ${roll.die1}+${roll.die2}=${rollTotal} (need ${required}) — ${outcome}`,
  );

  if (rollTotal >= required) {
    logDetail(`Under-deeps roll SUCCESS — auto-advancing through set-hazard-limit`);
    const successPlayers = clonePlayers(state);
    successPlayers[activeIndex] = { ...successPlayers[activeIndex], lastDiceRoll: roll };
    const stateAfterRoll: GameState = { ...state, rng, cheatRollTotal, players: successPlayers };
    const advResult = enterSetHazardLimitAndAutoAdvance(stateAfterRoll, {
      ...mhState,
      underDeepsRollRequired: undefined,
    });
    return { ...advResult, effects: [rollEffect, ...(advResult.effects ?? [])] };
  }

  logDetail(`Under-deeps roll FAILURE — company stays at ${company.currentSite ? cardName(state, company.currentSite.definitionId, '?') : '?'}, returning destination to site deck`);

  // Return destination site to location deck (no "returned" trigger)
  const newPlayers = clonePlayers(state);
  const activePlayer = newPlayers[activeIndex];
  const updatedCompanies = [...activePlayer.companies];
  const destInst = company.destinationSite;

  updatedCompanies[mhState.activeCompanyIndex] = {
    ...company,
    destinationSite: null,
  };

  let newSiteDeck = activePlayer.siteDeck;
  if (destInst) {
    newSiteDeck = [...activePlayer.siteDeck, toCardInstance(destInst)];
  }

  newPlayers[activeIndex] = {
    ...activePlayer,
    companies: updatedCompanies,
    siteDeck: newSiteDeck,
    lastDiceRoll: roll,
  };

  const withRoll: GameState = { ...state, rng, cheatRollTotal, players: newPlayers };
  const result = advanceAfterCompanyMH(withRoll, { ...mhState, underDeepsRollRequired: undefined });
  return { ...result, effects: [rollEffect, ...(result.effects ?? [])] };
}

/**
 * Generate a unique company ID for a player by finding the highest existing
 * index among their companies and incrementing it. This avoids ID collisions
 * that can occur when companies are merged (removing lower-indexed IDs) and
 * then new companies are created.
 */



/**
 * Handle tap-hazard-card-for-limit: hazard player taps a cardsInPlay permanent
 * event (e.g. Power Built by Waiting) to increase the hazard limit against the
 * current target company by the card's HazardLimitSwapEffect.tapValue.
 *
 * Does NOT count against the hazard limit itself.
 */
function handleTapHazardCardForLimit(
  state: GameState,
  action: TapHazardCardForLimitAction,
  _mhState: MovementHazardPhaseState,
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Find the card in cardsInPlay
  const cardIdx = player.cardsInPlay.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx < 0) return { state, error: `tap-hazard-card-for-limit: card ${action.cardInstanceId as string} not found in cardsInPlay` };

  const card = player.cardsInPlay[cardIdx];
  if (card.status !== CardStatus.Untapped) return { state, error: `tap-hazard-card-for-limit: card ${action.cardInstanceId as string} is already tapped` };

  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find((e): e is HazardLimitSwapEffect => e.type === 'hazard-limit-swap');
  if (!effect) return { state, error: `tap-hazard-card-for-limit: no hazard-limit-swap effect on ${card.definitionId as string}` };

  const defName = (def as { name?: string } | undefined)?.name ?? card.definitionId as string;
  logDetail(`Tap hazard card for limit: "${defName}" taps → +${effect.tapValue} hazard limit against company ${action.targetCompanyId as string}`);

  // Tap the card
  const newCardsInPlay = player.cardsInPlay.map((c, i) =>
    i === cardIdx ? { ...c, status: CardStatus.Tapped } : c,
  );
  const stateAfterTap = updatePlayer(state, playerIndex, p => ({ ...p, cardsInPlay: newCardsInPlay }));

  // Add hazard-limit-modifier constraint on the target company
  const stateWithConstraint = addConstraint(stateAfterTap, {
    source: action.cardInstanceId,
    sourceDefinitionId: card.definitionId,
    target: { kind: 'company', companyId: action.targetCompanyId },
    kind: { type: 'hazard-limit-modifier', value: effect.tapValue },
    scope: { kind: 'company-mh-phase', companyId: action.targetCompanyId },
  });

  return { state: stateWithConstraint };
}

/**
 * Handle pay-hazard-limit-to-untap-card: hazard player spends hazard limit
 * slots to untap a tapped cardsInPlay permanent event (e.g. Power Built by
 * Waiting). Increments hazardsPlayedThisCompany by the effect's cost.
 */
function handlePayHazardLimitToUntapCard(
  state: GameState,
  action: PayHazardLimitToUntapCardAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  // Find the card in cardsInPlay
  const cardIdx = player.cardsInPlay.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx < 0) return { state, error: `pay-hazard-limit-to-untap-card: card ${action.cardInstanceId as string} not found in cardsInPlay` };

  const card = player.cardsInPlay[cardIdx];
  if (card.status !== CardStatus.Tapped) return { state, error: `pay-hazard-limit-to-untap-card: card ${action.cardInstanceId as string} is not tapped` };

  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find((e): e is HazardLimitSwapEffect => e.type === 'hazard-limit-swap');
  if (!effect) return { state, error: `pay-hazard-limit-to-untap-card: no hazard-limit-swap effect on ${card.definitionId as string}` };

  const defName = (def as { name?: string } | undefined)?.name ?? card.definitionId as string;
  const newHazardCount = mhState.hazardsPlayedThisCompany + effect.untapCost;
  logDetail(`Pay hazard limit to untap: "${defName}" costs ${effect.untapCost} hazard limit (${newHazardCount}/${currentHazardLimit(state, mhState, action.targetCompanyId)}) → card untaps`);

  // Untap the card
  const newCardsInPlay = player.cardsInPlay.map((c, i) =>
    i === cardIdx ? { ...c, status: CardStatus.Untapped } : c,
  );
  const stateAfterUntap = updatePlayer(state, playerIndex, p => ({ ...p, cardsInPlay: newCardsInPlay }));

  return {
    state: {
      ...stateAfterUntap,
      phaseState: { ...mhState, hazardsPlayedThisCompany: newHazardCount },
    },
  };
}

/**
 * Handle reserve-creature: hazard player places a Dragon or Drake from hand
 * into the Summons from Long Sleep (as-39) reservation slot.
 *
 * Free action — does NOT count against the hazard limit. The creature
 * leaves the hand and enters player.reservedCreatures keyed to the AS-39
 * permanent-event instance.
 */
function handleReserveCreature(
  state: GameState,
  action: import('../types/actions-movement-hazard.js').ReserveCreatureAction,
  _mhState: MovementHazardPhaseState,
): ReducerResult {
  const hazardIdx = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIdx];

  // Validate AS-39 is in cardsInPlay
  const as39 = hazardPlayer.cardsInPlay.find(c => c.instanceId === action.sourceCardInstanceId);
  if (!as39) return { state, error: `reserve-creature: AS-39 card ${action.sourceCardInstanceId as string} not found in cardsInPlay` };

  // Validate no creature already reserved
  const alreadyReserved = hazardPlayer.reservedCreatures.some(
    r => r.sourceCardInstanceId === action.sourceCardInstanceId,
  );
  if (alreadyReserved) return { state, error: `reserve-creature: AS-39 slot already occupied` };

  // Find creature in hand
  const handCard = findById(hazardPlayer.hand, action.cardInstanceId);
  if (!handCard) return { state, error: `reserve-creature: card ${action.cardInstanceId as string} not found in hand` };

  const def = defById(state, handCard.definitionId);
  if (!def || def.cardType !== 'hazard-creature') return { state, error: `reserve-creature: ${handCard.definitionId as string} is not a hazard-creature` };

  const creatureDef = def;
  const race = creatureDef.race.toLowerCase();
  if (race !== 'dragon' && race !== 'drake') {
    return { state, error: `reserve-creature: only Dragon or Drake can be reserved (got ${race})` };
  }

  logDetail(`Summons from Long Sleep: reserving "${creatureDef.name}" (${race}) — does not count against hazard limit`);

  return {
    state: updatePlayer(state, hazardIdx, p => ({
      ...p,
      hand: removeById(p.hand, handCard.instanceId),
      reservedCreatures: [
        ...p.reservedCreatures,
        { sourceCardInstanceId: action.sourceCardInstanceId, creature: handCard },
      ],
    })),
  };
}

/**
 * Handle play-reserved-creature: hazard player plays the Dragon or Drake
 * reserved in the AS-39 slot as though it were in hand.
 *
 * Counts against the hazard limit. The creature enters the chain with a
 * +2 prowess bonus and a reference to the AS-39 card so it is discarded
 * after combat.
 */
function handlePlayReservedCreature(
  state: GameState,
  action: import('../types/actions-movement-hazard.js').PlayReservedCreatureAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const hazardIdx = getPlayerIndex(state, action.player);
  const hazardPlayerState = state.players[hazardIdx];

  // Find reservation entry
  const reservationEntry = hazardPlayerState.reservedCreatures.find(
    r => r.sourceCardInstanceId === action.sourceCardInstanceId,
  );
  if (!reservationEntry) {
    return { state, error: `play-reserved-creature: no reserved creature for AS-39 ${action.sourceCardInstanceId as string}` };
  }

  const creatureCard = reservationEntry.creature;
  const def = defById(state, creatureCard.definitionId);
  if (!def || def.cardType !== 'hazard-creature') {
    return { state, error: `play-reserved-creature: reserved card is not a hazard-creature` };
  }

  // Check hazard limit
  const liveLimit = currentHazardLimit(state, mhState, action.targetCompanyId);
  if (mhState.hazardsPlayedThisCompany >= liveLimit) {
    return { state, error: `play-reserved-creature: hazard limit reached (${liveLimit})` };
  }

  // Validate chain is null (creatures must initiate new chain)
  if (state.chain !== null) {
    return { state, error: `play-reserved-creature: creatures must initiate a new chain` };
  }

  logDetail(`Summons from Long Sleep: playing reserved creature "${(def).name}" (+2 prowess) against company ${action.targetCompanyId as string} (${mhState.hazardsPlayedThisCompany + 1}/${liveLimit})`);

  // Remove creature from reservation slot
  let newState = updatePlayer(state, hazardIdx, p => ({
    ...p,
    reservedCreatures: p.reservedCreatures.filter(
      r => r.sourceCardInstanceId !== action.sourceCardInstanceId,
    ),
  }));

  // Increment hazard count
  newState = {
    ...newState,
    phaseState: {
      ...mhState,
      hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
      resourcePlayerPassed: false,
    },
  };

  // Initiate chain with +2 prowess bonus and reservingCardInstanceId
  const payload: import('../index.js').ChainEntryPayload = {
    type: 'creature',
    prowessBonus: 2,
    reservingCardInstanceId: action.sourceCardInstanceId,
  };
  newState = initiateChain(newState, action.player, creatureCard, payload);

  return { state: newState };
}

/**
 * Handle play-creature-from-discard: hazard player plays a hazard creature from
 * their own discard pile as an immediate attack, driven by a short-event
 * carrying a `play-creature-from-discard` effect (Exhalation of Decay, dm-55).
 *
 * Does NOT count against the hazard limit. The driving short-event card is
 * discarded on play. The creature enters the chain with the effect's prowess
 * modifier applied and, after combat, is disposed by the normal
 * combat-finalization rules (defender's kill pile if defeated, otherwise back
 * to the discard pile).
 */
function handlePlayCreatureFromDiscard(
  state: GameState,
  action: import('../types/actions-movement-hazard.js').PlayCreatureFromDiscardAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const hazardIdx = getPlayerIndex(state, action.player);
  const hazardPlayerState = state.players[hazardIdx];

  // Validate the driving short-event card is in hand and carries the effect.
  const eventCard = findById(hazardPlayerState.hand, action.cardInstanceId);
  if (!eventCard) {
    return { state, error: `play-creature-from-discard: event card ${action.cardInstanceId as string} not found in hand` };
  }
  const eventDef = defById(state, eventCard.definitionId);
  const effect = eventDef
    ? getCardEffects(eventDef).find(
        (e): e is import('../index.js').PlayCreatureFromDiscardEffect =>
          e.type === 'play-creature-from-discard',
      )
    : undefined;
  if (!effect) {
    return { state, error: `play-creature-from-discard: ${eventCard.definitionId as string} has no play-creature-from-discard effect` };
  }

  // Validate the target creature is in the discard pile and matches the filter.
  const creatureCard = findById(hazardPlayerState.discardPile, action.creatureInstanceId);
  if (!creatureCard) {
    return { state, error: `play-creature-from-discard: creature ${action.creatureInstanceId as string} not found in discard pile` };
  }
  const creatureDef = defById(state, creatureCard.definitionId);
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') {
    return { state, error: `play-creature-from-discard: ${creatureCard.definitionId as string} is not a hazard-creature` };
  }
  if (!matchesCondition(effect.filter, creatureDef as unknown as Record<string, unknown>)) {
    return { state, error: `play-creature-from-discard: ${creatureCard.definitionId as string} does not match the effect filter` };
  }

  // Creatures must initiate a new chain.
  if (state.chain !== null) {
    return { state, error: `play-creature-from-discard: creatures must initiate a new chain` };
  }

  const creatureName = (creatureDef as { name?: string }).name ?? (creatureCard.definitionId as string);
  logDetail(
    `Exhalation of Decay: playing "${creatureName}" from discard pile (prowess ${effect.prowessModifier >= 0 ? '+' : ''}${effect.prowessModifier}) against company ${action.targetCompanyId as string} — does NOT count against hazard limit`,
  );

  // Remove the event card from hand → discard, and the creature from discard.
  let newState = updatePlayer(state, hazardIdx, p => ({
    ...p,
    hand: removeById(p.hand, eventCard.instanceId),
    discardPile: [
      ...removeById(p.discardPile, creatureCard.instanceId),
      toCardInstance(eventCard),
    ],
  }));

  // Resume the resource player's window after this hazard play (rule 5.27).
  newState = {
    ...newState,
    phaseState: { ...mhState, resourcePlayerPassed: false },
  };

  // Initiate the creature combat with the effect's prowess modifier. No
  // reservingCardInstanceId — the short event was already discarded.
  const payload: import('../index.js').ChainEntryPayload = {
    type: 'creature',
    prowessBonus: effect.prowessModifier,
  };
  newState = initiateChain(newState, action.player, creatureCard, payload);

  return { state: newState };
}

/**
 * Compute the base hazard limit for a company (CoE step 3, rule 2.IV.iii).
 *
 * The limit equals the greater of the company's current size or 2,
 * then halved (rounded up) if the hazard player accessed the sideboard
 * during this turn's untap phase. The result is fixed for the entire
 * company's M/H phase, even if characters are later eliminated.
 */


/**
 * Snapshot the company's hazard limit at the moment its new site is
 * revealed (CoE step 3, rule 2.IV.iii; METD §5). The result is the
 * "pre-reveal" baseline that subsequent post-reveal modifiers add to.
 *
 * The base equals max(companySize, 2), halved (rounded up) if the hazard
 * player accessed the sideboard during this turn's untap phase, plus any
 * `hazard-limit-modifier` constraints that already exist at this moment.
 * Returned alongside the IDs of the constraints that were folded in, so
 * the running limit can avoid double-counting them.
 */
/**
 * Build the per-company context consumed by `hazard-limit-environment`
 * effects (Eyes of the Shadow dm-56). Exposes:
 * - `company.size` — effective size (CoE rule 3.24, Hobbits/Orc scouts ½).
 * - `company.hasWizard` — whether a Wizard avatar is in the company.
 * - `company.maxNonRangerMind` — the highest mind among the company's
 *   characters that are not rangers (0 if none).
 *
 * The company belongs to the active (moving) player, so its characters are
 * resolved from `state.players[activeIndex].characters`.
 */
function buildCompanyHazardContext(
  state: GameState,
  company: Company,
  activeIndex: number,
): { company: { size: number; hasWizard: boolean; maxNonRangerMind: number } } {
  const player = state.players[activeIndex];
  const size = companyEffectiveSize(state, company);
  let hasWizard = false;
  let maxNonRangerMind = 0;
  for (const charId of company.characters) {
    const char = player.characters[charId as string];
    if (!char) continue;
    const def = defById(state, char.definitionId);
    if (!def || !isCharacterCard(def)) continue;
    if (def.race === Race.Wizard) hasWizard = true;
    const isRanger = def.skills?.includes(Skill.Ranger) ?? false;
    if (!isRanger && def.mind !== null && def.mind > maxNonRangerMind) {
      maxNonRangerMind = def.mind;
    }
  }
  return { company: { size, hasWizard, maxNonRangerMind } };
}

function snapshotHazardLimit(
  state: GameState,
  company: Company,
): { limit: number; preRevealConstraintIds: readonly string[] } {
  const companySize = companyEffectiveSize(state, company);
  let limit = Math.max(companySize, 2);
  logDetail(`Hazard limit (step 3): company size ${companySize} → base limit ${limit}`);

  // Hazard player is the non-active player
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const hazardIndex = 1 - activeIndex;
  const hazardPlayer = state.players[hazardIndex];

  if (hazardPlayer.sideboardAccessedDuringUntap) {
    const halved = Math.ceil(limit / 2);
    logDetail(`Hazard limit halved (hazard player accessed sideboard during untap): ${limit} → ${halved}`);
    limit = halved;
  }

  const preRevealConstraintIds: string[] = [];
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type === 'hazard-limit-modifier'
        && constraint.target.kind === 'company'
        && constraint.target.companyId === company.id) {
      const prev = limit;
      limit += constraint.kind.value;
      preRevealConstraintIds.push(constraint.id);
      logDetail(`Hazard limit modified by ${constraint.kind.value} (${constraint.sourceDefinitionId as string}): ${prev} → ${limit}`);
    }
  }

  // Apply site-rule hazard-limit-modifier from the destination site's effects.
  // Only for moving companies ("moving to this site" — non-moving companies stay).
  if (company.destinationSite) {
    const destDef = defById(state, company.destinationSite.definitionId);
    if (destDef && isSiteCard(destDef)) {
      for (const eff of destDef.effects ?? []) {
        if (eff.type === 'site-rule' && eff.rule === 'hazard-limit-modifier') {
          const prev = limit;
          limit += eff.value;
          logDetail(`Hazard limit modified by ${eff.value} (site-rule on ${destDef.name}): ${prev} → ${limit}`);
        }
      }
    }
  }

  // Environment hazard-limit-environment effects (Eyes of the Shadow dm-56):
  // each in-play card whose `when` matches this company adds its value to the
  // company's hazard limit. The condition is evaluated against a per-company
  // context (size, hasWizard, maxNonRangerMind). Only moving companies count
  // ("for each moving company"), so a stationary company is never boosted.
  if (company.destinationSite) {
    const envContext = buildCompanyHazardContext(state, company, activeIndex);
    for (const player of state.players) {
      for (const card of player.cardsInPlay) {
        const def = defById(state, card.definitionId);
        if (!def) continue;
        for (const eff of getCardEffects(def)) {
          if (eff.type !== 'hazard-limit-environment') continue;
          if (matchesContext(eff.when, envContext)) {
            const prev = limit;
            limit += eff.value;
            logDetail(`Hazard limit modified by ${eff.value} (environment ${def.name}): ${prev} → ${limit}`);
          }
        }
      }
    }
  }

  limit = Math.max(limit, 0);

  logDetail(`Hazard limit at reveal: ${limit}`);
  return { limit, preRevealConstraintIds };
}

/**
 * The company's running hazard limit at any point during its M/H phase.
 *
 * Equals the at-reveal snapshot ({@link MovementHazardPhaseState.hazardLimitAtReveal})
 * plus any `hazard-limit-modifier` constraints introduced *after* the
 * snapshot. Pre-reveal constraints are skipped because their value is
 * already folded into the snapshot.
 *
 * Per METD §5, post-reveal modifiers take effect for future hazard plays
 * in resolution order; they do not retroactively cancel hazards already
 * announced.
 */
export function currentHazardLimit(
  state: GameState,
  mhState: MovementHazardPhaseState,
  companyId: import('../types/common.js').CompanyId,
): number {
  let limit = mhState.hazardLimitAtReveal;
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'hazard-limit-modifier') continue;
    if (constraint.target.kind !== 'company') continue;
    if (constraint.target.companyId !== companyId) continue;
    if (mhState.preRevealHazardLimitConstraintIds.includes(constraint.id)) continue;
    limit += constraint.kind.value;
  }
  return Math.max(limit, 0);
}

/**
 * Collect all ahunt-attack effects from both players' cardsInPlay that
 * match the current company's movement path. Returns an array of
 * { instanceId, effect } pairs, one per matching long-event.
 */
function collectMatchingAhuntAttacks(
  state: GameState,
  mhState: MovementHazardPhaseState,
): { instanceId: CardInstanceId; effect: AhuntAttackEffect }[] {
  const pathNames = mhState.resolvedSitePathNames;
  const pathTypes = mhState.resolvedSitePath as readonly string[];
  if (pathNames.length === 0) return [];

  const inPlayNames = buildInPlayNames(state);
  const results: { instanceId: CardInstanceId; effect: AhuntAttackEffect }[] = [];

  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'ahunt-attack') continue;

        const extendedApplies = effect.extended
          && matchesCondition(effect.extended.when, { inPlay: inPlayNames } as Record<string, unknown>);

        const regionNames = extendedApplies && effect.extended
          ? [...effect.regionNames, ...(effect.extended.regionNames ?? [])]
          : [...effect.regionNames];
        const regionTypes = extendedApplies && effect.extended
          ? [...(effect.regionTypes ?? []), ...(effect.extended.regionTypes ?? [])]
          : [...(effect.regionTypes ?? [])];

        const nameMatch = regionNames.some(rn => pathNames.includes(rn));
        const typeMatch = regionTypes.some(rt => pathTypes.includes(rt));

        if (nameMatch || typeMatch) {
          results.push({ instanceId: card.instanceId, effect });
        }
      }
    }
  }

  return results;
}

/**
 * Handle the order-effects step (CoE step 4).
 *
 * Scans cardsInPlay for ahunt-attack long-events whose region lists
 * overlap the current company's movement path. Each matching ahunt
 * effect initiates a creature-like combat (one at a time, tracked by
 * ahuntAttacksResolved). After all ahunt combats are resolved,
 * transitions to draw-cards.
 */
function handleOrderEffects(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const matchingAhunts = collectMatchingAhuntAttacks(state, mhState);

  if (mhState.ahuntAttacksResolved >= matchingAhunts.length) {
    return transitionToDrawCards(state, mhState);
  }

  const { instanceId, effect } = matchingAhunts[mhState.ahuntAttacksResolved];
  const defId = resolveInstanceId(state, instanceId);
  const defName = defId ? cardName(state, defId, 'unknown') : 'unknown';

  logDetail(`Order-effects: ahunt attack ${mhState.ahuntAttacksResolved + 1}/${matchingAhunts.length} — ${defName}`);

  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[mhState.activeCompanyIndex];
  if (!company) {
    logDetail(`Order-effects: no active company — skipping ahunt`);
    return transitionToDrawCards(state, mhState);
  }

  const hazardPlayerId = hazardPlayer(state).id;

  const inPlayNames = buildInPlayNames(state);
  const ahuntBoostCtx = { companyId: company.id };
  const effectiveProwess = resolveAttackProwess(state, effect.prowess, inPlayNames, effect.race, false, undefined, ahuntBoostCtx);
  const effectiveStrikes = resolveAttackStrikes(state, effect.strikes, inPlayNames, effect.race, false, ahuntBoostCtx);

  const attackerChooses = effect.combatRules?.includes('attacker-chooses-defenders') ?? false;
  if (attackerChooses) {
    logDetail(`Ahunt attack has attacker-chooses-defenders`);
  }

  const combat: CombatState = {
    attackSource: { type: 'ahunt', longEventInstanceId: instanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: effect.body,
    creatureRace: effect.race,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: attackerChooses ? 'cancel-window' : 'defender',
    bodyCheckTarget: null,
    detainment: isDetainmentAttack({
      attackRace: effect.race as Race,
      defendingAlignment: state.players[activePlayerIndex].alignment,
    }),
  };

  logDetail(`Ahunt combat initiated: ${defName} (${effect.strikes} strikes${effectiveStrikes !== effect.strikes ? ` → ${effectiveStrikes}` : ''}, ${effect.prowess} prowess${effectiveProwess !== effect.prowess ? ` → ${effectiveProwess}` : ''}) vs company ${company.id as string}`);

  return {
    state: {
      ...state,
      combat,
      phaseState: {
        ...mhState,
        ahuntAttacksResolved: mhState.ahuntAttacksResolved + 1,
      },
    },
  };
}

/**
 * Transition from order-effects to draw-cards (CoE step 5).
 *
 * If the company is not moving, skip draws entirely and go to play-hazards.
 * Otherwise, compute the max draw counts from the appropriate site card:
 * - New site if moving to a non-haven
 * - Site of origin if moving to a haven
 *
 * The resource player may only draw if the company contains an avatar
 * (wizard/ringwraith with mind null) or a character with mind ≥ 3.
 */
function transitionToDrawCards(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const player = playerById(state, state.activePlayer)!;
  const company = player.companies[mhState.activeCompanyIndex];

  // Non-moving company: skip draws entirely
  if (!company.destinationSite) {
    logDetail(`Movement/Hazard: company not moving — skipping draw-cards → play-hazards`);
    return {
      state: {
        ...state,
        phaseState: {
          ...mhState,
          step: 'play-hazards' as const,
        },
      },
    };
  }

  // Determine which site card provides draw numbers
  const destDefId2 = company.destinationSite ? company.destinationSite.definitionId : undefined;
  const destDef = destDefId2 ? defById(state, destDefId2) : undefined;
  const originDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;

  // Use new site for non-haven destination, site of origin for haven destination.
  // MEWH §7: a Fallen-wizard always draws based on the site he moves *to*, even
  // when it is one of his Wizardhavens — the "draw from origin at a haven"
  // exception never applies to him.
  const movingToHaven = player.alignment !== 'fallen-wizard'
    && !!destDef && isSiteCard(destDef) && destDef.siteType === 'haven';
  const drawSite = movingToHaven ? originDef : destDef;

  let resourceDrawMax = 0;
  let hazardDrawMax = 0;

  if (drawSite && isSiteCard(drawSite)) {
    hazardDrawMax = drawSite.hazardDraws;

    // Resource player may only draw if company has an avatar or character with mind ≥ 3
    const hasEligibleCharacter = company.characters.some(charInstId => {
      const cDefId = resolveInstanceId(state, charInstId);
      if (!cDefId) return false;
      const def = defById(state, cDefId);
      if (!def || !isCharacterCard(def)) return false;
      return def.mind === null || def.mind >= 3;
    });

    if (hasEligibleCharacter) {
      resourceDrawMax = drawSite.resourceDraws;
    } else {
      logDetail(`No avatar or character with mind ≥ 3 — resource player cannot draw`);
    }
  }

  // Apply draw-modifier effects from company characters (e.g. Alatar reduces
  // hazard draws; Radagast adds one resource draw per Wilderness in the path)
  const sitePathCounts = {
    wildernessCount: 0, shadowCount: 0, darkCount: 0,
    coastalCount: 0, freeCount: 0, borderCount: 0,
  };
  for (const rt of mhState.resolvedSitePath) {
    switch (rt) {
      case RegionType.Wilderness: sitePathCounts.wildernessCount++; break;
      case RegionType.Shadow: sitePathCounts.shadowCount++; break;
      case RegionType.Dark: sitePathCounts.darkCount++; break;
      case RegionType.Coastal: sitePathCounts.coastalCount++; break;
      case RegionType.Free: sitePathCounts.freeCount++; break;
      case RegionType.Border: sitePathCounts.borderCount++; break;
    }
  }
  const drawContext: ResolverContext = { reason: 'draw-modifier', sitePath: sitePathCounts };
  const allDrawEffects = company.characters.flatMap(charInstId => {
    const char = player.characters[charInstId as string];
    if (!char) return [];
    return collectCharacterEffects(state, char, drawContext);
  });
  const exprContext = drawContext as unknown as Record<string, unknown>;
  const hazardMod = resolveDrawModifier(allDrawEffects, 'hazard', exprContext);
  if (hazardMod.adjustment !== 0) {
    const before = hazardDrawMax;
    hazardDrawMax = Math.max(hazardMod.min, hazardDrawMax + hazardMod.adjustment);
    logDetail(`draw-modifier: hazard draws ${before} → ${hazardDrawMax} (adjustment ${hazardMod.adjustment}, min ${hazardMod.min})`);
  }
  const resourceMod = resolveDrawModifier(allDrawEffects, 'resource', exprContext);
  if (resourceMod.adjustment !== 0) {
    const before = resourceDrawMax;
    resourceDrawMax = Math.max(resourceMod.min, resourceDrawMax + resourceMod.adjustment);
    logDetail(`draw-modifier: resource draws ${before} → ${resourceDrawMax} (adjustment ${resourceMod.adjustment}, min ${resourceMod.min})`);
  }

  // Apply hazard-draw-multiplier constraints (e.g. Great-road doubles opponent draws).
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'hazard-draw-multiplier') continue;
    if (c.target.kind !== 'company' || c.target.companyId !== company.id) continue;
    const before = hazardDrawMax;
    hazardDrawMax = Math.round(hazardDrawMax * c.kind.multiplier);
    logDetail(`hazard-draw-multiplier: hazard draws ${before} → ${hazardDrawMax} (×${c.kind.multiplier} from ${c.sourceDefinitionId as string})`);
  }

  logDetail(`Movement/Hazard: order-effects done → draw-cards (resource max: ${resourceDrawMax}, hazard max: ${hazardDrawMax}, site: ${drawSite && isSiteCard(drawSite) ? drawSite.name : '?'})`);

  return {
    state: {
      ...state,
      phaseState: {
        ...mhState,
        step: 'draw-cards' as const,
        resourceDrawMax,
        hazardDrawMax,
        resourceDrawCount: 0,
        hazardDrawCount: 0,
      },
    },
  };
}

/**
 * Handle actions during the draw-cards step (CoE step 5).
 *
 * Both players draw simultaneously. Each gets `draw-cards` (count: 1)
 * to draw one card at a time. After the first mandatory draw, `pass`
 * becomes available to stop drawing early. Once a player has drawn
 * their max or passed, they are done. When both are done, advance
 * to play-hazards.
 */


/**
 * Handle actions during the draw-cards step (CoE step 5).
 *
 * Both players draw simultaneously. Each gets `draw-cards` (count: 1)
 * to draw one card at a time. After the first mandatory draw, `pass`
 * becomes available to stop drawing early. Once a player has drawn
 * their max or passed, they are done. When both are done, advance
 * to play-hazards.
 */
function handleDrawCards(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const isResourcePlayer = action.player === state.activePlayer;
  const actingIndex = getPlayerIndex(state, action.player);

  const drawnSoFar = isResourcePlayer ? mhState.resourceDrawCount : mhState.hazardDrawCount;
  const drawMax = isResourcePlayer ? mhState.resourceDrawMax : mhState.hazardDrawMax;
  const playerLabel = isResourcePlayer ? 'resource' : 'hazard';

  // Pass during deck exhaust exchange sub-flow: complete the exhaust
  if (action.type === 'pass' && state.players[actingIndex].deckExhaustPending) {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player completed deck exhaust exchange`);
    return { state: completeDeckExhaust(state, actingIndex) };
  }

  if (action.type === 'pass') {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player passed (drew ${drawnSoFar}/${drawMax})`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  if (action.type === 'deck-exhaust') {
    return { state: startDeckExhaust(state, actingIndex) };
  }

  if (action.type === 'exchange-sideboard') {
    return handleExchangeSideboard(state, action);
  }

  if (action.type !== 'draw-cards' || action.count !== 1) {
    return { state, error: `Expected 'draw-cards' (count: 1), 'deck-exhaust', 'exchange-sideboard', or 'pass' during draw-cards step, got '${action.type}'` };
  }

  // Draw 1 card from play deck into hand
  const player = state.players[actingIndex];
  if (player.playDeck.length === 0) {
    logDetail(`Movement/Hazard draw-cards: ${playerLabel} player has no cards to draw`);
    return advanceDrawCards(state, mhState, isResourcePlayer, drawMax);
  }

  const drawnCard = player.playDeck[0];
  const drawnState = updatePlayer(state, actingIndex, p => ({
    ...p,
    hand: [...p.hand, drawnCard],
    playDeck: p.playDeck.slice(1),
  }));

  const newDrawCount = drawnSoFar + 1;
  logDetail(`Movement/Hazard draw-cards: ${playerLabel} player drew card ${newDrawCount}/${drawMax}`);

  const newMhState = {
    ...mhState,
    ...(isResourcePlayer
      ? { resourceDrawCount: newDrawCount }
      : { hazardDrawCount: newDrawCount }),
  };

  // If this player just hit their max, check if both are done
  if (newDrawCount >= drawMax) {
    const otherDone = isResourcePlayer
      ? newMhState.hazardDrawCount >= newMhState.hazardDrawMax
      : newMhState.resourceDrawCount >= newMhState.resourceDrawMax;

    if (otherDone) {
      logDetail(`Movement/Hazard draw-cards: both players done → advancing to play-hazards`);
      return {
        state: {
          ...drawnState,
          phaseState: { ...newMhState, step: 'play-hazards' as const },
        },
      };
    }
  }

  return {
    state: {
      ...drawnState,
      phaseState: newMhState,
    },
  };
}

/**
 * Mark a player as done drawing and advance to play-hazards if both are done.
 */


/**
 * Mark a player as done drawing and advance to play-hazards if both are done.
 */
function advanceDrawCards(
  state: GameState,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
  drawMax: number,
): ReducerResult {
  // Mark this player as done by setting their draw count to max
  const newMhState = {
    ...mhState,
    ...(isResourcePlayer
      ? { resourceDrawCount: drawMax }
      : { hazardDrawCount: drawMax }),
  };

  const otherDone = isResourcePlayer
    ? newMhState.hazardDrawCount >= newMhState.hazardDrawMax
    : newMhState.resourceDrawCount >= newMhState.resourceDrawMax;

  if (otherDone) {
    logDetail(`Movement/Hazard draw-cards: both players done → advancing to play-hazards`);
    return {
      state: {
        ...state,
        phaseState: { ...newMhState, step: 'play-hazards' as const },
      },
    };
  }

  return {
    state: {
      ...state,
      phaseState: newMhState,
    },
  };
}

// handleMHWoundCorruptionCheck removed: wound corruption checks are
// now handled by `applyCorruptionCheckResolution` in
// `engine/pending-reducers.ts`.

/**
 * Check whether a creature's race is exempted from the hazard limit by
 * a `creature-type-no-hazard-limit` constraint on the target company.
 */
function isCreatureRaceExempt(state: GameState, action: GameAction, def: CreatureCard): boolean {
  if (action.type !== 'play-hazard') return false;
  if (!state.activeConstraints) return false;
  return state.activeConstraints.some(
    c => c.target.kind === 'company'
      && c.target.companyId === action.targetCompanyId
      && c.kind.type === 'creature-type-no-hazard-limit'
      && c.kind.exemptRace === def.race,
  );
}

/**
 * Consume one charge of a matching `creature-keying-bypass` constraint
 * on the target company. Decrements `remainingPlays`; removes the
 * constraint entirely when the count reaches zero. Called immediately
 * after a creature is played via the `keying-bypass` keyedBy method.
 */
function consumeCreatureKeyingBypass(
  state: GameState,
  companyId: CompanyId,
  race: string,
): GameState {
  const idx = state.activeConstraints.findIndex(
    c => c.target.kind === 'company'
      && c.target.companyId === companyId
      && c.kind.type === 'creature-keying-bypass'
      && c.kind.race === race
      && c.kind.remainingPlays > 0,
  );
  if (idx < 0) return state;
  const existing = state.activeConstraints[idx];
  if (existing.kind.type !== 'creature-keying-bypass') return state;
  const next = existing.kind.remainingPlays - 1;
  const updated = [...state.activeConstraints];
  if (next <= 0) {
    logDetail(`Creature-keying-bypass constraint consumed and removed (race "${race}", company ${companyId as string})`);
    updated.splice(idx, 1);
  } else {
    logDetail(`Creature-keying-bypass constraint consumed (race "${race}", company ${companyId as string}, remainingPlays ${existing.kind.remainingPlays} → ${next})`);
    updated[idx] = { ...existing, kind: { ...existing.kind, remainingPlays: next } };
  }
  return { ...state, activeConstraints: updated };
}

/**
 * Handle all actions during the site phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the End-of-Turn phase.
 */

