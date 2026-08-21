/**
 * @module mh-hazard-play
 *
 * The hazard-play and company-M/H-completion core of the movement/hazard phase:
 * playing hazards and creatures (handlePlayHazards and its sub-handlers), the
 * creature-keying matchers (checkCreatureKeying,
 * isCreatureRaceExempt, consumeCreatureKeyingBypass, isLegalMovementHop,
 * findForcingEnvironment), and end-of-company-M/H completion plus arrival
 * triggers (endCompanyMH, advanceAfterCompanyMH, the fire* triggers). Extracted
 * from reducer-movement-hazard.ts as the provably-closed transitive closure of
 * the hazard-play handlers (call-graph fixpoint) — it calls no other
 * reducer-movement-hazard function. reducer-movement-hazard imports the entry
 * points it dispatches one-way from here; this module imports only shared
 * leaves and mh-agents, so no cycle forms.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, MovementHazardPhaseState, Company, CreatureCard, GameAction, CharacterInPlay, AgentInPlay, SiteCard, CardDefinition, PlayerState } from '../index.js';
import type { CardEffect, CallCouncilEffect, TapAgentEffect, HazardLimitSwapEffect, RegionKeyingBoostEffect, AgentTapReturnCharacterEffect, AgentTapFactionInfluenceEffect, PlayDiscardCostEffect, Condition, AllyTapExtraMHPhaseEffect, CharacterTapExtraMHPhaseEffect, CreatureAltEventEffect } from '../types/effects.js';
import type { CardInstance, ChainEntryPayload, PlayHazardAction } from '../index.js';
import { revealInstances } from './visibility.js';
import type { TapHazardCardForLimitAction, PayHazardLimitToUntapCardAction, TapAllyDiscardHazardAction } from '../types/actions-movement-hazard.js';
import { flagCouncilCall } from './reducer-end-of-turn.js';
import type { CompanyId, CardDefinitionId, CardInstanceId, PlayerId } from '../types/common.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { shuffle } from '../rng.js';
import { buildMovementMap, getReachableSites } from '../movement-map.js';
import { resetCompanyMHFields } from './mh-phase-state.js';
import { getPlayerIndex, isMinionOrBalrog, companyContainsRingwraithAvatar } from '../state-utils.js';
import { isCharacterCard, isSiteCard, isResourceEventCard } from '../types/cards.js';
import { CardStatus, Skill, SiteType, Alignment, Race, RegionType } from '../types/common.js';
import { ZERO_EFFECTIVE_STATS } from '../types/state-cards.js';
import { Phase } from '../types/state-phases.js';
import { resolveHandSize } from './effects/index.js';
import { getEffectiveSkills } from './effects/resolver.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { initiateChain, initiateOrPushChain } from './chain-reducer.js';
import { currentHazardLimit, chargeHazardLimit } from './hazard-limit.js';
import { buildConstraintKind, parseConstraintScope } from './constraint-kind.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { autoMergeNonHavenCompanies, companyHasRingwraith, cardKeepsBoundSitePermanent, isNazgulPermanentEvent, cleanupEmptyCompanies, clonePlayers, companyById, companySiteDef, defById, deriveFacedRaces, findById, getCardEffects, getOnEventEffects, isDarkhavenSiteDef, isSelfDiscardMove, matchesDefinition, playerById, playerHasExtraUnderDeepsMH, regionTypeCounts, regionTypesMatch, removeById, siteNeverUntapsForOwner, toCardInstance, updateAttachment, updateCharacter, updatePlayer, wrongActionType } from './reducer-utils.js';
import { buildCompanyCompositionContext } from './company-composition.js';
import { handlePlayShortEvent, handlePlayResourceShortEvent, handlePlayPermanentEvent } from './reducer-events.js';
import { handlePlayCharacter, handleManifestationSwap, handleDiscardToRecruit } from './reducer-organization.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { sweepExpired, addConstraint, removeConstraint, enqueueCorruptionCheck, characterPossessions, enqueueResolution, hasCancelReturnAndSiteTap } from './pending.js';
import { discardCharacterToDiscardPile } from './pending-reducers.js';
import { resolveAdjacency, isUnderDeepsAdjacent, ringwraithHasModeCard } from './legal-actions/organization-companies.js';
import { buildInPlayNames } from './recompute-derived.js';
import { computeCandidateRegionPaths } from './region-keying.js';
import { resolveCreatureKeyingSiteType } from './effective.js';
import { handleAgentMove, handleAgentMoveBack, handleAgentReturnHome, handleAgentHeal, handleAgentUntap, handleAgentTurnFaceDown, handleAgentKeyCreatures, handleAgentInfluenceAttempt, handleAgentTapAttack, handleTapAgentAtSite, handleAgentTapReturnCharacter, handleAgentTapFactionInfluence } from './mh-agents.js';

/**
 * Handle actions during the play-hazards step (CoE step 7).
 *
 * The hazard player may play hazard long-events (and eventually creatures,
 * short-events, permanent-events, on-guard cards) up to the hazard limit.
 * Both players may pass; the company's M/H phase ends when both have passed.
 * If the hazard player takes an action after the resource player passed,
 * the resource player's pass is reset.
 */
export function handlePlayHazards(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const isResourcePlayer = action.player === state.activePlayer;

  // --- Rule 5.24: Sideboarding with a Nazgûl ---
  if (action.type === 'sideboard-with-nazgul') {
    return handleSideboardWithNazgul(state, action, mhState);
  }
  if (action.type === 'fetch-hazard-from-sideboard') {
    return handleFetchHazardFromSideboardMH(state, action, mhState);
  }
  // While the "bring up to five to discard" sub-flow is active, the hazard
  // player's 'pass' exits the sub-flow instead of ending their play-hazards
  // turn (mirrors the untap-phase hazard-sideboard sub-flow).
  if (action.type === 'pass' && !isResourcePlayer && mhState.nazgulSideboardDestination === 'discard') {
    logDetail(`Rule 5.24: hazard player done fetching to discard (${mhState.nazgulSideboardFetched} card(s))`);
    return { state: { ...state, phaseState: { ...mhState, nazgulSideboardDestination: null } } };
  }

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
      // The active company may have dissolved during this M/H phase (all its
      // characters eliminated). Skip the company-scoped end-of-phase hooks —
      // they dereference the company — and finalize the slot directly.
      const passActiveIdx = getPlayerIndex(state, state.activePlayer!);
      if (!state.players[passActiveIdx].companies[newMhState.activeCompanyIndex]) {
        logDetail('Play-hazards: active company dissolved during M/H — finalizing its slot');
        return advanceAfterCompanyMH(state, newMhState);
      }
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
  if (action.type === 'agent-discard-return-to-origin') return handleAgentDiscardReturnToOrigin(state, action, mhState);

  // --- Tap an in-play dual-mode creature-permanent-event → short-event (tw-2, tw-107) ---
  if (action.type === 'tap-alt-permanent-event') return handleTapAltPermanentEvent(state, action, mhState);

  // --- Convert an in-play dual-mode creature-permanent-event into a full creature attack (Shelob tw-86) ---
  if (action.type === 'attack-alt-permanent-event') return handleAttackFromAltPermanentEvent(state, action, mhState);

  // --- Tap cardsInPlay hazard permanent event for +1 hazard limit (Power Built by Waiting) ---
  if (action.type === 'tap-hazard-card-for-limit') return handleTapHazardCardForLimit(state, action, mhState);

  // --- Pay hazard limit to untap a cardsInPlay hazard permanent event (Power Built by Waiting) ---
  if (action.type === 'pay-hazard-limit-to-untap-card') return handlePayHazardLimitToUntapCard(state, action, mhState);

  // --- Discard a Dragon "At Home" permanent event for +hazard limit (METD §4) ---
  if (action.type === 'discard-card-for-hazard-limit') return handleDiscardCardForHazardLimit(state, action, mhState);

  // --- Reserve a Dragon/Drake creature in the Summons from Long Sleep (as-39) slot ---
  if (action.type === 'reserve-creature') return handleReserveCreature(state, action, mhState);

  // --- Play a reserved creature from the Summons from Long Sleep (as-39) slot ---
  if (action.type === 'play-reserved-creature') return handlePlayReservedCreature(state, action, mhState);

  // --- Play a creature from the discard pile (Exhalation of Decay, dm-55) ---
  if (action.type === 'play-creature-from-discard') return handlePlayCreatureFromDiscard(state, action, mhState);

  // --- Replay a Wolf/Animal creature that already attacked (Monstrosity of
  //     Diverse Shape, ba-21) ---
  if (action.type === 'spawn-replay-creature') return handleSpawnReplayCreature(state, action, mhState);

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

  // --- Manifestation swap (Strider ba-1 → Aragorn II): a resource-style
  //     play, available whenever a normal resource could be played (CRF 22). ---
  else if (action.type === 'manifestation-swap') {
    result = handleManifestationSwap(state, action);
  }

  // --- Discard-to-recruit (Folco Boffin dm-180): a resource-style
  //     replacement play, available whenever a normal resource could be
  //     played (CRF 22). ---
  else if (action.type === 'discard-to-recruit') {
    result = handleDiscardToRecruit(state, action);
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

/** Minimum play deck size required to fetch a Nazgûl-sideboarded hazard to deck (rule 5.24). */
const MIN_DECK_SIZE_FOR_NAZGUL_TO_DECK = 5;

/**
 * Rule 5.24: tap and discard an untapped Nazgûl permanent-event the hazard
 * player controls to open a sideboard sub-flow (bring up to five hazards to
 * discard, or one hazard directly into the play deck). The Nazgûl's normal
 * tap effect (converting to a short-event) does not apply — it is discarded
 * outright — and this counts as one hazard against the hazard limit.
 */
function handleSideboardWithNazgul(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'sideboard-with-nazgul') return wrongActionType(state, action, 'sideboard-with-nazgul');
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const card = player.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!card) return { state, error: 'Nazgûl permanent-event not found in play' };
  if (card.status === CardStatus.Tapped) return { state, error: 'Nazgûl is already tapped' };
  const def = defById(state, card.definitionId);
  if (!isNazgulPermanentEvent(def)) {
    return { state, error: 'Target is not a Nazgûl permanent-event' };
  }
  if (action.destination === 'deck' && player.playDeck.length < MIN_DECK_SIZE_FOR_NAZGUL_TO_DECK) {
    return { state, error: 'Play deck must have at least 5 cards to fetch a hazard to it' };
  }

  logDetail(`Rule 5.24: ${player.name} taps and discards Nazgûl "${def?.name ?? (card.definitionId as string)}" to access sideboard (${action.destination})`);
  const afterDiscard = updatePlayer(state, playerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
  }));

  return {
    state: {
      ...afterDiscard,
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: mhState.hazardsPlayedThisCompany + 1,
        nazgulSideboardDestination: action.destination,
        nazgulSideboardFetched: 0,
      },
    },
  };
}

/**
 * Rule 5.24 follow-up: fetch one hazard card from the sideboard during the
 * active Nazgûl sideboard sub-flow, to the discard pile or (shuffled) into
 * the play deck. Mirrors the untap-phase hazard-sideboard fetch
 * (`fetch-hazard-from-sideboard` is the same action/type in both flows).
 */
function handleFetchHazardFromSideboardMH(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'fetch-hazard-from-sideboard') return wrongActionType(state, action, 'fetch-hazard-from-sideboard');
  if (!mhState.nazgulSideboardDestination) return { state, error: 'No active Nazgûl sideboard sub-flow' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const cardIdx = player.sideboard.findIndex(c => c.instanceId === action.sideboardCardInstanceId);
  if (cardIdx === -1) return { state, error: 'Sideboard card not found' };
  const sideboardCard = player.sideboard[cardIdx];
  const def = defById(state, sideboardCard.definitionId)!;
  const destination = mhState.nazgulSideboardDestination;

  const newSideboard = [...player.sideboard];
  newSideboard.splice(cardIdx, 1);

  let nextState: GameState;
  if (destination === 'discard') {
    logDetail(`Rule 5.24: sideboard → discard: ${def.name} (${action.sideboardCardInstanceId as string})`);
    nextState = updatePlayer(state, playerIndex, p => ({
      ...p,
      sideboard: newSideboard,
      discardPile: [...p.discardPile, sideboardCard],
    }));
  } else {
    logDetail(`Rule 5.24: sideboard → play deck: ${def.name} (${action.sideboardCardInstanceId as string}), shuffling`);
    const [shuffledDeck, nextRng] = shuffle([...player.playDeck, sideboardCard], state.rng);
    nextState = {
      ...updatePlayer(state, playerIndex, p => ({ ...p, sideboard: newSideboard, playDeck: shuffledDeck })),
      rng: nextRng,
    };
  }

  return {
    state: {
      ...nextState,
      phaseState: {
        ...mhState,
        nazgulSideboardFetched: mhState.nazgulSideboardFetched + 1,
        // Deck destination: exit sub-flow after 1 card; discard: stay in sub-flow.
        nazgulSideboardDestination: destination === 'deck' ? null : destination,
      },
    },
  };
}

/**
 * Generate a unique CompanyId for a new agent in-play record.
 *
 * Uses an "agent-" prefix namespace (different from "company-") so that
 * `SelectCompanyAction` can distinguish agents from companies if needed in the
 * future, while still being a valid `CompanyId` for existing action routing.
 */
export function nextAgentId(player: { readonly agents: readonly AgentInPlay[] }): CompanyId {
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
export function handlePlayAgentHazard(
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
export function isLegalMovementHop(
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
export function handleRevealAgent(state: GameState, action: GameAction): ReducerResult {
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
    const fromDef = state.cardPool[fullStack[i].definitionId];
    const toDef = state.cardPool[fullStack[i + 1].definitionId];
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
 * Play a hand card in one of its alternate hazard-event modes (a dual-mode
 * creature or event declared as a short-event or permanent-event via
 * `altEventMode`): count it against the hazard limit unless it carries the
 * `no-hazard-limit` play flag, take it out of hand (straight into the discard
 * pile when `discardOnPlay` — short events resolve off the chain), reset the
 * resource player's pass, and push the chain entry with `payload`.
 */
function playHazardInAltMode(
  state: GameState,
  mhState: MovementHazardPhaseState,
  action: PlayHazardAction,
  hazardIndex: number,
  handCard: CardInstance,
  def: { readonly effects?: readonly CardEffect[] },
  opts: {
    /** What is being played, for the log line ("creature \"X\" as a short-event"). */
    readonly description: string;
    readonly logSuffix?: string;
    readonly discardOnPlay: boolean;
    readonly payload: ChainEntryPayload;
  },
): ReducerResult {
  const bypassesLimit = hasPlayFlag(def, 'no-hazard-limit');
  const newHazardCount = bypassesLimit
    ? mhState.hazardsPlayedThisCompany
    : mhState.hazardsPlayedThisCompany + 1;
  logDetail(`Play-hazards: hazard player plays ${opts.description} (${newHazardCount}/${currentHazardLimit(state, mhState, action.targetCompanyId)})${bypassesLimit ? ' [no-hazard-limit]' : ''}${opts.logSuffix ?? ''}`);

  const newState: GameState = {
    ...updatePlayer(state, hazardIndex, p => ({
      ...p,
      hand: removeById(p.hand, handCard.instanceId),
      ...(opts.discardOnPlay ? { discardPile: [...p.discardPile, handCard] } : {}),
    })),
    phaseState: {
      ...mhState,
      hazardsPlayedThisCompany: newHazardCount,
      resourcePlayerPassed: false,
    },
  };
  return { state: initiateOrPushChain(newState, action.player, handCard, opts.payload, !bypassesLimit) };
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
export function handlePlayHazardCard(
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
  // to trigger the endgame. Bypasses the chain: the card is discarded and
  // the council call is flagged (caller gets the last turn) without
  // interrupting the opponent's turn in progress — the opponent's turn
  // plays out normally, and the existing End-of-Turn signal-end logic
  // performs the actual player swap once it naturally ends.
  const hazardCallCouncil = getCardEffects(def).find(
    (e): e is CallCouncilEffect => e.type === 'call-council' && e.lastTurnFor === 'self',
  );
  if (hazardCallCouncil
    && (def.cardType === 'hero-resource-event' || def.cardType === 'minion-resource-event')
    && hasPlayFlag(def, 'playable-as-hazard')) {
    logDetail(`Play-hazards: ${action.player as string} plays resource-as-hazard "${def.name}" → flagging endgame (caller gets last turn)`);
    const newHand = removeById(hazardPlayer.hand, handCard.instanceId);
    const afterDiscard = updatePlayer(state, hazardIndex, p => ({
      ...p,
      hand: newHand,
      discardPile: [...p.discardPile, handCard],
    }));
    return { state: flagCouncilCall(afterDiscard, action.player, 'self') };
  }

  // --- Dual-mode creature played as a short-event (creature-alt-event) ---
  // e.g. Mouth of Sauron (tw-65): "may be played as a hazard creature or as a
  // short-event". The player chose the event mode: the card goes hand → discard,
  // counts against the hazard limit like any short-event, and pushes a
  // short-event chain entry. Its top-level effects (e.g. a `move` from discard
  // to hand) then resolve through the very same hazard short-event chain path,
  // so no behaviour is duplicated. Must precede the creature branch below.
  if (def.cardType === 'hazard-creature'
      && action.type === 'play-hazard'
      && action.altEventMode === 'short-event') {
    return playHazardInAltMode(state, mhState, action, hazardIndex, handCard, def, {
      description: `creature "${def.name}" as a short-event`,
      // Short events are discarded at play time (they resolve off the chain).
      discardOnPlay: true,
      payload: {
        type: 'short-event',
        ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
      },
    });
  }

  // --- Dual-mode creature played as a permanent-event (creature-alt-event) ---
  // e.g. Ûvatha tw-107 / Adûnaphel tw-2: "may be played as a hazard creature or
  // as a permanent-event". The card enters play (hazard player's cardsInPlay)
  // via the standard permanent-event chain path and sits there until the hazard
  // player taps it on a later turn (handleTapAltPermanentEvent). Counts one
  // against the hazard limit like any permanent event. Must precede the creature
  // branch below.
  if (def.cardType === 'hazard-creature'
      && action.type === 'play-hazard'
      && action.altEventMode === 'permanent-event') {
    return playHazardInAltMode(state, mhState, action, hazardIndex, handCard, def, {
      description: `creature "${def.name}" as a permanent-event`,
      logSuffix: ' — enters play',
      discardOnPlay: false,
      // General permanent-event (no character/site binding): resolvePermanentEvent
      // places it into the hazard player's cardsInPlay untapped.
      payload: { type: 'permanent-event' },
    });
  }

  // --- Inner Cunning (dm-68) mode 2: dual permanent-event card played as a
  //     short-event tutor. The player chose the short-event mode: card goes
  //     hand → discard, counts against the hazard limit, and pushes a
  //     short-event chain entry whose `fetch-agent-to-hand` effect resolves
  //     into a fetch-from-pile pending resolution (chain-reducer). ---
  if (def.cardType === 'hazard-event'
      && action.type === 'play-hazard'
      && action.altEventMode === 'short-event'
      && getCardEffects(def).some(e => e.type === 'fetch-agent-to-hand')) {
    return playHazardInAltMode(state, mhState, action, hazardIndex, handCard, def, {
      description: `"${def.name}" as a short-event tutor`,
      discardOnPlay: true,
      payload: { type: 'short-event' },
    });
  }

  // --- Short-event card played in a permanent-event `play-option` mode ---
  // Returned Beyond All Hope (as-35) mode 3: "Alternatively, as a
  // permanent-event, make a roll…". The card's printed eventType is `short`, but
  // this mode is declared as a permanent event, so the card rides the chain
  // (it is NOT pre-discarded like a short event) and its option's apply decides
  // where it finally lands — the opponent's marshalling-point pile on a
  // successful roll, its own player's discard pile otherwise. Like dm-73 it
  // never enters `cardsInPlay`. Counts one against the hazard limit.
  if (def.cardType === 'hazard-event'
      && def.eventType === 'short'
      && action.type === 'play-hazard'
      && action.altEventMode === 'permanent-event'
      && action.optionId) {
    return playHazardInAltMode(state, mhState, action, hazardIndex, handCard, def, {
      description: `"${def.name}" as a permanent-event (option "${action.optionId}")`,
      discardOnPlay: false,
      payload: {
        type: 'permanent-event',
        optionId: action.optionId,
        ...(action.optionTargetInstanceId
          ? { optionTargetInstanceId: action.optionTargetInstanceId }
          : {}),
      },
    });
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
    const creaturePayload: import('../index.js').ChainEntryPayload = {
      type: 'creature',
      ...(action.keyedBy ? { keyedBy: action.keyedBy } : {}),
    };
    newState = initiateChain(newState, action.player, handCard, creaturePayload, 'normal', !raceExempt);

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

    // Pilfer Anything Unwatched (as-33): tap an untapped agent and roll to
    // return an opponent character (home site == agent's current site) to hand.
    const pilferEff = def.effects?.find(
      (e): e is AgentTapReturnCharacterEffect => e.type === 'agent-tap-return-character',
    );
    if (pilferEff && action.type === 'play-hazard' && action.agentInstanceId && action.targetCharacterId) {
      return handleAgentTapReturnCharacter(state, action, mhState, hazardPlayer, hazardIndex, handCard, def, pilferEff);
    }

    // Twisted Tales (dm-96): tap an untapped diplomat agent to make a rule-10.14
    // influence attempt against an opponent faction playable at the agent's site.
    const agentFactionInfluenceEff = def.effects?.find(
      (e): e is AgentTapFactionInfluenceEffect => e.type === 'agent-tap-faction-influence',
    );
    if (agentFactionInfluenceEff && action.type === 'play-hazard' && action.agentInstanceId && action.targetFactionInstanceId) {
      return handleAgentTapFactionInfluence(state, action, mhState, hazardPlayer, hazardIndex, handCard, def, agentFactionInfluenceEff);
    }

    const bypassesLimit = hasPlayFlag(def, 'no-hazard-limit');
    const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;
    logDetail(`Play-hazards: hazard player plays short-event "${def.name}" (${newHazardCount}/${currentHazardLimit(state, mhState, action.targetCompanyId)})${bypassesLimit ? ' [no-hazard-limit]' : ''}`);

    // Move card from hand to discard (short events are discarded after resolution)
    let newHand = removeById(hazardPlayer.hand, handCard.instanceId);

    // play-discard-cost (Faces of the Dead dm-57): pay the play cost by discarding
    // a matching card the player chose from hand. The chosen card is validated
    // against the effect's filter; when the effect declares "show opponent"
    // (revealToOpponent), its identity is revealed to the opponent.
    const discardCostEffect = getCardEffects(def).find(
      (e): e is PlayDiscardCostEffect => e.type === 'play-discard-cost',
    );
    let costDiscardCard: CardInstance | undefined;
    if (discardCostEffect && action.type === 'play-hazard' && action.costDiscardInstanceId) {
      const chosen = findById(hazardPlayer.hand, action.costDiscardInstanceId);
      const costDef = chosen ? defById(state, chosen.definitionId) : undefined;
      const matches = costDef
        ? matchesCondition(discardCostEffect.filter, costDef as unknown as Record<string, unknown>)
        : false;
      if (chosen && matches) {
        costDiscardCard = chosen;
        newHand = removeById(newHand, chosen.instanceId);
        logDetail(`Play-hazards: "${def.name}" discard cost paid — discarding "${costDef?.name ?? chosen.definitionId}" from hand${discardCostEffect.revealToOpponent ? ' (shown to opponent)' : ''}`);
      }
    }
    if (discardCostEffect && !costDiscardCard) {
      return { state, error: `${def.name} requires discarding a matching card from hand to play` };
    }

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
        discardPile: [...p.discardPile, handCard, ...(costDiscardCard ? [costDiscardCard] : [])],
      })),
      phaseState: {
        ...mhState,
        hazardsPlayedThisCompany: newHazardCount,
        resourcePlayerPassed: false,
        corruptionCardsPlayedPerChar: shortCorruptionPerChar,
      },
    };

    // "show opponent" — reveal the discarded cost card's identity.
    if (costDiscardCard && discardCostEffect?.revealToOpponent) {
      newState = revealInstances(newState, [costDiscardCard]);
    }

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
      ...(action.type === 'play-hazard' && action.optionTargetInstanceId
        ? { optionTargetInstanceId: action.optionTargetInstanceId }
        : {}),
      ...(action.type === 'play-hazard' && action.targetSiteDefinitionId
        ? { targetSiteDefinitionId: action.targetSiteDefinitionId }
        : {}),
    };
    newState = initiateOrPushChain(newState, action.player, handCard, shortEventPayload, !bypassesLimit);

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
    newState = initiateOrPushChain(newState, action.player, handCard, payload, true);
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

  // `action.targetCompanyId` is present on *every* play-hazard action — it names
  // the company currently being hazarded and drives hazard-limit accounting. It
  // is NOT a targeting declaration. Only a permanent event that declares
  // `play-target: company` (Enchanted Stream as-27, Nothing to Eat or Drink
  // le-128) is actually played *on* that company and gets bound to it; every
  // other permanent hazard (Traitor tw-105, Doors of Night, …) enters the
  // general play area untargeted. Forwarding the company ID unconditionally
  // would stamp `companyId` on the resulting CardInPlay entry, wrongly scoping
  // the card to a company it never targeted (and exposing it to the
  // company-bound sweeps: empty-company cleanup, membership-change discards).
  const bindsToCompany = getCardEffects(def).some(
    e => e.type === 'play-target' && e.target === 'company',
  );
  if (def.eventType === 'permanent') {
    logDetail(`Permanent hazard "${def.name}": ${bindsToCompany ? `bound to company ${action.targetCompanyId as string}` : 'enters the general play area (no company target)'}`);
  }

  // Initiate or push onto chain — card enters play upon resolution
  const payload: import('../index.js').ChainEntryPayload = def.eventType === 'permanent'
    ? {
        type: 'permanent-event',
        targetCharacterId: action.type === 'play-hazard' ? action.targetCharacterId : undefined,
        targetSiteDefinitionId: action.type === 'play-hazard' ? action.targetSiteDefinitionId : undefined,
        targetCompanyId: bindsToCompany && action.type === 'play-hazard' ? action.targetCompanyId : undefined,
        targetStoredItemInstanceId: action.type === 'play-hazard' ? action.targetStoredItemInstanceId : undefined,
        // Inner Cunning (dm-68) mode 1: bind to a face-down agent.
        targetAgentId: action.type === 'play-hazard' ? action.targetAgentId : undefined,
      }
    : { type: 'long-event' };
  newState = initiateOrPushChain(newState, action.player, handCard, payload, true);

  return { state: newState };
}

/**
 * Place a card from the hazard player's hand face-down on the active
 * company as an on-guard card. Any card may be placed (bluffing is
 * allowed). Counts against the hazard limit and resets the resource
 * player's pass.
 */
export function handlePlaceOnGuard(
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
export function fireEndOfCompanyMHCorruptionChecks(
  state: GameState,
  mhState: MovementHazardPhaseState,
): GameState {
  const sitePath = mhState.resolvedSitePath;
  if (sitePath.length === 0) return state;

  const resourcePlayer = playerById(state, state.activePlayer)!;
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];

  let newState = state;
  for (const charId of company.characters) {
    const char = resourcePlayer.characters[charId];
    if (!char) continue;
    for (const hazard of char.hazards) {
      const hDef = defById(newState, hazard.definitionId);
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
        const possessions = characterPossessions(char);
        const total = regionIndices.length;
        for (let k = 0; k < total; k++) {
          newState = enqueueCorruptionCheck(newState, {
            source: hazard.instanceId,
            actor: state.activePlayer!,
            scope: { kind: 'phase', phase: Phase.MovementHazard },
            characterId: charId,
            reason: `${hDef?.name} (region ${k + 1}/${total})`,
            possessions,
            // CoE 7.1.1: any corruption check declared but not yet resolved
            // may be supported by tapping untapped company mates for +1
            // each — see rule-3.35's transfer fix.
            allowSupport: true,
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
export function handleTapAllyDiscardHazard(
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
      const ch = characters[charId];
      if (!ch) continue;
      const idx = ch.allies.findIndex(a => a.instanceId === action.allyInstanceId);
      if (idx === -1) continue;
      const ally = ch.allies[idx];
      if (ally.status !== CardStatus.Untapped) return p;
      const newAllies = [...ch.allies];
      newAllies[idx] = { ...ally, status: CardStatus.Tapped };
      characters[charId] = { ...ch, allies: newAllies };
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
      const ch = characters[charId];
      if (!ch) continue;
      const hIdx = ch.hazards.findIndex(h => h.instanceId === action.targetInstanceId);
      if (hIdx !== -1) {
        removed = ch.hazards[hIdx];
        characters[charId] = { ...ch, hazards: ch.hazards.filter(h => h.instanceId !== action.targetInstanceId) };
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
export function findForcingEnvironment(
  state: GameState,
  company: Company,
  mhState: MovementHazardPhaseState,
  movingPlayer: PlayerState,
): import('../index.js').CardInPlay | null {
  const path = mhState.resolvedSitePath;
  // The Way is Shut (dm-98): "moving to or from an Under-deeps site" — true when
  // either the company's origin (currentSite) or its declared destination is an
  // Under-deeps site (`under-deeps` keyword on the site definition).
  const siteIsUnderDeeps = (ref: { definitionId: import('../index.js').CardDefinitionId } | null | undefined): boolean => {
    if (!ref) return false;
    const siteDef = defById(state, ref.definitionId);
    return isSiteCard(siteDef) && (siteDef.keywords?.includes('under-deeps') ?? false);
  };
  const underDeepsMove = siteIsUnderDeeps(company.currentSite) || siteIsUnderDeeps(company.destinationSite);
  const context = {
    sitePath: {
      ...regionTypeCounts(path),
      length: path.length,
    },
    underDeepsMove,
    player: { minion: isMinionOrBalrog(movingPlayer) },
  };

  const companyHasRanger = company.characters.some(charId => {
    const charData = movingPlayer.characters[charId];
    const charDef = charData ? defById(state, charData.definitionId) : undefined;
    if (!charDef || !isCharacterCard(charDef)) return false;
    const skills = charData ? getEffectiveSkills(state, charData, charDef) : [...charDef.skills];
    return skills.includes(Skill.Ranger);
  });

  // Promptings of Wisdom (wh-34) / Piercing All Shadows (wh-47) / Govern the
  // Storms (wh-45): a `cancel-return-and-site-tap` constraint on this company
  // negates rule 5.31 force-return-to-origin for the rest of the turn.
  if (hasCancelReturnAndSiteTap(state, company.id)) {
    logDetail(`Rule 5.31: company ${company.id as string} is shielded by cancel-return-and-site-tap — force-return-to-origin negated`);
    return null;
  }

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

/**
 * Handle `agent-discard-return-to-origin` (e.g. Baduila dm-2): the hazard
 * player discards an agent at the moving company's new site to force the
 * company to return to its site of origin.
 *
 * - The agent's character card goes to the hazard player's discard pile; all
 *   its site-stack sites return to the location deck (they were never in play).
 * - Not an agent action, not against the hazard limit.
 * - Per CoE rule 2.IV.4 the company's movement/hazard phase immediately ends:
 *   `returnedToOrigin` is set (so {@link endCompanyMH} keeps the company at
 *   its site of origin and clears the movement), a `site-phase-do-nothing`
 *   constraint blocks the company's site phase, and end-of-M/H corruption
 *   triggers fire before the phase completes.
 */
export function handleAgentDiscardReturnToOrigin(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'agent-discard-return-to-origin') return wrongActionType(state, action, 'agent-discard-return-to-origin');

  const hazardIndex = getPlayerIndex(state, action.player);
  const hazardPlayer = state.players[hazardIndex];

  const agentIdx = hazardPlayer.agents.findIndex(a => a.id === action.agentId);
  if (agentIdx === -1) return { state, error: 'Agent not found' };

  const agent = hazardPlayer.agents[agentIdx];
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) return { state, error: 'Agent definition not found' };

  const hasEffect = getCardEffects(agentDef).some(e => e.type === 'agent-discard-return-to-origin');
  if (!hasEffect) return { state, error: 'Agent does not have agent-discard-return-to-origin effect' };

  const resourceIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[resourceIndex].companies[mhState.activeCompanyIndex];
  if (!company) return { state, error: 'No active company' };
  if (!company.destinationSite) return { state, error: 'Company is not moving to a new site' };
  if (mhState.returnedToOrigin) return { state, error: 'Company was already returned to its site of origin' };

  logDetail(`Agent discard-return-to-origin "${agentDef.name}": discarded at "${mhState.destinationSiteName ?? '?'}" — company ${company.id as string} returns to its site of origin (rule 2.IV.4)`);

  // Discard the agent: character card to discard pile, stack sites back to
  // the location deck (they were never in play).
  let newState = updatePlayer(state, hazardIndex, p => ({
    ...p,
    agents: p.agents.filter((_, i) => i !== agentIdx),
    discardPile: [...p.discardPile, toCardInstance(agent.character)],
    siteDeck: [...p.siteDeck, ...agent.siteStack],
  }));

  // Rule 2.IV.4: the company's player cannot initiate any actions during
  // that company's site phase.
  newState = addConstraint(newState, {
    source: agent.character.instanceId,
    sourceDefinitionId: agent.character.definitionId,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: { type: 'site-phase-do-nothing' },
  });

  // Rule 2.IV.4: the company's movement/hazard phase immediately ends.
  const newMhState = { ...mhState, returnedToOrigin: true };
  const withChecks = fireEndOfCompanyMHCorruptionChecks(newState, newMhState);
  return endCompanyMH(withChecks, newMhState);
}

export function endCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
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

    // Eddy in Fate's Tide (ba-57): "This site … never untaps for you." The
    // engine never untaps a stationary site, so the only refresh point is
    // re-placement on movement — when the Eddy owner re-enters a version of the
    // bound site definition, place it tapped instead of untapped.
    const arrivesTapped = siteNeverUntapsForOwner(state, company.destinationSite.definitionId, resourcePlayer.id);
    if (arrivesTapped) {
      logDetail(`Step 8: destination ${company.destinationSite.definitionId as string} carries this player's site lock — arriving tapped (never untaps for you)`);
    }
    // When sharing a sibling's site, inherit its actual tapped/untapped status
    // instead of recomputing one — the sibling's currentSite is the single
    // physical card, and it may already be tapped (e.g. a resource was played
    // there). Recomputing independently desyncs the two companies' views of
    // the same site instance until the site-phase merge, which then silently
    // picks whichever company happened to be listed first.
    const arrivalStatus = sharedDestinationOwner
      ? sharedDestinationOwner.currentSite!.status
      : (arrivesTapped ? CardStatus.Tapped : company.destinationSite.status);
    const updatedCompanies = [...resourcePlayer.companies];
    updatedCompanies[mhState.activeCompanyIndex] = {
      ...company,
      currentSite: { instanceId: company.destinationSite.instanceId, definitionId: company.destinationSite.definitionId, status: arrivalStatus },
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
      const siblingAtOriginIdx = resourcePlayer.companies.findIndex(
        (c, idx) => idx !== mhState.activeCompanyIndex
          && c.currentSite?.instanceId === originSite.instanceId,
      );
      // A sibling company may have already declared this same site as its
      // destination (Rule 2.II.7.2) without having arrived yet. The physical
      // card must not be discarded/returned out from under it — that would
      // let the inbound company's own Step 8 arrival fabricate a fresh
      // untapped copy of a site that is really still tapped, duplicating the
      // instance (one copy "arriving" untapped while the real card sits in
      // the discard pile).
      const inboundSiblingIdx = siblingAtOriginIdx !== -1 ? -1 : resourcePlayer.companies.findIndex(
        (c, idx) => idx !== mhState.activeCompanyIndex
          && c.destinationSite?.instanceId === originSite.instanceId,
      );
      if (siblingAtOriginIdx !== -1) {
        // The departing company no longer holds the physical card at all
        // (it moved elsewhere), so if it was the one holding the card, that
        // ownership must pass to the sibling left behind — otherwise the
        // site would end up with no owner even though a company still
        // occupies it.
        if (company.siteCardOwned) {
          const sibling = updatedCompanies[siblingAtOriginIdx];
          updatedCompanies[siblingAtOriginIdx] = { ...sibling, siteCardOwned: true };
          logDetail(`Step 8: site of origin remains in play — ownership passes to sibling company ${sibling.id as string}`);
        } else {
          logDetail(`Step 8: site of origin remains in play — still occupied by a sibling company`);
        }
      } else if (inboundSiblingIdx !== -1) {
        // Sync the real status onto the inbound sibling's pending destination
        // so its own arrival (which no longer finds a `currentSite` sibling to
        // inherit from) picks up the correct tapped/untapped state instead of
        // defaulting to a fresh untapped draw.
        const inbound = updatedCompanies[inboundSiblingIdx];
        updatedCompanies[inboundSiblingIdx] = {
          ...inbound,
          destinationSite: { ...inbound.destinationSite!, status: originSite.status },
        };
        logDetail(`Step 8: site of origin remains in play — sibling company ${inbound.id as string} is already traveling there, syncing status (${originSite.status as string})`);
      } else {
        const originDef = defById(state, originSite.definitionId);
        const isHaven = originDef && isSiteCard(originDef) && originDef.siteType === 'haven';
        // Caverns Unchoked (ba-51) / Breach the Hold (ba-50) / Roots of the
        // Earth (ba-74): a bound
        // Under-deeps site "is never discarded or returned to its location
        // deck". There is no unoccupied-in-play site zone, so the closest
        // faithful model is to always return it to the owner's location deck
        // (never discard it) so it stays re-accessible.
        const cavernsBound = resourcePlayer.cardsInPlay.some(
          c => c.attachedToSite === originSite.definitionId
            && cardKeepsBoundSitePermanent(defById(state, c.definitionId)),
        );
        const alwaysReturnToDeck = cavernsBound || (originDef && isSiteCard(originDef)
          && (originDef.effects ?? []).some(e => e.type === 'site-rule' && e.rule === 'always-return-to-deck'));
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
  // When a company has moved, discard any character items or allies with an
  // on-event: bearer-company-moves + self-discard move effect. An unconditional
  // trigger always discards (e.g. Align Palantír, an item that leaves play the
  // moment its bearer's company moves). A trigger carrying a `when` condition
  // discards only when that condition matches the *destination* site — used by
  // Mistress Lobelia (dm-178), an ally discarded whenever her company moves to a
  // site outside her allowed home region.
  if (company.destinationSite && !mhStateLocal.returnedToOrigin) {
    const movedCompany = newPlayers[activeIndex].companies[mhState.activeCompanyIndex];
    // The destination-site context the `when` clause is evaluated against.
    const destDef = defById(state, company.destinationSite.definitionId) as
      { name?: string; region?: string; siteType?: string } | undefined;
    const moveCtx = {
      // The movement type the company used to reach the destination. Lets a
      // `bearer-company-moves` self-discard fire only for certain movement
      // kinds — Evil Things Lingering (ba-45) discards "if its company moves
      // using region or starter movement" (not Under-deeps/special movement),
      // expressed as `when: { movementType: { $in: ["region", "starter"] } }`.
      movementType: mhState.movementType,
      destination: {
        name: destDef?.name,
        region: destDef?.region,
        siteType: destDef?.siteType,
      },
      // The region types the company traversed this move. Lets a
      // `bearer-company-moves` self-discard fire on "moves through a
      // Free-domain/Dark-domain" path clauses — Memories of Old Torture
      // (ba-67), whose ally is discarded via a `sitePath.regionTypes`
      // `$includes` gate.
      sitePath: { regionTypes: [...mhState.resolvedSitePath] },
      // The moving company itself. Lets a `bearer-company-moves` self-discard
      // fire only for a company that has shrunk past a threshold — the Palantír
      // of Amon Sûl (tw-296 / le-330) and Palantír of Osgiliath (tw-301 /
      // le-335) are discarded "if the bearer's company is ever below 2 (resp. 4)
      // characters and it moves", expressed as
      // `when: { "company.characterCount": { "$lt": 2 } }`. Counted as the
      // company stands on completing the move, which is the only moment the two
      // halves of that clause ("below N" and "it moves") are both settled.
      company: { characterCount: movedCompany.characters.length },
    };
    // True when a `bearer-company-moves` self-discard effect should fire given
    // its optional `when` gate against the destination site.
    const shouldDiscardOnMove = (def: CardDefinition | undefined): boolean =>
      getOnEventEffects(def, 'bearer-company-moves').some(
        e => isSelfDiscardMove(e.apply) && (!e.when || matchesCondition(e.when, moveCtx)),
      );
    // A converted-creature ally (Memories of Old Torture ba-67 / Ready to His
    // Will le-220) is the creature card itself, whose hazard-creature
    // definition carries no discard-on-move rule. That rule lives on the
    // `convert-creature-to-ally` event card "placed with the creature"
    // (in cards-in-play, `attachedTo` the ally). When such an event's
    // `bearer-company-moves` self-discard fires, discard the ally; the orphan
    // sweep (`discardOrphanedConvertedAllyEvents`) then discards the event too.
    const attachedEventDiscardsAllyOnMove = (allyInstanceId: CardInstanceId): boolean =>
      newPlayers[activeIndex].cardsInPlay.some(cp => {
        if (cp.attachedTo !== allyInstanceId) return false;
        return shouldDiscardOnMove(defById(state, cp.definitionId));
      });
    // Radagast (wh-8): "Hero allies Radagast controls have no movement
    // restrictions." An `ally-movement-restriction-exemption` effect the moving
    // player carries (on an in-play character or in `cardsInPlay`) suppresses the
    // `bearer-company-moves` self-discard for every ally matching its filter —
    // CRF 22 defines an ally's "movement restriction" as exactly its "Discard if
    // he/she moves to …" clause. Collected once per move for the active player.
    const allyMovementExemptionFilters: (Condition | null)[] = [];
    for (const def of [
      ...newPlayers[activeIndex].cardsInPlay.map(c => defById(state, c.definitionId)),
      ...Object.values(newPlayers[activeIndex].characters).map(c => defById(state, c.definitionId)),
    ]) {
      for (const eff of getCardEffects(def)) {
        if (eff.type === 'ally-movement-restriction-exemption') {
          allyMovementExemptionFilters.push(eff.filter ?? null);
        }
      }
    }
    // Whether a given ally definition is exempt from its movement-restriction
    // discard (any exemption filter matches; a `null` filter exempts every ally).
    const allyExemptFromMovementRestriction = (allyDef: CardDefinition | undefined): boolean =>
      allyDef !== undefined
      && allyMovementExemptionFilters.some(f => f === null || matchesDefinition(allyDef, f));
    let discardedAny = false;
    for (const charId of movedCompany.characters) {
      const charData = newPlayers[activeIndex].characters[charId];
      if (!charData) continue;
      const itemsToKeep: import('../index.js').ItemInPlay[] = [];
      const alliesToKeep: import('../index.js').AllyInPlay[] = [];
      const toDiscard: import('../index.js').CardInstance[] = [];
      for (const item of charData.items) {
        const itemDef = defById(state, item.definitionId);
        if (shouldDiscardOnMove(itemDef)) {
          logDetail(`bearer-company-moves: discarding item "${itemDef?.name ?? item.definitionId}" from ${charId as string}`);
          toDiscard.push(toCardInstance(item));
        } else {
          itemsToKeep.push(item);
        }
      }
      for (const ally of charData.allies) {
        const allyDef = defById(state, ally.definitionId);
        const wouldDiscard = shouldDiscardOnMove(allyDef) || attachedEventDiscardsAllyOnMove(ally.instanceId);
        if (wouldDiscard && allyExemptFromMovementRestriction(allyDef)) {
          logDetail(`bearer-company-moves: ally "${allyDef?.name ?? ally.definitionId}" would be discarded but has no movement restrictions (Radagast) — kept`);
          alliesToKeep.push(ally);
        } else if (wouldDiscard) {
          logDetail(`bearer-company-moves: discarding ally "${allyDef?.name ?? ally.definitionId}" from ${charId as string} (moved to ${destDef?.name ?? '?'})`);
          toDiscard.push(toCardInstance(ally));
        } else {
          alliesToKeep.push(ally);
        }
      }
      if (toDiscard.length > 0) {
        discardedAny = true;
        newPlayers[activeIndex] = {
          ...newPlayers[activeIndex],
          characters: {
            ...newPlayers[activeIndex].characters,
            [charId as string]: { ...charData, items: itemsToKeep, allies: alliesToKeep },
          },
          discardPile: [...newPlayers[activeIndex].discardPile, ...toDiscard],
        };
      }
    }
    if (discardedAny) {
      logDetail('bearer-company-moves: finished discarding cards from moving company');
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
        const fDef = state.cardPool[f.definitionId] as { name?: string } | undefined;
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
export function fireHavenRestoreTriggers(
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
    const ch = player.characters[charId];
    return ch && (ch.status === CardStatus.Tapped || ch.status === CardStatus.Inverted);
  });

  let result = state;
  for (const card of player.cardsInPlay) {
    if (card.attachedToSite !== siteDefId) continue;
    const def = defById(result, card.definitionId);
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
export function fireCompanyArrivesAtSite(
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
      const def = defById(state, card.definitionId);
      for (const effect of getOnEventEffects(def, 'company-arrives-at-site')) {
        if (effect.apply.type !== 'add-constraint') continue;
        const constraintKind = effect.apply.constraint;
        const scopeName = effect.apply.scope;
        if (!constraintKind || !scopeName) continue;

        const scope = parseConstraintScope(scopeName, arrivingCompanyId);
        if (!scope) continue;
        const kind = buildConstraintKind(state, effect, constraintKind);
        if (!kind) continue;
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

  // Scan allies in the arriving company for self-discard move on-event effects.
  newState = fireAllyArrivalEffects(newState, arrivingCompanyId, siteInstanceId);

  return newState;
}

/**
 * Scan allies attached to characters in the arriving company for
 * `on-event: company-arrives-at-site` effects with a self-discard `move`.
 * When the effect's `when` condition matches the arrival site context,
 * the ally is discarded from its bearer to the owning player's discard pile.
 */
export function fireAllyArrivalEffects(
  state: GameState,
  arrivingCompanyId: import('../index.js').CompanyId,
  siteInstanceId: import('../index.js').CardInstanceId,
): GameState {
  const siteDefId = resolveInstanceId(state, siteInstanceId);
  const siteDef = siteDefId ? state.cardPool[siteDefId] : undefined;
  const siteRegion = siteDef && isSiteCard(siteDef) ? siteDef.region : '';

  let newState = state;
  for (let pIdx = 0; pIdx < 2; pIdx++) {
    const player = newState.players[pIdx];
    const company = companyById(player.companies, arrivingCompanyId);
    if (!company) continue;

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char) continue;

      for (const ally of char.allies) {
        const def = defById(newState, ally.definitionId);
        const context: Record<string, unknown> = { site: { region: siteRegion } };
        const trigger = getOnEventEffects(def, 'company-arrives-at-site').find(
          e => isSelfDiscardMove(e.apply) && (!e.when || matchesCondition(e.when, context)),
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
 * Enumerate the site instances in `player`'s site deck whose site definition
 * passes `accept`, de-duplicated by definition (the first instance of each
 * accepted definition wins). Shared core of every "offer another movement to a
 * site from the site deck" enumerator below.
 */
function siteDeckDestinations(
  state: GameState,
  player: PlayerState,
  accept: (destDef: SiteCard, siteInst: CardInstance) => boolean,
): readonly CardInstance[] {
  const seenDefs = new Set<string>();
  const dests: CardInstance[] = [];
  for (const siteInst of player.siteDeck) {
    if (seenDefs.has(siteInst.definitionId as string)) continue;
    const destDef = defById(state, siteInst.definitionId);
    if (!destDef || !isSiteCard(destDef)) continue;
    if (!accept(destDef, siteInst)) continue;
    seenDefs.add(siteInst.definitionId as string);
    dests.push(siteInst);
  }
  return dests;
}

/**
 * Enumerate the Under-deeps destination sites (instances in the active
 * player's site deck) a company may reach via a Gangways over the Fire
 * (ba-60) extra move: Under-deeps-adjacent to the company's current site
 * (including adjacency the moving player's Caverns Unchoked ba-51 grants) and
 * not among the sites it has already used this turn.
 */
export function gangwaysExtraDestinations(
  state: GameState,
  activeIndex: number,
  company: Company,
  usedSiteDefIds: readonly CardDefinitionId[],
): readonly CardInstance[] {
  const player = state.players[activeIndex];
  const currentDef = companySiteDef(state, company);
  if (!currentDef) return [];
  const used = new Set(usedSiteDefIds.map(id => id as string));
  return siteDeckDestinations(state, player, (destDef, siteInst) =>
    !used.has(siteInst.definitionId as string)
    && isUnderDeepsAdjacent(state, currentDef, destDef, player.id));
}

/**
 * Advance after a company finishes its movement/hazard phase.
 *
 * Gangways over the Fire (ba-60): before finalizing the company, record that
 * it completed one more M/H phase this turn (for the roll penalty) and which
 * site it now occupies (for the "not used yet" restriction). If the active
 * player has an `extra-under-deeps-mh-phase` effect in play, the company
 * moved this turn, and a new Under-deeps destination remains available, offer
 * the choice of another Under-deeps movement/hazard phase (`gangways-offer`)
 * rather than finalizing. Otherwise the company is finalized normally.
 */
/**
 * Left Behind (td-41): enqueue a `left-behind-rejoin` resolution for each
 * `leftBehind` company of the active player whose original company still exists
 * and occupies the same site. Called at the M/H→Site transition, so the offers
 * short-circuit the Site phase and are resolved first. A company whose original
 * company is gone (eliminated / at a different site) simply keeps its own
 * separate existence and its `leftBehind` flag is cleared here.
 */
function enqueueLeftBehindRejoins(state: GameState, activeIndex: number): GameState {
  const player = state.players[activeIndex];
  const leftBehindCompanies = player.companies.filter(c => c.leftBehind && c.leftBehindOriginCompanyId);
  if (leftBehindCompanies.length === 0) return state;

  let s = state;
  const clearFlags = new Set<string>();
  for (const b of leftBehindCompanies) {
    const origin = player.companies.find(c => c.id === b.leftBehindOriginCompanyId);
    const sameSite = origin && origin.id !== b.id
      && origin.currentSite && b.currentSite
      && origin.currentSite.instanceId === b.currentSite.instanceId;
    if (!origin || !sameSite) {
      logDetail(`Left Behind: company ${b.id as string} cannot rejoin (original company absent or at a different site) — staying separate`);
      clearFlags.add(b.id as string);
      continue;
    }
    logDetail(`Left Behind: offering ${b.id as string} the option to rejoin ${origin.id as string}`);
    s = enqueueResolution(s, {
      source: null,
      actor: player.id,
      scope: { kind: 'phase', phase: Phase.Site },
      kind: { type: 'left-behind-rejoin', companyId: b.id, originCompanyId: origin.id },
    });
  }

  if (clearFlags.size > 0) {
    s = updatePlayer(s, activeIndex, p => ({
      ...p,
      companies: p.companies.map(c => clearFlags.has(c.id as string)
        ? { ...c, leftBehind: undefined, leftBehindOriginCompanyId: undefined, leftBehindExtraPhasePending: undefined }
        : c),
    }));
  }
  return s;
}

/**
 * Find an `extra-mh-phase` constraint (Master of Esgaroth td-135) that the
 * given company has just satisfied, or null.
 *
 * The card is played at the end of the organization phase on a *moving*
 * company, long before the destination is committed, so its "if the company
 * moves to a Border-hold" clause is a promise checked at the end of the
 * company's movement/hazard phase. A match therefore requires both that the
 * company actually moved this phase and that the site it now occupies has the
 * constraint's {@link requiresDestinationSiteType} (a constraint with no
 * required type matches any completed move).
 */
function extraMHPhaseConstraint(
  state: GameState,
  company: Company,
): import('../types/pending.js').ActiveConstraint | null {
  if (!company.moved) return null;
  const siteDef = companySiteDef(state, company);
  if (!siteDef) return null;
  for (const c of state.activeConstraints) {
    if (c.kind.type !== 'extra-mh-phase') continue;
    if (c.target.kind !== 'company' || c.target.companyId !== company.id) continue;
    const required = c.kind.requiresDestinationSiteType;
    if (required && siteDef.siteType !== required) {
      logDetail(`Extra M/H phase: company ${company.id as string} moved to ${siteDef.name} (${siteDef.siteType}), constraint requires ${required} — no extra phase`);
      continue;
    }
    return c;
  }
  return null;
}

/**
 * Find an untapped ally in `company`'s roster carrying an
 * `ally-tap-extra-mh-phase` effect (Shadowfax tw-326) whose company-composition
 * condition currently holds, or null.
 *
 * The ally attaches to one of the company's characters (`CharacterInPlay.allies`,
 * not a company-level list), but the condition is evaluated over the whole
 * company's roster the same way `discard-self-when-company` does
 * ({@link buildCompanyCompositionContext}) — the bearer does not have to be the
 * "one character" the effect counts.
 */
function findAllyTapExtraMHPhase(
  state: GameState,
  player: PlayerState,
  company: Company,
): { readonly allyInstanceId: CardInstanceId; readonly allyName: string } | null {
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    for (const ally of char.allies) {
      if (ally.status !== CardStatus.Untapped) continue;
      const def = defById(state, ally.definitionId);
      const effect = def && getCardEffects(def).find(
        (e): e is AllyTapExtraMHPhaseEffect => e.type === 'ally-tap-extra-mh-phase',
      );
      if (!effect) continue;
      const ctx = buildCompanyCompositionContext(state, player, company, effect.counts ?? []);
      if (!matchesCondition(effect.condition, ctx)) continue;
      return { allyInstanceId: ally.instanceId, allyName: def && 'name' in def ? (def as { name: string }).name : (ally.definitionId as string) };
    }
  }
  return null;
}

/**
 * Find an untapped character in `company`'s roster carrying a
 * `character-tap-extra-mh-phase` effect (Carambor le-5), or null. Unlike
 * {@link findAllyTapExtraMHPhase}, there is no company-composition condition
 * to evaluate — the bearer's own untapped status is the only gate.
 */
function findCharacterTapExtraMHPhase(
  state: GameState,
  player: PlayerState,
  company: Company,
): { readonly characterInstanceId: CardInstanceId; readonly characterName: string; readonly effect: CharacterTapExtraMHPhaseEffect } | null {
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char || char.status !== CardStatus.Untapped) continue;
    const def = defById(state, char.definitionId);
    const effect = def && getCardEffects(def).find(
      (e): e is CharacterTapExtraMHPhaseEffect => e.type === 'character-tap-extra-mh-phase',
    );
    if (!effect) continue;
    return { characterInstanceId: char.instanceId, characterName: def && 'name' in def ? (def as { name: string }).name : (char.definitionId as string), effect };
  }
  return null;
}

export function advanceAfterCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const currentCompany = state.players[activeIndex].companies[mhState.activeCompanyIndex];

  // The active company may no longer exist — e.g. every character was
  // eliminated during this M/H phase and the empty company was cleaned up.
  // Skip the company-specific follow-ups and finalize the slot directly.
  if (!currentCompany) {
    logDetail(`M/H advance: active company index ${mhState.activeCompanyIndex} no longer exists (company dissolved) — finalizing`);
    return finalizeCompanyMH(state, mhState);
  }

  // Left Behind (td-41), lone-character case: the flagged company runs one more
  // (separate) movement/hazard phase this turn with a hazard limit of one. Clear
  // the pending flag and return it to select-company without marking it handled,
  // so the loop re-runs it once. Its `leftBehind` flag forces the limit-1 snapshot.
  if (currentCompany.leftBehindExtraPhasePending) {
    logDetail(`Left Behind: lone company ${currentCompany.id as string} takes its separate M/H phase (limit 1)`);
    const clearedState = updatePlayer(state, activeIndex, p => ({
      ...p,
      companies: p.companies.map((c, idx) =>
        idx !== mhState.activeCompanyIndex ? c : { ...c, leftBehindExtraPhasePending: false }),
    }));
    return { state: { ...clearedState, phaseState: resetCompanyMHFields(mhState) } };
  }

  // Turning Hope to Despair (as-41), lone-character case: same pattern as
  // Left Behind's above, but via `forcedSoloExtraPhasePending` — no explicit
  // rejoin step follows, so `forcedSoloHazardLimit` (still true here) is
  // consumed and cleared when the re-run reaches `enterSetHazardLimitAndAutoAdvance`.
  if (currentCompany.forcedSoloExtraPhasePending) {
    logDetail(`Turning Hope to Despair: lone company ${currentCompany.id as string} takes its separate M/H phase (limit 1)`);
    const clearedState = updatePlayer(state, activeIndex, p => ({
      ...p,
      companies: p.companies.map((c, idx) =>
        idx !== mhState.activeCompanyIndex ? c : { ...c, forcedSoloExtraPhasePending: false }),
    }));
    return { state: { ...clearedState, phaseState: resetCompanyMHFields(mhState) } };
  }

  // grant-extra-mh-phase (Forced March le-185, Bridge tw-202, Leg It Double
  // Quick le-202): the company was flagged when the enabling resource event
  // resolved. Now that its move has committed, clear the flag and offer another
  // movement to an additional site — a fresh movement/hazard phase — via the
  // dedicated offer step. The active player may instead pass to finish here.
  if (currentCompany.extraMHPhasePending) {
    const underDeeps = currentCompany.extraMHPhasePending === 'under-deeps';
    logDetail(`Extra M/H phase: company ${currentCompany.id as string} may move to an additional ${underDeeps ? 'Under-deeps ' : ''}site → extra-mh-move-offer`);
    const clearedState = updatePlayer(state, activeIndex, p => ({
      ...p,
      companies: p.companies.map((c, idx) =>
        idx !== mhState.activeCompanyIndex ? c : { ...c, extraMHPhasePending: false }),
    }));
    return {
      state: {
        ...clearedState,
        phaseState: {
          ...mhState,
          step: 'extra-mh-move-offer' as const,
          extraMHMoveUnderDeeps: underDeeps ? true : undefined,
        },
      },
    };
  }

  // extra-mh-phase constraint (Master of Esgaroth td-135): played at the end of
  // the organization phase on a moving company, before its destination is
  // final, so the "if the company moves to a Border-hold" gate is evaluated
  // here instead of at play time. When the company really did move and its new
  // site matches, consume the constraint (exactly one extra phase, however the
  // second move ends) and route it through the shared extra-move offer step.
  const extraPhase = extraMHPhaseConstraint(state, currentCompany);
  if (extraPhase) {
    logDetail(`Extra M/H phase: "${extraPhase.sourceDefinitionId as string}" grants company ${currentCompany.id as string} a second movement/hazard phase → extra-mh-move-offer`);
    return {
      state: {
        ...removeConstraint(state, extraPhase.id),
        phaseState: { ...mhState, step: 'extra-mh-move-offer' as const },
      },
    };
  }

  // ally-tap-extra-mh-phase (Shadowfax tw-326): offer, don't force — the active
  // player may tap the qualifying untapped ally to send the company through the
  // shared extra-move offer step, or decline and finalize normally.
  const allyTapMatch = findAllyTapExtraMHPhase(state, state.players[activeIndex], currentCompany);
  if (allyTapMatch) {
    logDetail(`Ally-tap extra M/H phase: ${allyTapMatch.allyName} is untapped and company ${currentCompany.id as string}'s composition qualifies → ally-tap-mh-offer`);
    return { state: { ...state, phaseState: { ...mhState, step: 'ally-tap-mh-offer' as const } } };
  }

  // character-tap-extra-mh-phase (Carambor le-5): offer, don't force — the
  // active player may tap the qualifying untapped bearer character to send
  // the company through the shared extra-move offer step, or decline and
  // finalize normally.
  const characterTapMatch = findCharacterTapExtraMHPhase(state, state.players[activeIndex], currentCompany);
  if (characterTapMatch) {
    logDetail(`Character-tap extra M/H phase: ${characterTapMatch.characterName} is untapped in company ${currentCompany.id as string} → character-tap-mh-offer`);
    return { state: { ...state, phaseState: { ...mhState, step: 'character-tap-mh-offer' as const } } };
  }

  if (playerHasExtraUnderDeepsMH(state, activeIndex)) {
    const cid = currentCompany.id as string;
    // Record this completed M/H phase and the site the company now occupies.
    const phaseCounts = { ...(mhState.gangwaysPhaseCounts ?? {}) };
    phaseCounts[cid] = (phaseCounts[cid] ?? 0) + 1;
    const sitesUsed = { ...(mhState.gangwaysSitesUsed ?? {}) };
    const prevUsed = sitesUsed[cid] ?? [];
    const curDef = currentCompany.currentSite?.definitionId;
    sitesUsed[cid] = curDef && !prevUsed.includes(curDef) ? [...prevUsed, curDef] : prevUsed;
    const trackedMhState: MovementHazardPhaseState = {
      ...mhState,
      gangwaysPhaseCounts: phaseCounts,
      gangwaysSitesUsed: sitesUsed,
    };

    const dests = currentCompany.moved
      ? gangwaysExtraDestinations(state, activeIndex, currentCompany, sitesUsed[cid])
      : [];
    if (dests.length > 0) {
      logDetail(`Gangways over the Fire: company ${cid} completed M/H phase #${phaseCounts[cid]} and may take another Under-deeps movement (${dests.length} destination(s), roll penalty -${phaseCounts[cid]}) → gangways-offer`);
      return { state: { ...state, phaseState: { ...trackedMhState, step: 'gangways-offer' as const } } };
    }
    return finalizeCompanyMH(state, trackedMhState);
  }

  return finalizeCompanyMH(state, mhState);
}

/**
 * Enforce Urlurtsu Nurn's (le-409) reanimation constraint at the end of the
 * movement/hazard phase. A company created by the `reanimate-from-discard`
 * ability carries a `reanimatedRingwraithId` marker: its character "must move
 * to a different site from that of your Ringwraith this turn or be discarded".
 *
 * For each such company, locate the Ringwraith's current company (the
 * Ringwraith may itself have moved) and compare sites by definition id. If the
 * reanimated company still shares a site with the Ringwraith, its character(s)
 * are discarded to the owner's discard pile (the now-empty company is cleaned
 * up). A reanimated company that reached a different site keeps its
 * character(s); the turn-scoped marker is cleared so the constraint does not
 * carry into later turns.
 */
function discardStrandedReanimatedCompanies(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  if (!player.companies.some(c => c.reanimatedRingwraithId)) return state;

  // Snapshot the reanimated companies and their verdicts before mutating.
  const verdicts = player.companies
    .filter(c => c.reanimatedRingwraithId)
    .map(c => {
      const rwId = c.reanimatedRingwraithId!;
      const rwCompany = player.companies.find(o => o.characters.includes(rwId));
      const rwSite = rwCompany?.currentSite?.definitionId;
      const mySite = c.currentSite?.definitionId;
      const stranded = rwSite !== undefined && mySite !== undefined && rwSite === mySite;
      return { companyId: c.id, charIds: [...c.characters], stranded };
    });

  let result = state;
  for (const v of verdicts) {
    if (v.stranded) {
      logDetail(`Urlurtsu Nurn (le-409): reanimated company ${v.companyId as string} still shares a site with the Ringwraith — discarding its character(s) at end of movement/hazard phase`);
      for (const charId of v.charIds) {
        const char = result.players[playerIndex].characters[charId];
        if (!char) continue;
        result = discardCharacterToDiscardPile(result, playerIndex, charId, char);
      }
    } else {
      logDetail(`Urlurtsu Nurn (le-409): reanimated company ${v.companyId as string} reached a different site than the Ringwraith — its character(s) remain in play`);
      result = updatePlayer(result, playerIndex, p => ({
        ...p,
        companies: p.companies.map(c =>
          c.id === v.companyId ? { ...c, reanimatedRingwraithId: undefined } : c,
        ),
      }));
    }
  }
  return result;
}

/**
 * Enforce the second half of CoE 2.II.3.1.R2 (rule 3.07) at the end of all
 * movement/hazard phases: "If a Ringwraith is played as a new company at a
 * non-Darkhaven site that contains another company with non-Ringwraith
 * characters, and if both companies are still there at the end of all
 * movement/hazard phases when they would be forced to combine, immediately
 * discard the non-Ringwraith company."
 *
 * Runs immediately before {@link autoMergeNonHavenCompanies} and keys off the
 * same grouping: companies of one player sharing a site instance at a non-haven
 * site — precisely the ones rule 2.IV.6 is about to force together. Where such a
 * group holds both a Ringwraith's company and companies with non-Ringwraith
 * characters, the latter are discarded instead of merged, so the Ringwraith is
 * never forced into an illegal company. Groups at a haven are skipped: a
 * Darkhaven lifts the composition restriction outright, and no haven forces a
 * combine in the first place.
 */
export function discardNonRingwraithCompaniesAtSharedSite(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  if (player.companies.length < 2) return state;

  // Group by site instance, mirroring `autoMergeNonHavenCompanies` (including
  // its Left Behind exemption — such a company is never forced to combine).
  const groups = new Map<string, typeof player.companies[number][]>();
  for (const company of player.companies) {
    if (!company.currentSite || company.leftBehind) continue;
    const key = company.currentSite.instanceId as string;
    const existing = groups.get(key);
    if (existing) existing.push(company);
    else groups.set(key, [company]);
  }

  const doomedCharIds: CardInstanceId[] = [];
  for (const companies of groups.values()) {
    if (companies.length < 2) continue;
    const siteDef = defById(state, companies[0].currentSite!.definitionId);
    if (isSiteCard(siteDef) && siteDef.siteType === SiteType.Haven) continue;
    if (!companies.some(c => companyHasRingwraith(state, player, c))) continue;
    for (const company of companies) {
      if (companyHasRingwraith(state, player, company)) continue;
      logDetail(`Rule 3.07: company ${company.id as string} has no Ringwraith but shares ${siteDef && 'name' in siteDef ? (siteDef as { name: string }).name : '?'} with a Ringwraith's company at the forced combine — discarding it`);
      doomedCharIds.push(...company.characters);
    }
  }

  let result = state;
  for (const charId of doomedCharIds) {
    const char = result.players[playerIndex].characters[charId];
    if (!char) continue;
    result = discardCharacterToDiscardPile(result, playerIndex, charId, char);
  }
  return result;
}

/**
 * Finalize the current company's movement/hazard phase: sweep company-scoped
 * constraints, then advance to the next company's M/H sub-phase or to the Site
 * phase once every company is handled.
 */
export function finalizeCompanyMH(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  // The company may have dissolved during its own M/H phase (all characters
  // eliminated); finish the slot without the company-scoped bookkeeping.
  const currentCompany = state.players[activeIndex].companies[mhState.activeCompanyIndex] as (typeof state.players)[number]['companies'][number] | undefined;
  const updatedHandled = currentCompany ? [...mhState.handledCompanyIds, currentCompany.id] : mhState.handledCompanyIds;

  // Sweep any active constraints / pending resolutions scoped to the
  // company that just finished its M/H sub-phase.
  if (currentCompany) {
    state = sweepExpired(state, { kind: 'company-mh-end', companyId: currentCompany.id });
  }

  const remainingCount = state.players[activeIndex].companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    // Urlurtsu Nurn (le-409): a reanimated company "must move to a different
    // site from that of your Ringwraith this turn or be discarded at the end of
    // the movement/hazard phase." Enforce before auto-merge so a stranded
    // reanimated character is discarded rather than silently merged into the
    // Ringwraith's company.
    state = discardStrandedReanimatedCompanies(state, activeIndex);
    // Rule 3.07: a non-Ringwraith company that would be forced to combine with
    // a Ringwraith's company at a non-Darkhaven site is discarded instead.
    // Also before auto-merge, for the same reason.
    state = discardNonRingwraithCompaniesAtSharedSite(state, activeIndex);
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
    // `specialMovement` must survive into the Site phase: Army of the Dead
    // (tw-193) is playable at Vale of Erech "the same turn" Paths of the Dead
    // moves the company there, and that play happens during the Site phase's
    // resource window, after this M/H→Site transition. It is cleared at the
    // Site→End-of-Turn transition instead (see `endSitePhase` in
    // reducer-site.ts). `extraRegionDistance` has no Site-phase use (it only
    // feeds M/H region-distance math), so it is still cleared here.
    const cleanedState = cleanupEmptyCompanies({
      ...updatePlayer(withAgentReset, activeIndex, p => ({
        ...p,
        companies: p.companies.map(c => ({ ...c, moved: false, extraRegionDistance: undefined })),
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

    // Left Behind (td-41): "He may rejoin his original company following all
    // movement/hazard phases." Offer the optional rejoin for each left-behind
    // company still at the same site as its original company.
    const withRejoin = enqueueLeftBehindRejoins(cleanedState, activeIndex);
    logDetail(`Movement/Hazard: all companies handled → advancing to Site phase`);
    return { state: withRejoin };
  }

  logDetail(`Movement/Hazard: company ${currentCompany?.id ?? '(dissolved)'} done → returning to select-company (${remainingCount} remaining)`);
  return {
    state: {
      ...state,
      phaseState: resetCompanyMHFields({ ...mhState, handledCompanyIds: updatedHandled }),
    },
  };
}

/**
 * Handle the `gangways-offer` step (Gangways over the Fire, ba-60): the active
 * player either finishes the company (`pass` → finalize) or selects a new
 * Under-deeps destination for another movement/hazard phase.
 *
 * On selection, the chosen site is drawn from the site deck and installed as
 * the company's destination; the phase re-enters at `reveal-new-site` with the
 * per-phase state reset, so the company proceeds through the normal Under-deeps
 * declare-path/roll flow. The roll for this extra phase is penalised by the
 * number of complete phases the company has already taken this turn (applied in
 * `handleRevealNewSite` from `gangwaysPhaseCounts`).
 */
export function handleGangwaysOffer(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);

  if (action.type === 'pass') {
    logDetail(`Gangways over the Fire: active player declined another Under-deeps movement — finalizing company`);
    return finalizeCompanyMH(state, mhState);
  }

  if (action.type !== 'gangways-extra-move') {
    return wrongActionType(state, action, 'gangways-extra-move', 'gangways-offer step');
  }

  const player = state.players[activeIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx !== mhState.activeCompanyIndex) {
    return { state, error: 'Gangways extra move must target the company that just finished its M/H phase' };
  }
  const company = player.companies[companyIdx];

  // The destination must be one of the offered Under-deeps sites (adjacent,
  // in the site deck, not used this turn).
  const usedSiteDefIds = mhState.gangwaysSitesUsed?.[action.companyId as string] ?? [];
  const dest = gangwaysExtraDestinations(state, activeIndex, company, usedSiteDefIds)
    .find(s => s.instanceId === action.destinationSite);
  if (!dest) {
    return { state, error: 'Chosen site is not a legal Gangways Under-deeps destination' };
  }

  const companies = [...player.companies];
  companies[companyIdx] = {
    ...company,
    destinationSite: { ...toCardInstance(dest), status: CardStatus.Untapped },
    movementPath: [],
  };
  const siteDeck = removeById(player.siteDeck, dest.instanceId);
  const destName = cardNameLocal(state, dest.definitionId);
  logDetail(`Gangways over the Fire: company ${action.companyId as string} sets Under-deeps destination ${destName} → re-entering reveal-new-site (extra M/H phase)`);

  return {
    state: {
      ...updatePlayer(state, activeIndex, p => ({ ...p, companies, siteDeck })),
      phaseState: { ...resetCompanyMHFields(mhState), step: 'reveal-new-site' as const, siteRevealed: true },
    },
  };
}

/** Local card-name lookup (definition name or the id as a fallback). */
function cardNameLocal(state: GameState, defId: CardDefinitionId): string {
  const def = defById(state, defId);
  return def?.name ?? (defId as string);
}

/**
 * Enumerate the destination sites (instances in the active player's site deck)
 * a company may reach with a `grant-extra-mh-phase` extra movement (Forced March
 * le-185, Bridge tw-202, Leg It Double Quick le-202): any site normally reachable
 * from the company's current site (starter or region movement) whose card is
 * still in the site deck. Restricted to the mover's own alignment so identically
 * named sites of the other side don't leak in. De-duplicated by definition.
 *
 * A company containing a Ringwraith avatar is still bound by CoE rule 2.II.7.R1
 * for this extra movement: without a mode card (Black Rider, Fell Rider, or
 * Heralded Lord) bound to the company, or when the company's current site is not
 * a Darkhaven, only Darkhaven destinations are legal; Coastal-Seas site paths are
 * always excluded; and Region movement is never available, mode or no mode. An
 * extra M/H phase grants another movement, not an exemption from these
 * restrictions — mirrors the same gate applied to the org-phase plan-movement
 * offer in {@link planMovementActions}.
 *
 * `requiresSitePathIncludes` (Carambor le-5, `character-tap-extra-mh-phase`
 * `requiresDestinationSitePathIncludes`), when given, additionally restricts
 * the result to sites whose static `sitePath` includes at least one of the
 * listed region types.
 */
export function extraMHMoveDestinations(
  state: GameState,
  activeIndex: number,
  company: Company,
  requiresSitePathIncludes?: readonly RegionType[],
): readonly CardInstance[] {
  const player = state.players[activeIndex];
  const currentDef = companySiteDef(state, company);
  if (!currentDef) return [];
  const movementMap = buildMovementMap(state.cardPool, player.alignment);
  // Candidates come from the player's own site deck, not from a cardPool
  // filter on exact alignment equality: a Fallen-wizard's location deck mixes
  // hero, minion, and Fallen-wizard-alignment sites (CoE 1.4.F1), and a Balrog's
  // mixes minion and Balrog-alignment sites (CoE 1.4.B1) — an exact-equality
  // filter would drop nearly all of a mixed-alignment player's own sites and
  // starve `grant-extra-mh-phase` cards (Carambor le-5, Forced March le-185,
  // Bridge tw-202, Leg It Double Quick le-202) of destinations. Mirrors the
  // candidate-building in `planMovementActions`.
  const seenSiteDefIds = new Set<string>();
  const allSites: SiteCard[] = [];
  for (const siteInst of player.siteDeck) {
    if (seenSiteDefIds.has(siteInst.definitionId as string)) continue;
    const siteDef = defById(state, siteInst.definitionId);
    if (!siteDef || !isSiteCard(siteDef)) continue;
    seenSiteDefIds.add(siteInst.definitionId as string);
    allSites.push(siteDef);
  }
  let reachable = getReachableSites(movementMap, currentDef, allSites);

  // CoE 2.II.7.R1: a company containing a Ringwraith avatar is bound by the
  // same Darkhaven-origin/mode-card gate, Coastal-Seas exclusion, and
  // Region-movement lock enforced for the org-phase plan-movement offer — a
  // `grant-extra-mh-phase` extra movement does not lift these restrictions.
  if (player.alignment === Alignment.Ringwraith && companyContainsRingwraithAvatar(state, player, company)) {
    const hasModeCard = ringwraithHasModeCard(state, company, player);
    const originIsDarkhaven = isDarkhavenSiteDef(currentDef);
    if (!hasModeCard || !originIsDarkhaven) {
      const before = reachable.length;
      reachable = reachable.filter(r => r.site.siteType === SiteType.Haven);
      const why = !hasModeCard ? 'no mode card' : `origin ${currentDef.name} is not a Darkhaven`;
      logDetail(`Extra M/H phase: company ${company.id as string} Ringwraith ${why} — restricted to Darkhaven destinations (${before} → ${reachable.length})`);
    }
    const beforeCoastal = reachable.length;
    reachable = reachable.filter(r => !(r.site.sitePath ?? []).includes(RegionType.Coastal));
    if (reachable.length !== beforeCoastal) {
      logDetail(`Extra M/H phase: company ${company.id as string} filtered out ${beforeCoastal - reachable.length} Coastal Seas destination(s) for Ringwraith`);
    }
    const beforeRegion = reachable.length;
    reachable = reachable.filter(r => r.movementType !== 'region');
    if (reachable.length !== beforeRegion) {
      logDetail(`Extra M/H phase: company ${company.id as string} filtered out ${beforeRegion - reachable.length} Region-movement destination(s) — Ringwraith companies may only use Starter or Under-deeps movement`);
    }
  }

  const reachableNames = new Set(reachable.map(r => r.site.name));
  const requiresRegionTypes = requiresSitePathIncludes && requiresSitePathIncludes.length > 0
    ? requiresSitePathIncludes
    : undefined;
  return siteDeckDestinations(state, player, destDef =>
    reachableNames.has(destDef.name)
    && (!requiresRegionTypes || requiresRegionTypes.some(rt => destDef.sitePath.includes(rt))));
}

/**
 * Enumerate the destination sites for the **Under-deeps** variant of the
 * extra-move offer (`grant-extra-mh-phase` `movement: "under-deeps"` — World
 * Gnawed by the Nameless as-110): sites in the active player's site deck that
 * carry the `under-deeps` keyword, are Under-deeps-adjacent to the company's
 * current site, and are not among the Under-deeps destinations this company
 * has already attempted to move to this turn (`underDeepsAttempts` on the M/H
 * phase state — a failed movement roll still counts as an attempt).
 * De-duplicated by definition.
 */
export function extraMHUnderDeepsDestinations(
  state: GameState,
  activeIndex: number,
  company: Company,
  attemptedSiteDefIds: readonly CardDefinitionId[],
): readonly CardInstance[] {
  const player = state.players[activeIndex];
  const currentDef = companySiteDef(state, company);
  if (!currentDef) return [];
  const attempted = new Set(attemptedSiteDefIds.map(id => id as string));
  return siteDeckDestinations(state, player, (destDef, siteInst) =>
    !attempted.has(siteInst.definitionId as string)
    && (destDef.keywords?.includes('under-deeps') ?? false)
    && isUnderDeepsAdjacent(state, currentDef, destDef));
}

/**
 * Handle the `extra-mh-move-offer` step (`grant-extra-mh-phase` resources —
 * Forced March le-185, Bridge tw-202, Leg It Double Quick le-202): the active
 * player either finishes the company (`pass` → finalize) or picks a new
 * destination for another movement/hazard phase (`extra-mh-move`).
 *
 * When the step was entered for an Under-deeps extra move
 * (`mhState.extraMHMoveUnderDeeps` — World Gnawed by the Nameless as-110),
 * the legal destinations come from {@link extraMHUnderDeepsDestinations}
 * instead, and the flag is cleared on either exit.
 *
 * On selection, the chosen site is drawn from the site deck and installed as the
 * company's destination; the per-phase state is reset and the phase re-enters at
 * `reveal-new-site`, so the company proceeds through the normal declare-path flow
 * and faces a fresh set of hazards.
 */
export function handleExtraMHMoveOffer(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const underDeeps = mhState.extraMHMoveUnderDeeps === true;
  const requiresSitePathIncludes = mhState.extraMHMoveRequiresSitePathIncludes;

  if (action.type === 'pass') {
    logDetail(`Extra M/H phase: active player declined the additional move — finalizing company`);
    return finalizeCompanyMH(state, { ...mhState, extraMHMoveUnderDeeps: undefined, extraMHMoveRequiresSitePathIncludes: undefined });
  }

  if (action.type !== 'extra-mh-move') {
    return wrongActionType(state, action, 'extra-mh-move', 'extra-mh-move-offer step');
  }

  const player = state.players[activeIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx !== mhState.activeCompanyIndex) {
    return { state, error: 'Extra M/H move must target the company that just finished its M/H phase' };
  }
  const company = player.companies[companyIdx];

  const candidates = underDeeps
    ? extraMHUnderDeepsDestinations(state, activeIndex, company, mhState.underDeepsAttempts?.[company.id as string] ?? [])
    : extraMHMoveDestinations(state, activeIndex, company, requiresSitePathIncludes);
  const dest = candidates.find(s => s.instanceId === action.destinationSite);
  if (!dest) {
    return { state, error: underDeeps ? 'Chosen site is not a legal extra Under-deeps destination' : 'Chosen site is not a legal extra-movement destination' };
  }

  const companies = [...player.companies];
  companies[companyIdx] = {
    ...company,
    destinationSite: { ...toCardInstance(dest), status: CardStatus.Untapped },
    movementPath: [],
  };
  const siteDeck = removeById(player.siteDeck, dest.instanceId);
  const destName = cardNameLocal(state, dest.definitionId);
  logDetail(`Extra M/H phase: company ${action.companyId as string} sets ${underDeeps ? 'Under-deeps ' : ''}destination ${destName} → re-entering reveal-new-site (extra M/H phase)`);

  return {
    state: {
      ...updatePlayer(state, activeIndex, p => ({ ...p, companies, siteDeck })),
      phaseState: {
        ...resetCompanyMHFields(mhState),
        step: 'reveal-new-site' as const,
        siteRevealed: true,
        extraMHMoveUnderDeeps: undefined,
        extraMHMoveRequiresSitePathIncludes: undefined,
      },
    },
  };
}

/**
 * Handle the `ally-tap-mh-offer` step (`ally-tap-extra-mh-phase` — Shadowfax
 * tw-326): the active player either finishes the company (`pass` → finalize)
 * or taps the qualifying ally (`ally-tap-extra-mh-phase`) to advance to the
 * shared `extra-mh-move-offer` step, where the destination for the additional
 * movement/hazard phase is chosen exactly as for `grant-extra-mh-phase`
 * resources (Forced March et al.) — the tap is the only thing this step adds.
 */
export function handleAllyTapExtraMHOffer(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type === 'pass') {
    logDetail(`Ally-tap extra M/H phase: active player declined — finalizing company`);
    return finalizeCompanyMH(state, mhState);
  }

  if (action.type !== 'ally-tap-extra-mh-phase') {
    return wrongActionType(state, action, 'ally-tap-extra-mh-phase', 'ally-tap-mh-offer step');
  }

  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx !== mhState.activeCompanyIndex) {
    return { state, error: 'Ally-tap extra M/H phase must target the company that just finished its M/H phase' };
  }
  const company = player.companies[companyIdx];
  const match = findAllyTapExtraMHPhase(state, player, company);
  if (!match || match.allyInstanceId !== action.allyInstanceId) {
    return { state, error: 'Chosen ally is not a legal ally-tap-extra-mh-phase source' };
  }

  const updated = updateAttachment(player, 'allies', action.allyInstanceId, a => ({ ...a, status: CardStatus.Tapped }));
  if (!updated) return { state, error: 'Ally to tap not found' };

  logDetail(`Ally-tap extra M/H phase: tapping ${match.allyName} — company ${action.companyId as string} may move to an additional site → extra-mh-move-offer`);

  return {
    state: {
      ...updatePlayer(state, activeIndex, () => updated.player),
      phaseState: { ...mhState, step: 'extra-mh-move-offer' as const },
    },
  };
}

/**
 * Handle the `character-tap-mh-offer` step (`character-tap-extra-mh-phase` —
 * Carambor le-5): the active player either finishes the company (`pass` →
 * finalize) or taps the qualifying bearer character
 * (`character-tap-extra-mh-phase`) to advance to the shared
 * `extra-mh-move-offer` step. When the bearer's effect declares
 * `requiresDestinationSitePathIncludes`, that restriction is threaded onto
 * `extraMHMoveRequiresSitePathIncludes` so the destination offer (and its
 * resolution) only considers matching sites.
 */
export function handleCharacterTapExtraMHOffer(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type === 'pass') {
    logDetail(`Character-tap extra M/H phase: active player declined — finalizing company`);
    return finalizeCompanyMH(state, mhState);
  }

  if (action.type !== 'character-tap-extra-mh-phase') {
    return wrongActionType(state, action, 'character-tap-extra-mh-phase', 'character-tap-mh-offer step');
  }

  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[activeIndex];
  const companyIdx = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIdx !== mhState.activeCompanyIndex) {
    return { state, error: 'Character-tap extra M/H phase must target the company that just finished its M/H phase' };
  }
  const company = player.companies[companyIdx];
  const match = findCharacterTapExtraMHPhase(state, player, company);
  if (!match || match.characterInstanceId !== action.characterInstanceId) {
    return { state, error: 'Chosen character is not a legal character-tap-extra-mh-phase source' };
  }

  const updatedPlayer = updateCharacter(player, match.characterInstanceId, c => ({ ...c, status: CardStatus.Tapped }));

  logDetail(`Character-tap extra M/H phase: tapping ${match.characterName} — company ${action.companyId as string} may move to an additional site → extra-mh-move-offer`);

  return {
    state: {
      ...updatePlayer(state, activeIndex, () => updatedPlayer),
      phaseState: {
        ...mhState,
        step: 'extra-mh-move-offer' as const,
        extraMHMoveRequiresSitePathIncludes: match.effect.requiresDestinationSitePathIncludes,
      },
    },
  };
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
export function checkCreatureKeying(state: GameState, def: CreatureCard, mhState: MovementHazardPhaseState): string | undefined {
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

  // Rule 5.09: derive the keyable region paths — name-scoped overrides
  // (Choking Shadows, Deeper Shadow), class remaps (Fell Winter), name
  // conversions (Girdle of Radagast), keying boosts (Withered Lands) — via
  // the shared helper so this validator can never disagree with the
  // offering side (`findCreatureKeyingMatches`).
  const candidateRegionPaths = computeCandidateRegionPaths(
    state, mhState.resolvedSitePath, mhState.resolvedSitePathNames, inPlayNames,
  );

  // The effective site type this creature is being keyed against — an active
  // site-type override (Hold Rebuilt and Repaired as-88, Rebuild the Town
  // dm-155, Choking Shadows tw-21, …) replaces the printed type, it does not
  // add to it. Mirror of the offering side in findCreatureKeyingMatches.
  const effectiveSiteTypes = resolveCreatureKeyingSiteType(
    state, {}, mhState.destinationSiteName, mhState.destinationSiteType, moverAlignment,
  );

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
    // Check site types against the destination's effective type(s)
    if (key.siteTypes && key.siteTypes.length > 0) {
      const matchedSiteType = effectiveSiteTypes.find(st => key.siteTypes!.includes(st));
      if (matchedSiteType) {
        logDetail(`Creature "${def.name}" keyable to site type: ${matchedSiteType}`);
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
    // Check adjacentToSiteNames — destination must be adjacent to one of the named sites
    if (key.adjacentToSiteNames && key.adjacentToSiteNames.length > 0 && destSiteCard && mhState.destinationSiteName) {
      for (const sn of key.adjacentToSiteNames) {
        const namedSites = Object.values(state.cardPool).filter(c => isSiteCard(c) && c.name === sn);
        for (const namedSite of namedSites) {
          if (isSiteCard(namedSite)) {
            const r1 = resolveAdjacency(state, namedSite, mhState.destinationSiteName);
            const r2 = destSiteCard.name ? resolveAdjacency(state, destSiteCard, namedSite.name) : undefined;
            if (r1 !== undefined || r2 !== undefined) {
              logDetail(`Creature "${def.name}" keyable — destination adjacent to named site "${sn}"`);
              return undefined;
            }
          }
        }
      }
    }
    // Check followsAttackRaces — the company must have already faced a
    // creature-sourced (not-site-keyed) attack this M/H sub-phase by one of
    // the listed races (Wolf-riders, td-86).
    if (key.followsAttackRaces && key.followsAttackRaces.length > 0) {
      const facedRaces = deriveFacedRaces(state, mhState.hazardsEncountered);
      const matchedRace = key.followsAttackRaces.find(r => facedRaces.includes(r));
      if (matchedRace) {
        logDetail(`Creature "${def.name}" keyable — follows a "${matchedRace}" attack faced this sub-phase`);
        return undefined;
      }
    }
    // Check movingBetweenSiteNames — the active company's origin (current)
    // site and its destination site must both be named and differ; one entry
    // covers both directions of the route (The Great Goblin tw-95:
    // Rivendell ↔ Lórien). A non-moving company's destination name equals
    // its origin name and never matches. Mirror of the offering side in
    // findCreatureKeyingMatches.
    if (key.movingBetweenSiteNames && key.movingBetweenSiteNames.length > 0 && mhState.destinationSiteName) {
      const activeIdx = getPlayerIndex(state, state.activePlayer ?? state.players[0].id);
      const activeCompany = state.players[activeIdx]?.companies[mhState.activeCompanyIndex];
      const originDefId = activeCompany?.currentSite
        ? resolveInstanceId(state, activeCompany.currentSite.instanceId)
        : null;
      const originName = originDefId ? defById(state, originDefId)?.name : undefined;
      if (originName
        && originName !== mhState.destinationSiteName
        && key.movingBetweenSiteNames.includes(originName)
        && key.movingBetweenSiteNames.includes(mhState.destinationSiteName)) {
        logDetail(`Creature "${def.name}" keyable — company moving from "${originName}" to "${mhState.destinationSiteName}"`);
        return undefined;
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
    if (k.adjacentToSiteNames?.length) parts.push(`adjacent-to: ${k.adjacentToSiteNames.join('/')}`);
    if (k.followsAttackRaces?.length) parts.push(`follows attack: ${k.followsAttackRaces.join('/')}`);
    if (k.movingBetweenSiteNames?.length) parts.push(`moving between: ${k.movingBetweenSiteNames.join('/')}`);
    return parts.join(', ');
  }).join(' OR ');
  return `${def.name} cannot be keyed to this company's path (requires ${keyDesc})`;
}

/**
 * Handle the 'select-company' action: resource player picks which company
 * resolves its M/H sub-phase next.
 */


/**
 * Shared resolution scaffolding for playing an in-play dual-mode
 * creature-permanent-event during the opponent's movement/hazard phase
 * (`tap-alt-permanent-event` / `attack-alt-permanent-event`): locate the
 * untapped card in the hazard player's `cardsInPlay`, resolve its definition
 * and `creature-alt-event` effect, and precompute the pieces both handlers
 * feed into the hazard-limit charge (the active company and the
 * `no-hazard-limit` bypass flag).
 *
 * Mode-specific validation (event mode, persistence, targeting, the charge
 * itself) stays with each caller so error messages and their ordering are
 * unchanged; `actionName` prefixes the shared lookup errors.
 */
function resolveAltPermanentEventPlay(
  state: GameState,
  mhState: MovementHazardPhaseState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  actionName: string,
): { error: string } | {
  hazardIndex: number;
  hazardPlayer: PlayerState;
  card: PlayerState['cardsInPlay'][number];
  def: CardDefinition | undefined;
  altEvent: CreatureAltEventEffect | undefined;
  activeCompany: Company | undefined;
  bypassesLimit: boolean;
} {
  const hazardIndex = getPlayerIndex(state, player);
  const hazardPlayer = state.players[hazardIndex];
  const card = hazardPlayer.cardsInPlay.find(c => c.instanceId === cardInstanceId);
  if (!card) return { error: `${actionName}: card not found in cardsInPlay` };
  if (card.status === CardStatus.Tapped) return { error: `${actionName}: card is already tapped` };
  const def = defById(state, card.definitionId);
  const altEvent = getCardEffects(def).find(
    (e): e is CreatureAltEventEffect => e.type === 'creature-alt-event',
  );
  const resourceIndex = getPlayerIndex(state, state.activePlayer!);
  const activeCompany = state.players[resourceIndex].companies[mhState.activeCompanyIndex];
  const bypassesLimit = !!def && 'effects' in def && hasPlayFlag(def, 'no-hazard-limit');
  return { hazardIndex, hazardPlayer, card, def, altEvent, activeCompany, bypassesLimit };
}

/**
 * Handle tap-alt-permanent-event: the hazard player taps an in-play dual-mode
 * creature that was played as a permanent-event (`creature-alt-event` mode
 * `permanent-event`, e.g. Ûvatha tw-107 / Adûnaphel tw-2) during the opponent's
 * movement/hazard phase. Per the card text the permanent-event "becomes a
 * short-event": it is removed from play and discarded, counts one against the
 * hazard limit, and its on-tap effects resolve through the ordinary short-event
 * chain path (tw-107: a `move` fetch of a hazard creature from discard to hand;
 * tw-2: a `tap-character` targeting the chosen `targetCharacterId`).
 */
function handleTapAltPermanentEvent(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'tap-alt-permanent-event') return wrongActionType(state, action, 'tap-alt-permanent-event');
  const resolved = resolveAltPermanentEventPlay(state, mhState, action.player, action.cardInstanceId, 'tap-alt-permanent-event');
  if ('error' in resolved) return { state, error: resolved.error };
  const { hazardIndex, hazardPlayer, card, def, altEvent, activeCompany, bypassesLimit } = resolved;
  if (!altEvent || altEvent.mode !== 'permanent-event') {
    return { state, error: 'tap-alt-permanent-event: not a creature-permanent-event' };
  }
  if (altEvent.persistent) {
    return { state, error: 'tap-alt-permanent-event: this permanent-event has no tap conversion — it stays in play' };
  }
  // Hoarmûrath of Dír (tw-44): its on-tap short-event modifies "any one attack",
  // so the conversion happens in the combat pre-assignment window via
  // `modify-attack` (`fromAltPermanentEvent`), not here.
  if (getCardEffects(def).some(e => e.type === 'modify-attack' && e.fromAltPermanentEvent)) {
    return { state, error: 'tap-alt-permanent-event: this permanent-event converts during an attack — tap it in the combat window' };
  }

  // CoE 2.1.2: a tap-character on-tap effect is a hazard directed at the opponent,
  // so it may never target the hazard player's own characters.
  if (action.targetCharacterId && hazardPlayer.characters[action.targetCharacterId]) {
    return { state, error: 'tap-alt-permanent-event: cannot target your own character' };
  }

  // Tapping counts one against the hazard limit (per the card text); the
  // limit check itself is skipped when no company is active.
  if (activeCompany && !bypassesLimit) {
    const charge = chargeHazardLimit(state, mhState, activeCompany.id, 'tap-alt-permanent-event');
    if ('error' in charge) return { state, error: charge.error };
  }
  const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;

  logDetail(`Creature-permanent-event "${def?.name ?? card.definitionId}" tapped during opponent M/H → becomes a short-event (${newHazardCount})`);

  // Khamûl the Easterling (tw-47): its on-tap short-event forces the opponent to
  // discard one card "for every Nazgûl permanent-event in play (including this
  // one) at the time of declaration". The CRF ruling fixes the number at
  // declaration, so we count matching in-play cards NOW — while this card is
  // still in play, so "including this one" falls out naturally — and thread the
  // result to the chain resolution via the payload.
  const forceDiscard = getCardEffects(def).find(
    (e): e is import('../types/effects.js').ForceOpponentDiscardEffect => e.type === 'force-opponent-discard',
  );
  let forcedDiscardCount: number | undefined;
  if (forceDiscard?.count?.countCardsInPlay) {
    const keyword = forceDiscard.count.countCardsInPlay.keyword;
    forcedDiscardCount = 0;
    for (const p of state.players) {
      for (const inPlay of p.cardsInPlay) {
        const d = defById(state, inPlay.definitionId);
        const keywords: readonly string[] =
          d && 'keywords' in d ? (d as { keywords?: readonly string[] }).keywords ?? [] : [];
        if (keywords.includes(keyword)) forcedDiscardCount++;
      }
    }
    logDetail(`force-opponent-discard: ${forcedDiscardCount} card(s) with keyword "${keyword}" in play at declaration → opponent discards ${forcedDiscardCount}`);
  }

  // "Becomes a short-event": remove from play, discard, and resolve its on-tap
  // effects via the short-event chain path (identical to playing it as a
  // short-event — its top-level effects resolve on chain resolution).
  const cardInstance = toCardInstance(card);
  let newState: GameState = {
    ...updatePlayer(state, hazardIndex, p => ({
      ...p,
      cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
      discardPile: [...p.discardPile, cardInstance],
    })),
    phaseState: { ...mhState, hazardsPlayedThisCompany: newHazardCount, resourcePlayerPassed: false },
  };

  const payload: import('../index.js').ChainEntryPayload = {
    type: 'short-event',
    ...(action.targetCharacterId ? { targetCharacterId: action.targetCharacterId } : {}),
    ...(forcedDiscardCount !== undefined ? { forcedDiscardCount } : {}),
  };
  newState = initiateOrPushChain(newState, action.player, cardInstance, payload, !bypassesLimit);
  return { state: newState };
}

/**
 * Handle attack-alt-permanent-event: the hazard player converts an in-play
 * dual-mode creature-permanent-event that "attacks as itself"
 * (`creature-alt-event` mode `permanent-event`, `attacksAsCreature: true` —
 * Shelob tw-86) into a full creature attack against the active company.
 * Unlike `tap-alt-permanent-event`'s short-event conversion, the card is
 * NOT removed from `cardsInPlay` here — it stays there so its own passive
 * `stat-modifier` effects (e.g. Shelob's +1 prowess/+1 strikes to Spider and
 * Animal attacks) still apply to its own attack once the chain resolves into
 * combat. `initiateCreatureCombat` (`chain-reducer.ts`) detects the creature
 * is already present in the hazard player's `cardsInPlay` and skips
 * re-adding it; `finalizeCombat`'s standard creature disposal (discard, or
 * the defender's kill pile if defeated) removes it once the attack resolves
 * — matching the card text's "discard when Shelob attacks".
 */
function handleAttackFromAltPermanentEvent(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  if (action.type !== 'attack-alt-permanent-event') return wrongActionType(state, action, 'attack-alt-permanent-event');
  const resolved = resolveAltPermanentEventPlay(state, mhState, action.player, action.cardInstanceId, 'attack-alt-permanent-event');
  if ('error' in resolved) return { state, error: resolved.error };
  const { card, def, altEvent, activeCompany, bypassesLimit } = resolved;
  if (!altEvent || altEvent.mode !== 'permanent-event' || !altEvent.attacksAsCreature) {
    return { state, error: 'attack-alt-permanent-event: this permanent-event does not attack as a creature' };
  }

  if (!activeCompany || activeCompany.id !== action.targetCompanyId) {
    return { state, error: 'attack-alt-permanent-event: not the active company' };
  }

  if (!bypassesLimit) {
    const charge = chargeHazardLimit(state, mhState, activeCompany.id, 'attack-alt-permanent-event');
    if ('error' in charge) return { state, error: charge.error };
  }
  const newHazardCount = bypassesLimit ? mhState.hazardsPlayedThisCompany : mhState.hazardsPlayedThisCompany + 1;

  logDetail(`Creature-permanent-event "${def?.name ?? card.definitionId}" attacks from its permanent-event state (${newHazardCount}/${currentHazardLimit(state, mhState, activeCompany.id)}) — initiating chain`);

  const newState: GameState = {
    ...state,
    phaseState: { ...mhState, hazardsPlayedThisCompany: newHazardCount, resourcePlayerPassed: false },
  };

  // Leave the card in `cardsInPlay` (do not remove it here) — its own
  // stat-modifier effects must still be visible when `initiateCreatureCombat`
  // resolves prowess/strikes for this very attack.
  const cardInstance = toCardInstance(card);
  const creaturePayload: import('../index.js').ChainEntryPayload = { type: 'creature' };
  return { state: initiateChain(newState, action.player, cardInstance, creaturePayload, 'normal', !bypassesLimit) };
}

/**
 * Handle tap-hazard-card-for-limit: hazard player taps a cardsInPlay permanent
 * event (e.g. Power Built by Waiting) to increase the hazard limit against the
 * current target company by the card's HazardLimitSwapEffect.tapValue.
 *
 * Does NOT count against the hazard limit itself.
 */
export function handleTapHazardCardForLimit(
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
export function handlePayHazardLimitToUntapCard(
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
 * Handle discard-card-for-hazard-limit: the hazard player discards a Dragon
 * "At Home" permanent event (METD §4) from play during the opponent's M/H
 * phase to raise the hazard limit against the current target company by the
 * card's {@link DiscardForHazardLimitEffect.value}.
 *
 * The card moves from cardsInPlay to the owner's discard pile (a routine
 * discard — it does NOT break the Dragon manifestation chain, and it does NOT
 * count against the hazard limit). The boost is added as a
 * `hazard-limit-modifier` constraint scoped to the target company's current
 * M/H phase, exactly like {@link handleTapHazardCardForLimit}.
 */
export function handleDiscardCardForHazardLimit(
  state: GameState,
  action: import('../types/actions-movement-hazard.js').DiscardCardForHazardLimitAction,
  _mhState: MovementHazardPhaseState,
): ReducerResult {
  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const card = player.cardsInPlay.find(c => c.instanceId === action.cardInstanceId);
  if (!card) return { state, error: `discard-card-for-hazard-limit: card ${action.cardInstanceId as string} not found in cardsInPlay` };

  const def = defById(state, card.definitionId);
  const effect = getCardEffects(def).find((e): e is import('../types/effects.js').DiscardForHazardLimitEffect => e.type === 'discard-for-hazard-limit');
  if (!effect) return { state, error: `discard-card-for-hazard-limit: no discard-for-hazard-limit effect on ${card.definitionId as string}` };

  const defName = (def as { name?: string } | undefined)?.name ?? card.definitionId as string;
  logDetail(`Discard for hazard limit: "${defName}" discarded from play → +${effect.value} hazard limit against company ${action.targetCompanyId as string}`);

  // Discard the card from play (routine discard — chain is not broken).
  const stateAfterDiscard = updatePlayer(state, playerIndex, p => ({
    ...p,
    cardsInPlay: p.cardsInPlay.filter(c => c.instanceId !== action.cardInstanceId),
    discardPile: [...p.discardPile, toCardInstance(card)],
  }));

  // Add hazard-limit-modifier constraint on the target company.
  const stateWithConstraint = addConstraint(stateAfterDiscard, {
    source: action.cardInstanceId,
    sourceDefinitionId: card.definitionId,
    target: { kind: 'company', companyId: action.targetCompanyId },
    kind: { type: 'hazard-limit-modifier', value: effect.value },
    scope: { kind: 'company-mh-phase', companyId: action.targetCompanyId },
  });

  return { state: stateWithConstraint };
}

/**
 * Handle reserve-creature: hazard player places a Dragon or Drake from hand
 * into the Summons from Long Sleep (as-39) reservation slot.
 *
 * Free action — does NOT count against the hazard limit. The creature
 * leaves the hand and enters player.reservedCreatures keyed to the AS-39
 * permanent-event instance.
 */
export function handleReserveCreature(
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
  if (race !== Race.Dragon && race !== Race.Drake) {
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
export function handlePlayReservedCreature(
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
  const charge = chargeHazardLimit(state, mhState, action.targetCompanyId, 'play-reserved-creature');
  if ('error' in charge) return { state, error: charge.error };

  // Validate chain is null (creatures must initiate new chain)
  if (state.chain !== null) {
    return { state, error: `play-reserved-creature: creatures must initiate a new chain` };
  }

  logDetail(`Summons from Long Sleep: playing reserved creature "${(def).name}" (+2 prowess) against company ${action.targetCompanyId as string} (${charge.newHazardCount}/${charge.limit})`);

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
      hazardsPlayedThisCompany: charge.newHazardCount,
      resourcePlayerPassed: false,
    },
  };

  // Initiate chain with +2 prowess bonus and reservingCardInstanceId
  const payload: import('../index.js').ChainEntryPayload = {
    type: 'creature',
    prowessBonus: 2,
    reservingCardInstanceId: action.sourceCardInstanceId,
    ...(action.keyedBy ? { keyedBy: action.keyedBy } : {}),
  };
  newState = initiateChain(newState, action.player, creatureCard, payload, 'normal', true);

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
export function handlePlayCreatureFromDiscard(
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
 * Handle spawn-replay-creature: the hazard player replays a hazard creature
 * from their own discard pile as an immediate attack, granted by an in-play
 * permanent-event carrying a `grant-replay-attacked-creature` effect
 * (Monstrosity of Diverse Shape, ba-21).
 *
 * The creature must match the effect's `filter` (Wolf / Animal) and must have
 * already attacked the target company this M/H phase (its name is in
 * `hazardsEncountered`). This play COUNTS against the hazard limit and may be
 * used only once per company's M/H phase per source permanent-event. The
 * creature enters a new chain and, after combat, is disposed by the normal
 * combat-finalization rules.
 */
export function handleSpawnReplayCreature(
  state: GameState,
  action: import('../types/actions-movement-hazard.js').SpawnReplayCreatureAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const hazardIdx = getPlayerIndex(state, action.player);
  const hazardPlayerState = state.players[hazardIdx];

  // Validate the source permanent-event is in play and carries the effect.
  const sourceCard = hazardPlayerState.cardsInPlay.find(c => c.instanceId === action.sourceInstanceId);
  if (!sourceCard) {
    return { state, error: `spawn-replay-creature: source ${action.sourceInstanceId as string} not in play` };
  }
  const sourceDef = defById(state, sourceCard.definitionId);
  const effect = sourceDef
    ? getCardEffects(sourceDef).find(
        (e): e is import('../index.js').GrantReplayAttackedCreatureEffect =>
          e.type === 'grant-replay-attacked-creature',
      )
    : undefined;
  if (!effect) {
    return { state, error: `spawn-replay-creature: ${sourceCard.definitionId as string} has no grant-replay-attacked-creature effect` };
  }

  // Once per company's M/H phase per source.
  const usedSources = mhState.spawnReplayUsedSources ?? [];
  if (usedSources.includes(action.sourceInstanceId)) {
    return { state, error: `spawn-replay-creature: ${sourceCard.definitionId as string} already used this M/H phase` };
  }

  // Validate the target creature is in the discard pile and matches the filter.
  const creatureCard = findById(hazardPlayerState.discardPile, action.creatureInstanceId);
  if (!creatureCard) {
    return { state, error: `spawn-replay-creature: creature ${action.creatureInstanceId as string} not found in discard pile` };
  }
  const creatureDef = defById(state, creatureCard.definitionId);
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') {
    return { state, error: `spawn-replay-creature: ${creatureCard.definitionId as string} is not a hazard-creature` };
  }
  if (!matchesCondition(effect.filter, creatureDef as unknown as Record<string, unknown>)) {
    return { state, error: `spawn-replay-creature: ${creatureCard.definitionId as string} does not match the effect filter` };
  }

  // "This card must have already attacked the company this turn."
  const creatureName = (creatureDef as { name?: string }).name ?? (creatureCard.definitionId as string);
  if (!mhState.hazardsEncountered.includes(creatureName)) {
    return { state, error: `spawn-replay-creature: "${creatureName}" has not attacked this company this turn` };
  }

  // Creatures must initiate a new chain.
  if (state.chain !== null) {
    return { state, error: `spawn-replay-creature: creatures must initiate a new chain` };
  }

  // This replay counts one against the hazard limit.
  const charge = chargeHazardLimit(state, mhState, action.targetCompanyId, 'spawn-replay-creature');
  if ('error' in charge) return { state, error: charge.error };

  logDetail(
    `Monstrosity of Diverse Shape: replaying "${creatureName}" from discard pile against company ${action.targetCompanyId as string} (${charge.newHazardCount}/${charge.limit} hazards)`,
  );

  // Remove the creature from the discard pile; mark the source used; count the
  // hazard; resume the resource player's window (rule 5.27).
  let newState = updatePlayer(state, hazardIdx, p => ({
    ...p,
    discardPile: removeById(p.discardPile, creatureCard.instanceId),
  }));
  newState = {
    ...newState,
    phaseState: {
      ...mhState,
      hazardsPlayedThisCompany: charge.newHazardCount,
      spawnReplayUsedSources: [...usedSources, action.sourceInstanceId],
      resourcePlayerPassed: false,
    },
  };

  // Initiate the creature combat. No prowess modifier.
  newState = initiateChain(newState, action.player, creatureCard, { type: 'creature' }, 'normal', true);

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
 * Check whether a creature's race is exempted from the hazard limit by
 * a `creature-type-no-hazard-limit` constraint on the target company.
 */
export function isCreatureRaceExempt(state: GameState, action: GameAction, def: CreatureCard): boolean {
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
export function consumeCreatureKeyingBypass(
  state: GameState,
  companyId: CompanyId,
  race: Race,
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
