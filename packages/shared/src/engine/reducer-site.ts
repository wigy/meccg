/**
 * @module reducer-site
 *
 * Site phase handlers for the game reducer. Covers company selection at sites,
 * entering sites, automatic attacks, on-guard reveals, resource play,
 * influence attempts, and site phase advancement.
 */

import type { GameState, PlayerState, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, SitePhaseState, HeroItemCard, CombatState, OnGuardCard, GameAction, GameEffect } from '../index.js';
import { Phase, CardStatus, isCharacterCard, isItemCard, isAllyCard, isFactionCard, isSiteCard, getPlayerIndex, GENERAL_INFLUENCE } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { collectCharacterEffects, resolveCheckModifier, resolveStatModifiers, resolveAttackProwess, resolveAttackStrikes, normalizeCreatureRace } from './effects/index.js';
import type { ResolverContext } from './effects/index.js';
import { matchesCondition } from '../effects/index.js';
import { initiateChain } from './chain-reducer.js';
import { availableDI } from './legal-actions/organization.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies } from './reducer-utils.js';
import { handlePlayPermanentEvent } from './reducer-events.js';
import { buildInPlayNames } from './recompute-derived.js';


/**
 * Handle all actions during the site phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the End-of-Turn phase.
 */
export function handleSite(state: GameState, action: GameAction): ReducerResult {
  const siteState = state.phaseState as SitePhaseState;

  if (siteState.step === 'select-company') {
    return handleSiteSelectCompany(state, action, siteState);
  }

  if (siteState.step === 'enter-or-skip') {
    return handleSiteEnterOrSkip(state, action, siteState);
  }

  if (siteState.step === 'reveal-on-guard-attacks') {
    return handleRevealOnGuardAttacks(state, action, siteState);
  }

  if (siteState.step === 'automatic-attacks') {
    return handleSiteAutomaticAttacks(state, action, siteState);
  }

  if (siteState.step === 'declare-agent-attack') {
    return handleSitePassStep(state, action, siteState, 'declare-agent-attack', 'resolve-attacks', true);
  }

  if (siteState.step === 'resolve-attacks') {
    return handleSiteResolveAttacks(state, action, siteState);
  }

  if (siteState.step === 'play-resources') {
    // Hazard player's defensive roll for opponent influence attempt
    if (siteState.pendingOpponentInfluence && action.type === 'opponent-influence-defend') {
      return handleOpponentInfluenceDefend(state, action, siteState);
    }
    if (siteState.awaitingOnGuardReveal) {
      return handleOnGuardRevealAtResource(state, action, siteState);
    }
    // Auto-execute pending resource action after on-guard chain resolves.
    // The resource was already declared — it proceeds once the on-guard
    // chain (if any) has resolved. The incoming action (typically pass) is
    // consumed to advance the state.
    if (siteState.pendingResourceAction && state.chain === null) {
      logDetail(`Site: on-guard window closed — executing pending resource action`);
      const pending = siteState.pendingResourceAction;
      const clearedSiteState: SitePhaseState = { ...siteState, pendingResourceAction: null };
      const clearedState: GameState = { ...state, phaseState: clearedSiteState };
      if (pending.type === 'play-hero-resource') {
        return handleSitePlayHeroResource(clearedState, pending, clearedSiteState);
      }
      if (pending.type === 'influence-attempt') {
        return handleInfluenceAttempt(clearedState, pending, clearedSiteState);
      }
    }
    return handleSitePlayResources(state, action, siteState);
  }

  // TODO: play-minor-item

  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in site phase step '${siteState.step}'` };
  }

  logDetail(`Site: active player ${action.player as string} passed → advancing to End-of-Turn phase`);
  return {
    state: {
      ...state,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const },
    },
  };
}

/**
 * Handle the 'select-company' action in the site phase: resource player
 * picks which company resolves its site phase next.
 *
 * After selection, the company advances to 'enter-or-skip'. Companies
 * that were returned to their site of origin during M/H are automatically
 * skipped (CoE line 336).
 */


/**
 * Handle the 'select-company' action in the site phase: resource player
 * picks which company resolves its site phase next.
 *
 * After selection, the company advances to 'enter-or-skip'. Companies
 * that were returned to their site of origin during M/H are automatically
 * skipped (CoE line 336).
 */
function handleSiteSelectCompany(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'select-company') {
    return { state, error: `Expected 'select-company' action during select-company step, got '${action.type}'` };
  }

  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may select a company` };
  }

  const playerIndex = getPlayerIndex(state, state.activePlayer);
  const player = state.players[playerIndex];
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);

  if (companyIndex === -1) {
    return { state, error: `Company '${action.companyId}' not found` };
  }

  if (siteState.handledCompanyIds.includes(action.companyId)) {
    return { state, error: `Company '${action.companyId}' has already been handled this turn` };
  }

  logDetail(`Site: selected company ${action.companyId} (index ${companyIndex}) → advancing to enter-or-skip`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'enter-or-skip' as const,
        activeCompanyIndex: companyIndex,
        automaticAttacksResolved: 0,
        siteEntered: false,
        resourcePlayed: false,
        minorItemAvailable: false,
        declaredAgentAttack: null,
        awaitingOnGuardReveal: false,
        pendingResourceAction: null,
      },
    },
  };
}

/**
 * Handle the 'enter-or-skip' step: resource player decides whether to
 * enter the site or do nothing.
 *
 * - `enter-site`: advances to reveal-on-guard-attacks (if auto-attacks
 *   exist) or directly to play-resources.
 * - `pass`: the company does nothing; its site phase ends immediately
 *   and we advance to the next company (CoE lines 341–343).
 */


/**
 * Handle the 'enter-or-skip' step: resource player decides whether to
 * enter the site or do nothing.
 *
 * - `enter-site`: advances to reveal-on-guard-attacks (if auto-attacks
 *   exist) or directly to play-resources.
 * - `pass`: the company does nothing; its site phase ends immediately
 *   and we advance to the next company (CoE lines 341–343).
 */
function handleSiteEnterOrSkip(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'enter-site' && action.type !== 'pass') {
    return { state, error: `Expected 'enter-site' or 'pass' during enter-or-skip step, got '${action.type}'` };
  }

  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may enter or skip a site` };
  }

  const playerIndex = getPlayerIndex(state, state.activePlayer);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Pass = do nothing, company's site phase ends immediately
  if (action.type === 'pass') {
    logDetail(`Site: company ${company.id} does nothing → advancing to next company`);
    return advanceSiteToNextCompany(state, siteState, company.id);
  }

  // Enter site — check whether the site has automatic-attacks
  const siteInPlay = company.currentSite;
  const siteDef = siteInPlay ? state.cardPool[siteInPlay.definitionId as string] : undefined;
  const autoAttackCount = siteDef && isSiteCard(siteDef) ? siteDef.automaticAttacks.length : 0;

  if (autoAttackCount > 0) {
    logDetail(`Site: company ${company.id} enters site with ${autoAttackCount} automatic-attack(s) → advancing to reveal-on-guard-attacks`);
    return {
      state: {
        ...state,
        phaseState: {
          ...siteState,
          step: 'reveal-on-guard-attacks' as const,
        },
      },
    };
  }

  // No automatic-attacks — skip straight to declare-agent-attack
  logDetail(`Site: company ${company.id} enters site with no automatic-attacks → advancing to declare-agent-attack`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'declare-agent-attack' as const,
        siteEntered: true,
      },
    },
  };
}

/**
 * Handle the 'reveal-on-guard-attacks' step (CoE Step 1, line 345).
 *
 * The hazard player (non-active) may reveal on-guard creatures keyed to
 * the site, marking them as revealed in the company's onGuardCards.
 * Passing advances to the 'automatic-attacks' step.
 */


/**
 * Handle the 'reveal-on-guard-attacks' step (CoE Step 1, line 345).
 *
 * The hazard player (non-active) may reveal on-guard creatures keyed to
 * the site, marking them as revealed in the company's onGuardCards.
 * Passing advances to the 'automatic-attacks' step.
 */
function handleRevealOnGuardAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  // Pass: advance to automatic-attacks
  if (action.type === 'pass') {
    logDetail(`Site: reveal-on-guard-attacks → advancing to automatic-attacks`);
    return {
      state: {
        ...state,
        phaseState: { ...siteState, step: 'automatic-attacks' as const },
      },
    };
  }

  // Reveal on-guard creature
  if (action.type === 'reveal-on-guard') {
    if (action.player === state.activePlayer) {
      return { state, error: 'Only the hazard player may reveal on-guard cards' };
    }

    const activeIndex = getPlayerIndex(state, state.activePlayer!);
    const resourcePlayer = state.players[activeIndex];
    const company = resourcePlayer.companies[siteState.activeCompanyIndex];
    if (!company) return { state, error: 'No active company' };

    const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === action.cardInstanceId);
    if (ogIdx === -1) return { state, error: 'Card not in on-guard cards' };

    const revealedCard = company.onGuardCards[ogIdx];
    const def = state.cardPool[revealedCard.definitionId as string];
    logDetail(`Site: hazard player reveals on-guard creature "${def?.name ?? revealedCard.definitionId}"`);

    // Mark the on-guard card as revealed (combat happens at Step 4)
    const newOnGuardCards = [...company.onGuardCards];
    newOnGuardCards[ogIdx] = { ...revealedCard, revealed: true };

    const newCompanies = [...resourcePlayer.companies];
    newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };

    const newPlayers = clonePlayers(state);
    newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };

    return { state: { ...state, players: newPlayers } };
  }

  return { state, error: `Unexpected action '${action.type}' during reveal-on-guard-attacks step` };
}

/**
 * Handle the 'automatic-attacks' step: initiate combat for each automatic
 * attack listed on the site card, one at a time.
 *
 * When entering this step, if no combat is active, the next unresolved
 * automatic attack initiates combat. The `automaticAttacksResolved` counter
 * tracks progress. When all auto-attacks are resolved, advances to
 * 'declare-agent-attack'.
 */


/**
 * Handle the 'automatic-attacks' step: initiate combat for each automatic
 * attack listed on the site card, one at a time.
 *
 * When entering this step, if no combat is active, the next unresolved
 * automatic attack initiates combat. The `automaticAttacksResolved` counter
 * tracks progress. When all auto-attacks are resolved, advances to
 * 'declare-agent-attack'.
 */
function handleSiteAutomaticAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during automatic-attacks step` };
  }

  const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  if (!company?.currentSite) return { state, error: 'No company or site for automatic attacks' };

  const siteDef = state.cardPool[company.currentSite.definitionId as string];
  if (!siteDef || !isSiteCard(siteDef)) return { state, error: 'Site definition not found' };

  const attackIndex = siteState.automaticAttacksResolved;
  const autoAttacks = siteDef.automaticAttacks;

  if (attackIndex >= autoAttacks.length) {
    // All automatic attacks resolved — advance to declare-agent-attack
    logDetail('Site: all automatic attacks resolved → declare-agent-attack');
    return {
      state: {
        ...state,
        phaseState: { ...siteState, step: 'declare-agent-attack' as const, siteEntered: true },
      },
    };
  }

  // Initiate combat for the next automatic attack
  const aa = autoAttacks[attackIndex];
  const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;

  const inPlayNames = buildInPlayNames(state);
  const creatureRace = normalizeCreatureRace(aa.creatureType);
  const effectiveProwess = resolveAttackProwess(state, aa.prowess, inPlayNames, creatureRace, true);
  const effectiveStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames, creatureRace);
  logDetail(`Site: initiating automatic attack ${attackIndex + 1}/${autoAttacks.length}: ${aa.creatureType} (${aa.strikes} strikes${effectiveStrikes !== aa.strikes ? ` → ${effectiveStrikes}` : ''}, ${aa.prowess} prowess${effectiveProwess !== aa.prowess ? ` → ${effectiveProwess}` : ''}${effectiveStrikes !== aa.strikes || effectiveProwess !== aa.prowess ? ' after global effects' : ''})`);

  const combat: CombatState = {
    attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite.instanceId, attackIndex },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: null,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return {
    state: {
      ...state,
      combat,
      phaseState: { ...siteState, automaticAttacksResolved: attackIndex + 1 },
    },
  };
}

/**
 * Handle the on-guard reveal window during resource play (CoE rule 2.V.6).
 *
 * The hazard player may reveal an on-guard hazard event in response to a
 * resource that would tap the site. The revealed card initiates a nested
 * chain. Passing clears the window and executes the pending resource action.
 */
/**
 * Handle the 'resolve-attacks' step (CoE Step 4, 2.V.iv).
 *
 * Declared on-guard creature attacks are initiated one at a time via the
 * chain of effects. Each creature enters the chain (allowing responses),
 * then combat starts when the chain resolves. When all declared attacks
 * are resolved, advances to 'play-resources'.
 */


/**
 * Handle the 'resolve-attacks' step (CoE Step 4, 2.V.iv).
 *
 * Declared on-guard creature attacks are initiated one at a time via the
 * chain of effects. Each creature enters the chain (allowing responses),
 * then combat starts when the chain resolves. When all declared attacks
 * are resolved, advances to 'play-resources'.
 */
function handleSiteResolveAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during resolve-attacks step` };
  }

  // If revealed on-guard creature attacks remain, initiate the next one via chain
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  if (company) {
    const revealedIdx = company.onGuardCards.findIndex(og => {
      if (!og.revealed) return false;
      const def = state.cardPool[og.definitionId as string];
      return def?.cardType === 'hazard-creature';
    });
    if (revealedIdx !== -1) {
      const attackCard = company.onGuardCards[revealedIdx];
      const def = state.cardPool[attackCard.definitionId as string];
      logDetail(`Site: initiating on-guard creature attack "${def?.name ?? attackCard.definitionId}" via chain`);

      // Remove from onGuardCards
      const newOnGuardCards = [...company.onGuardCards];
      newOnGuardCards.splice(revealedIdx, 1);

      // Update company, players
      const newCompanies = [...state.players[activePlayerIndex].companies];
      newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };
      const newPlayers = clonePlayers(state);
      newPlayers[activePlayerIndex] = { ...state.players[activePlayerIndex], companies: newCompanies };

      // Initiate chain with CardInstance
      const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;
      const cardInstance: CardInstance = { instanceId: attackCard.instanceId, definitionId: attackCard.definitionId };
      let newState: GameState = { ...state, players: newPlayers };
      newState = initiateChain(newState, hazardPlayerId, cardInstance, { type: 'creature' });
      return { state: newState };
    }
  }

  // All attacks resolved — advance to play-resources
  logDetail('Site: all attacks resolved → play-resources');
  return {
    state: {
      ...state,
      phaseState: { ...siteState, step: 'play-resources' as const },
    },
  };
}



function handleOnGuardRevealAtResource(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  // Pass: clear the window and execute the pending resource action directly
  // (bypassing handleSitePlayResources to avoid re-triggering the on-guard intercept)
  if (action.type === 'pass') {
    logDetail(`Site: hazard player passes on-guard reveal → executing pending resource`);
    const clearedSiteState: SitePhaseState = { ...siteState, awaitingOnGuardReveal: false, pendingResourceAction: null };
    const clearedState: GameState = { ...state, phaseState: clearedSiteState };
    const pending = siteState.pendingResourceAction;
    if (pending?.type === 'play-hero-resource') {
      return handleSitePlayHeroResource(clearedState, pending, clearedSiteState);
    }
    if (pending?.type === 'influence-attempt') {
      return handleInfluenceAttempt(clearedState, pending, clearedSiteState);
    }
    return { state: clearedState };
  }

  // Reveal on-guard event
  if (action.type === 'reveal-on-guard') {
    if (action.player === state.activePlayer) {
      return { state, error: 'Only the hazard player may reveal on-guard cards' };
    }

    const activeIndex = getPlayerIndex(state, state.activePlayer!);
    const resourcePlayer = state.players[activeIndex];
    const company = resourcePlayer.companies[siteState.activeCompanyIndex];
    if (!company) return { state, error: 'No active company' };

    const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === action.cardInstanceId);
    if (ogIdx === -1) return { state, error: 'Card not in on-guard cards' };

    const revealedCard = company.onGuardCards[ogIdx];
    const def = state.cardPool[revealedCard.definitionId as string];
    logDetail(`Site: hazard player reveals on-guard event "${def?.name ?? revealedCard.definitionId}" in response to resource play`);

    // Remove from on-guard
    const newOnGuardCards = [...company.onGuardCards];
    newOnGuardCards.splice(ogIdx, 1);

    const newCompanies = [...resourcePlayer.companies];
    newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };

    const newPlayers = clonePlayers(state);
    newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };

    // Clear the reveal window (pending resource action stays for after chain resolves)
    let newState: GameState = {
      ...state,
      players: newPlayers,
      phaseState: {
        ...siteState,
        awaitingOnGuardReveal: false,
      },
    };

    // Initiate a nested chain for the on-guard event (rule 2.V.6.1)
    const isPermanent = def && 'eventType' in def && def.eventType === 'permanent';
    const payload = isPermanent
      ? { type: 'permanent-event' as const, targetCharacterId: action.targetCharacterId }
      : { type: 'short-event' as const };
    const cardInstance: CardInstance = { instanceId: revealedCard.instanceId, definitionId: revealedCard.definitionId };
    newState = initiateChain(newState, action.player, cardInstance, payload);

    return { state: newState };
  }

  return { state, error: `Unexpected action '${action.type}' during on-guard reveal window` };
}

/**
 * Handle the 'play-resources' step: resource player plays items or
 * permanent events, or passes to end the company's site phase.
 *
 * - `play-hero-resource`: play an item at the site. Taps the carrying
 *   character. The item is attached to the character.
 * - `play-permanent-event`: delegated to the existing org-phase handler.
 * - `pass`: ends this company's site phase, advances to next company.
 */


/**
 * Handle the 'play-resources' step: resource player plays items or
 * permanent events, or passes to end the company's site phase.
 *
 * - `play-hero-resource`: play an item at the site. Taps the carrying
 *   character. The item is attached to the character.
 * - `play-permanent-event`: delegated to the existing org-phase handler.
 * - `pass`: ends this company's site phase, advances to next company.
 */
function handleSitePlayResources(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may play resources` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Pass — end this company's site phase
  if (action.type === 'pass') {
    logDetail(`Site: company ${company.id} done playing resources → advancing to next company`);
    return advanceSiteToNextCompany(state, siteState, company.id);
  }

  // Permanent events — reuse the existing handler (phase-independent)
  if (action.type === 'play-permanent-event') {
    return handlePlayPermanentEvent(state, action);
  }

  // On-guard intercept: when a site-tapping resource is about to be played
  // and on-guard cards exist, pause for the hazard player to reveal.
  if ((action.type === 'play-hero-resource' || action.type === 'influence-attempt')
    && company.onGuardCards.length > 0
    && company.currentSite?.status !== CardStatus.Tapped) {
    logDetail(`Site: resource play intercepted — hazard player may reveal on-guard cards`);
    return {
      state: {
        ...state,
        phaseState: {
          ...siteState,
          awaitingOnGuardReveal: true,
          pendingResourceAction: action,
        },
      },
    };
  }

  // Play hero resource (items, allies)
  if (action.type === 'play-hero-resource') {
    return handleSitePlayHeroResource(state, action, siteState);
  }

  // Influence a faction
  if (action.type === 'influence-attempt') {
    return handleInfluenceAttempt(state, action, siteState);
  }

  // Opponent influence attempt
  if (action.type === 'opponent-influence-attempt') {
    return handleOpponentInfluenceAttempt(state, action, siteState);
  }

  return { state, error: `Unexpected action '${action.type}' in play-resources step` };
}

/**
 * Handle playing a hero resource (item) at a site.
 *
 * Validates the card is in hand, is an item playable at this site type,
 * the target character is untapped and in the company, then attaches the
 * item and taps the character.
 */


/**
 * Handle playing a hero resource (item) at a site.
 *
 * Validates the card is in hand, is an item playable at this site type,
 * the target character is untapped and in the company, then attaches the
 * item and taps the character.
 */
function handleSitePlayHeroResource(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'play-hero-resource') return { state, error: 'Expected play-hero-resource action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Validate card is in hand
  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (cardIdx === -1) return { state, error: 'Card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  const isItem = isItemCard(def);
  const isAlly = !isItem && isAllyCard(def);
  if (!def || (!isItem && !isAlly)) return { state, error: 'Card is not an item or ally' };

  // Check site allows this resource
  const siteInPlay = company.currentSite;
  const siteDef = siteInPlay ? state.cardPool[siteInPlay.definitionId as string] : undefined;
  if (!siteDef || !isSiteCard(siteDef)) return { state, error: 'Company is not at a valid site' };

  if (isItem) {
    if (!siteDef.playableResources.includes((def as HeroItemCard).subtype)) {
      return { state, error: `${(def as HeroItemCard).subtype} items cannot be played at ${siteDef.name}` };
    }
  }

  // Validate target character
  const targetCharId = action.attachToCharacterId;
  if (!targetCharId) return { state, error: 'Must specify a character to carry this resource' };

  if (!company.characters.includes(targetCharId)) {
    return { state, error: 'Target character is not in this company' };
  }

  const charInPlay = player.characters[targetCharId as string];
  if (!charInPlay) return { state, error: 'Target character not found' };
  if (charInPlay.status !== CardStatus.Untapped) {
    return { state, error: 'Target character is not untapped' };
  }

  // Check character-scoped duplication limit for items
  if (isItem && (def as HeroItemCard).effects) {
    const charDupLimit = (def as HeroItemCard).effects!.find(
      (e): e is import('../index.js').DuplicationLimitEffect =>
        e.type === 'duplication-limit' && e.scope === 'character',
    );
    if (charDupLimit) {
      const copiesOnChar = charInPlay.items.filter(item => {
        const iDef = state.cardPool[item.definitionId as string];
        return iDef && iDef.name === def.name;
      }).length;
      if (copiesOnChar >= charDupLimit.max) {
        return { state, error: `${def.name} cannot be duplicated on this character` };
      }
    }
  }

  // Check site is not already tapped
  if (siteInPlay!.status === CardStatus.Tapped) {
    return { state, error: 'Site is already tapped' };
  }

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = charDef?.name ?? targetCharId;
  logDetail(`Site: playing ${def.name} on ${charName} — tapping character and site`);

  // Remove card from hand
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Tap the character and attach the item or ally
  const updatedChar: CharacterInPlay = {
    ...charInPlay,
    status: CardStatus.Tapped,
    items: isItem
      ? [...charInPlay.items, { instanceId: action.cardInstanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }]
      : charInPlay.items,
    allies: isAlly
      ? [...charInPlay.allies, { instanceId: action.cardInstanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }]
      : charInPlay.allies,
  };

  const newCharacters = { ...player.characters, [targetCharId as string]: updatedChar };
  const newPlayers = clonePlayers(state);

  // Tap the site by updating company's currentSite status
  const newCompanies = [...player.companies];
  newCompanies[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: { ...siteInPlay!, status: CardStatus.Tapped },
  };

  newPlayers[playerIndex] = { ...player, hand: newHand, characters: newCharacters, companies: newCompanies };

  return {
    state: {
      ...state,
      players: newPlayers,
      phaseState: {
        ...siteState,
        resourcePlayed: true,
      },
    },
  };
}

/**
 * Handle an influence attempt on a faction card during the site phase.
 *
 * Validates the faction is in hand and playable at this site, the
 * influencing character is untapped and in the company, then taps
 * the character, taps the site, and adds the faction to cardsInPlay.
 *
 * Note: The influence roll is not yet implemented — for now, the
 * faction is automatically played successfully.
 */


/**
 * Handle an influence attempt on a faction card during the site phase.
 *
 * Validates the faction is in hand and playable at this site, the
 * influencing character is untapped and in the company, then taps
 * the character, taps the site, and adds the faction to cardsInPlay.
 *
 * Note: The influence roll is not yet implemented — for now, the
 * faction is automatically played successfully.
 */
function handleInfluenceAttempt(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'influence-attempt') return { state, error: 'Expected influence-attempt action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Validate faction card is in hand
  const cardIdx = player.hand.findIndex(c => c.instanceId === action.factionInstanceId);
  if (cardIdx === -1) return { state, error: 'Faction card not in hand' };

  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  if (!def || !isFactionCard(def)) return { state, error: 'Card is not a faction' };

  // Validate influencing character
  const charId = action.influencingCharacterId;
  if (!company.characters.includes(charId)) {
    return { state, error: 'Influencing character is not in this company' };
  }

  const charInPlay = player.characters[charId as string];
  if (!charInPlay) return { state, error: 'Influencing character not found' };
  if (charInPlay.status !== CardStatus.Untapped) {
    return { state, error: 'Influencing character is not untapped' };
  }

  // Validate site is not tapped
  const siteInPlay = company.currentSite;
  if (!siteInPlay || siteInPlay.status === CardStatus.Tapped) {
    return { state, error: 'Site is already tapped' };
  }

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = charDef?.name ?? charId;

  // Calculate influence modifier: direct influence + DSL check-modifier effects
  let modifier = 0;
  if (charDef && isCharacterCard(charDef)) {
    modifier += charDef.directInfluence;

    // Build resolver context for influence check
    const resolverCtx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: {
        race: charDef.race,
        skills: charDef.skills,
        baseProwess: charDef.prowess,
        baseBody: charDef.body,
        baseDirectInfluence: charDef.directInfluence,
        name: charDef.name,
      },
      faction: {
        name: def.name,
        race: def.race,
      },
    };

    // Collect effects from the influencing character (and their items/allies)
    const charEffects = collectCharacterEffects(state, charInPlay, resolverCtx);

    // Collect effects from the faction card itself (standard modifications)
    if (def.effects) {
      for (const effect of def.effects) {
        if (effect.when && !matchesCondition(effect.when, resolverCtx as unknown as Record<string, unknown>)) continue;
        charEffects.push({ effect, sourceDef: def });
      }
    }

    // Sum all check-modifier effects for influence checks
    const dslModifier = resolveCheckModifier(charEffects, 'influence');
    if (dslModifier !== 0) {
      logDetail(`DSL influence check-modifiers: ${dslModifier >= 0 ? '+' : ''}${dslModifier}`);
    }
    modifier += dslModifier;

    // Resolve stat-modifier effects on direct-influence (e.g. Gimli +2 DI for Iron Hill Dwarves)
    const dslDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
    if (dslDI !== 0) {
      logDetail(`DSL direct-influence modifiers: ${dslDI >= 0 ? '+' : ''}${dslDI}`);
    }
    modifier += dslDI;
  }

  // Roll 2d6 + modifier vs influence number
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const d1 = roll.die1;
  const d2 = roll.die2;
  const total = d1 + d2 + modifier;
  const influenceNumber = def.influenceNumber;
  const modStr = modifier !== 0 ? ` + ${modifier}` : '';
  logDetail(`Influence attempt: ${charName} rolls ${d1} + ${d2}${modStr} = ${total} vs influence # ${influenceNumber}`);

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Influence: ${def.name}`,
  };

  // Remove faction from hand
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Tap the influencing character
  const updatedChar: CharacterInPlay = {
    ...charInPlay,
    status: CardStatus.Tapped,
  };

  const newCharacters = { ...player.characters, [charId as string]: updatedChar };
  const newPlayers = clonePlayers(state);

  // Tap the site
  const newCompanies = [...player.companies];
  newCompanies[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: { ...siteInPlay, status: CardStatus.Tapped },
  };

  // Store the roll on the player
  newPlayers[playerIndex] = { ...player, hand: newHand, characters: newCharacters, companies: newCompanies, lastDiceRoll: roll };

  if (total >= influenceNumber) {
    // Success — faction goes to cardsInPlay (marshalling point pile)
    logDetail(`Influence attempt succeeded (${total} >= ${influenceNumber})`);
    const newCardsInPlay = [...player.cardsInPlay, { instanceId: action.factionInstanceId, definitionId: handCard.definitionId, status: CardStatus.Untapped }];
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], cardsInPlay: newCardsInPlay };

    return {
      state: {
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: {
          ...siteState,
          resourcePlayed: true,
        },
      },
      effects: [rollEffect],
    };
  }

  // Failure — faction goes to discard pile
  logDetail(`Influence attempt failed (${total} < ${influenceNumber})`);
  const newDiscard = [...player.discardPile, handCard];
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], discardPile: newDiscard };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
      phaseState: {
        ...siteState,
        resourcePlayed: true,
      },
    },
    effects: [rollEffect],
  };
}

/**
 * Handle an opponent influence attempt (resource player declares + rolls).
 *
 * Validates the influencing character is untapped and in the active company,
 * the target exists at the same site and is not avatar-controlled, then
 * taps the influencer, rolls 2d6, and transitions to awaiting the
 * hazard player's defensive roll.
 *
 * CoE rules 10.10–10.12 step 1.
 */


/**
 * Handle an opponent influence attempt (resource player declares + rolls).
 *
 * Validates the influencing character is untapped and in the active company,
 * the target exists at the same site and is not avatar-controlled, then
 * taps the influencer, rolls 2d6, and transitions to awaiting the
 * hazard player's defensive roll.
 *
 * CoE rules 10.10–10.12 step 1.
 */
function handleOpponentInfluenceAttempt(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'opponent-influence-attempt') return { state, error: 'Expected opponent-influence-attempt action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  // Validate influencing character is untapped and in company
  const charId = action.influencingCharacterId;
  if (!company.characters.includes(charId)) {
    return { state, error: 'Influencing character is not in this company' };
  }
  const charInPlay = player.characters[charId as string];
  if (!charInPlay) return { state, error: 'Influencing character not found' };
  if (charInPlay.status !== CardStatus.Untapped) {
    return { state, error: 'Influencing character is not untapped' };
  }

  // Validate target exists on the opponent
  const opponentIndex = 1 - playerIndex;
  const opponent = state.players[opponentIndex];
  if (action.targetPlayer !== opponent.id) {
    return { state, error: 'Target player is not the opponent' };
  }

  // Find the target
  let targetMind = 0;
  let controllerDI = 0;

  if (action.targetKind === 'character') {
    const targetChar = opponent.characters[action.targetInstanceId as string];
    if (!targetChar) return { state, error: 'Target character not found' };
    const targetDef = state.cardPool[targetChar.definitionId as string];
    if (!targetDef || !isCharacterCard(targetDef)) return { state, error: 'Target is not a character' };
    if (targetDef.mind === null) return { state, error: 'Cannot influence an avatar' };
    targetMind = targetDef.mind;

    // Controller DI (rule 10.12 step 5) — only if under DI, not GI
    if (targetChar.controlledBy !== 'general') {
      controllerDI = availableDI(state, targetChar.controlledBy, opponent);
    }
  } else if (action.targetKind === 'ally') {
    // Find the ally on an opponent character
    let allyFound = false;
    for (const [oppCharId, oppChar] of Object.entries(opponent.characters)) {
      const allyInst = oppChar.allies.find(a => a.instanceId === action.targetInstanceId);
      if (allyInst) {
        const allyDef = state.cardPool[allyInst.definitionId as string];
        if (!allyDef || !isAllyCard(allyDef)) return { state, error: 'Target is not an ally' };
        targetMind = (allyDef as { mind: number }).mind;
        controllerDI = availableDI(state, oppCharId as CardInstanceId, opponent);
        allyFound = true;
        break;
      }
    }
    if (!allyFound) return { state, error: 'Target ally not found' };
  }

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = charDef?.name ?? charId;

  // Handle identical card reveal (rule 10.11)
  let revealedCard: { instanceId: CardInstanceId; definitionId: import('../index.js').CardDefinitionId } | null = null;
  let effectiveTargetMind = targetMind;
  const newHand = [...player.hand];

  if (action.revealedCardInstanceId) {
    const revealIdx = newHand.findIndex(c => c.instanceId === action.revealedCardInstanceId);
    if (revealIdx === -1) return { state, error: 'Revealed card not in hand' };
    const revealedHandCard = newHand[revealIdx];
    const revealedDef = state.cardPool[revealedHandCard.definitionId as string];

    // Validate: must be same name as target
    let targetName: string | undefined;
    if (action.targetKind === 'character') {
      const tDef = state.cardPool[opponent.characters[action.targetInstanceId as string]?.definitionId as string];
      targetName = tDef?.name;
    } else {
      for (const ch of Object.values(opponent.characters)) {
        const ally = ch.allies.find(a => a.instanceId === action.targetInstanceId);
        if (ally) {
          const aDef = state.cardPool[ally.definitionId as string];
          targetName = aDef?.name;
          break;
        }
      }
    }
    if (!revealedDef || revealedDef.name !== targetName) {
      return { state, error: 'Revealed card does not match target name' };
    }

    revealedCard = { instanceId: revealedHandCard.instanceId, definitionId: revealedHandCard.definitionId };
    newHand.splice(revealIdx, 1);
    effectiveTargetMind = 0;
    logDetail(`Opponent influence: revealing identical ${revealedDef.name} from hand — target mind treated as 0`);
  }

  // Tap the influencing character
  const updatedChar: CharacterInPlay = { ...charInPlay, status: CardStatus.Tapped };
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = {
    ...player,
    hand: newHand,
    characters: { ...player.characters, [charId as string]: updatedChar },
  };

  // Roll attacker 2d6
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const attackerRoll = roll.die1 + roll.die2;

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: player.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Opponent influence: ${charName} attacks${revealedCard ? ' (identical revealed)' : ''}`,
  };

  // Calculate modifiers
  const influencerDI = availableDI(state, charId, player);
  const opponentGI = GENERAL_INFLUENCE - opponent.generalInfluenceUsed;

  logDetail(`Opponent influence attempt: ${charName} rolls ${roll.die1} + ${roll.die2} = ${attackerRoll} (DI: ${influencerDI}, opponent GI: ${opponentGI}, target mind: ${effectiveTargetMind}${revealedCard ? ' [revealed]' : ''}, controller DI: ${controllerDI})`);

  return {
    state: {
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
      phaseState: {
        ...siteState,
        opponentInteractionThisTurn: 'influence',
        pendingOpponentInfluence: {
          influencerId: charId,
          targetInstanceId: action.targetInstanceId,
          targetKind: action.targetKind,
          targetPlayer: action.targetPlayer,
          attackerRoll,
          influencerDI,
          opponentGI,
          targetMind: effectiveTargetMind,
          controllerDI,
          revealedCard,
        },
      },
    },
    effects: [rollEffect],
  };
}

/**
 * Handle the hazard player's defensive roll for an opponent influence attempt.
 *
 * Rolls 2d6 for the defender, calculates the final result, and resolves
 * the influence attempt: on success, the target and its controlled non-follower
 * cards are discarded; on failure, only the influencer was tapped.
 *
 * CoE rules 10.12 steps 2–6.
 */


/**
 * Handle the hazard player's defensive roll for an opponent influence attempt.
 *
 * Rolls 2d6 for the defender, calculates the final result, and resolves
 * the influence attempt: on success, the target and its controlled non-follower
 * cards are discarded; on failure, only the influencer was tapped.
 *
 * CoE rules 10.12 steps 2–6.
 */
function handleOpponentInfluenceDefend(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'opponent-influence-defend') return { state, error: 'Expected opponent-influence-defend action' };

  const pending = siteState.pendingOpponentInfluence;
  if (!pending) return { state, error: 'No pending opponent influence attempt' };

  // Validate the hazard player is rolling
  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const opponentIndex = 1 - playerIndex;
  const opponent = state.players[opponentIndex];
  if (action.player !== opponent.id) {
    return { state, error: 'Only the hazard player may roll the defensive dice' };
  }

  // Roll defender 2d6
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const defenderRoll = roll.die1 + roll.die2;

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: opponent.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Opponent influence: defense`,
  };

  // Calculate final result:
  // attacker roll + influencer DI - opponent GI - defender roll - controller DI
  const finalResult = pending.attackerRoll + pending.influencerDI - pending.opponentGI - defenderRoll - pending.controllerDI;

  logDetail(`Opponent influence resolution: ${pending.attackerRoll} + ${pending.influencerDI} - ${pending.opponentGI} - ${defenderRoll} - ${pending.controllerDI} = ${finalResult} vs mind ${pending.targetMind}`);

  const newPlayers = clonePlayers(state);

  // Clear pending state
  const clearedSiteState: SitePhaseState = {
    ...siteState,
    pendingOpponentInfluence: null,
  };

  if (finalResult > pending.targetMind) {
    // Success — discard target and controlled non-follower cards
    logDetail(`Opponent influence succeeded (${finalResult} > ${pending.targetMind})`);
    discardInfluencedCard(newPlayers, opponentIndex, pending, state);

    return {
      state: cleanupEmptyCompanies({
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: clearedSiteState,
      }),
      effects: [rollEffect],
    };
  }

  // Failure — influencer was already tapped; revealed card goes to discard
  logDetail(`Opponent influence failed (${finalResult} <= ${pending.targetMind})`);

  // If an identical card was revealed, discard it
  if (pending.revealedCard) {
    const attackerIndex = getPlayerIndex(state, state.activePlayer!);
    const attacker = newPlayers[attackerIndex];
    newPlayers[attackerIndex] = {
      ...attacker,
      discardPile: [...attacker.discardPile, { instanceId: pending.revealedCard.instanceId, definitionId: pending.revealedCard.definitionId }],
    };
    logDetail(`Revealed card ${pending.revealedCard.instanceId} discarded after failed influence`);
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
      phaseState: clearedSiteState,
    },
    effects: [rollEffect],
  };
}

/**
 * Discard a card that was successfully influenced away from the opponent.
 *
 * For characters: moves the character, their items, allies to the discard pile.
 * Followers of the discarded character fall to GI if room, otherwise are discarded.
 * For allies: just moves the ally to the discard pile.
 */


/**
 * Discard a card that was successfully influenced away from the opponent.
 *
 * For characters: moves the character, their items, allies to the discard pile.
 * Followers of the discarded character fall to GI if room, otherwise are discarded.
 * For allies: just moves the ally to the discard pile.
 */
function discardInfluencedCard(
  players: [PlayerState, PlayerState],
  opponentIndex: number,
  pending: NonNullable<SitePhaseState['pendingOpponentInfluence']>,
  state: GameState,
): void {
  const opponent = players[opponentIndex];

  if (pending.targetKind === 'ally') {
    // Find and remove the ally from its controlling character
    for (const [charId, charInPlay] of Object.entries(opponent.characters)) {
      const allyIdx = charInPlay.allies.findIndex(a => a.instanceId === pending.targetInstanceId);
      if (allyIdx !== -1) {
        const ally = charInPlay.allies[allyIdx];
        const newAllies = [...charInPlay.allies];
        newAllies.splice(allyIdx, 1);
        const updatedChar = { ...charInPlay, allies: newAllies };
        const newChars = { ...opponent.characters, [charId]: updatedChar };
        const newDiscard = [...opponent.discardPile, { instanceId: ally.instanceId, definitionId: ally.definitionId }];
        players[opponentIndex] = { ...opponent, characters: newChars, discardPile: newDiscard };
        logDetail(`Discarded ally ${ally.instanceId}`);
        return;
      }
    }
    return;
  }

  // Character target — discard character + items + allies, handle followers
  const targetChar = opponent.characters[pending.targetInstanceId as string];
  if (!targetChar) return;

  const newDiscard = [...opponent.discardPile];

  // Discard items
  for (const item of targetChar.items) {
    newDiscard.push({ instanceId: item.instanceId, definitionId: item.definitionId });
    logDetail(`Discarded item ${item.instanceId} from influenced character`);
  }

  // Discard allies
  for (const ally of targetChar.allies) {
    newDiscard.push({ instanceId: ally.instanceId, definitionId: ally.definitionId });
    logDetail(`Discarded ally ${ally.instanceId} from influenced character`);
  }

  // Discard the character itself
  newDiscard.push({ instanceId: targetChar.instanceId, definitionId: targetChar.definitionId });
  logDetail(`Discarded influenced character ${targetChar.instanceId}`);

  // Handle followers — try to place under GI, otherwise discard
  const newCharacters = { ...opponent.characters };
  for (const followerId of targetChar.followers) {
    const follower = newCharacters[followerId as string];
    if (!follower) continue;
    const followerDef = state.cardPool[follower.definitionId as string];
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;

    // Check if there's room under GI
    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== pending.targetInstanceId)
      .reduce((sum, ch) => {
        const def = state.cardPool[ch.definitionId as string];
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);

    if (currentGIUsed + followerMind <= GENERAL_INFLUENCE) {
      // Move to GI
      newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      logDetail(`Follower ${followerId} falls to GI (mind ${followerMind}, GI used ${currentGIUsed})`);
    } else {
      // Discard follower and their items/allies
      for (const item of follower.items) {
        newDiscard.push({ instanceId: item.instanceId, definitionId: item.definitionId });
      }
      for (const ally of follower.allies) {
        newDiscard.push({ instanceId: ally.instanceId, definitionId: ally.definitionId });
      }
      newDiscard.push({ instanceId: follower.instanceId, definitionId: follower.definitionId });
      delete newCharacters[followerId as string];
      logDetail(`Follower ${followerId} discarded (no GI room)`);
    }
  }

  // Remove the target character
  delete newCharacters[pending.targetInstanceId as string];

  // Remove from companies
  const newCompanies = opponent.companies.map(company => {
    if (!company.characters.includes(pending.targetInstanceId)) return company;
    const newChars = company.characters.filter(id => id !== pending.targetInstanceId);
    return { ...company, characters: newChars };
  });

  players[opponentIndex] = {
    ...opponent,
    characters: newCharacters,
    companies: newCompanies,
    discardPile: newDiscard,
  };
}

/**
 * Handle a site phase step that currently only accepts 'pass' to advance
 * to the next step. Used as a stub for reveal-on-guard-attacks,
 * automatic-attacks, and declare-agent-attack until full logic is implemented.
 *
 * @param markEntered - If true, sets siteEntered when advancing (used after
 *   the last attack step to mark the company as having successfully entered).
 */


/**
 * Handle a site phase step that currently only accepts 'pass' to advance
 * to the next step. Used as a stub for reveal-on-guard-attacks,
 * automatic-attacks, and declare-agent-attack until full logic is implemented.
 *
 * @param markEntered - If true, sets siteEntered when advancing (used after
 *   the last attack step to mark the company as having successfully entered).
 */
function handleSitePassStep(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
  currentStep: string,
  nextStep: SitePhaseState['step'],
  markEntered?: boolean,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during ${currentStep} step, got '${action.type}'` };
  }
  if (action.player !== state.activePlayer) {
    return { state, error: `Only the active player may pass during ${currentStep}` };
  }

  logDetail(`Site: ${currentStep} → advancing to ${nextStep}`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: nextStep,
        ...(markEntered ? { siteEntered: true } : {}),
      },
    },
  };
}

/**
 * Advance the site phase to the next company or to End-of-Turn if all
 * companies have been handled.
 */
/**
 * Return all remaining on-guard cards from the resource player's companies
 * back to the hazard player's hand. Called at the end of all site phases.
 */


/**
 * Return all remaining on-guard cards from the resource player's companies
 * back to the hazard player's hand. Called at the end of all site phases.
 */
function returnOnGuardCardsToHand(state: GameState): GameState {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const hazardIndex = 1 - activeIndex;

  const resourcePlayer = state.players[activeIndex];
  const hazardPlayer = state.players[hazardIndex];

  const returnedCards: CardInstance[] = [];
  const newCompanies = resourcePlayer.companies.map(company => {
    if (company.onGuardCards.length > 0) {
      logDetail(`Cleanup: returning ${company.onGuardCards.length} on-guard card(s) from company ${company.id} to hazard player's hand`);
      returnedCards.push(...company.onGuardCards.map(og => ({ instanceId: og.instanceId, definitionId: og.definitionId })));
      return { ...company, onGuardCards: [] as readonly OnGuardCard[] };
    }
    return company;
  });

  if (returnedCards.length === 0) return state;

  const newPlayers = clonePlayers(state);
  newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };
  newPlayers[hazardIndex] = { ...hazardPlayer, hand: [...hazardPlayer.hand, ...returnedCards] };

  return { ...state, players: newPlayers };
}



function advanceSiteToNextCompany(
  state: GameState,
  siteState: SitePhaseState,
  handledCompanyId: CompanyId,
): ReducerResult {
  const updatedHandled = [...siteState.handledCompanyIds, handledCompanyId];

  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const remainingCount = state.players[playerIndex].companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    logDetail(`Site: all companies handled → advancing to End-of-Turn phase`);
    // Return remaining on-guard cards to hazard player's hand
    const cleanedState = returnOnGuardCardsToHand(state);
    return {
      state: cleanupEmptyCompanies({
        ...cleanedState,
        phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const },
      }),
    };
  }

  logDetail(`Site: company ${handledCompanyId} done → returning to select-company (${remainingCount} remaining)`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'select-company' as const,
        handledCompanyIds: updatedHandled,
        automaticAttacksResolved: 0,
        siteEntered: false,
        resourcePlayed: false,
        minorItemAvailable: false,
        declaredAgentAttack: null,
        awaitingOnGuardReveal: false,
        pendingResourceAction: null,
        opponentInteractionThisTurn: null,
        pendingOpponentInfluence: null,
      },
    },
  };
}

/**
 * End-of-turn phase handler (CoE 2.VI).
 *
 * Dispatches to sub-step handlers:
 * 1. discard — voluntary discard by either player
 * 2. reset-hand — draw/discard to base hand size
 * 3. signal-end — resource player ends the turn
 */

