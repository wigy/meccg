/**
 * @module reducer-site
 *
 * Site phase handlers for the game reducer. Covers company selection at sites,
 * entering sites, automatic attacks, on-guard reveals, resource play,
 * influence attempts, and site phase advancement.
 */

import type { GameState, PlayerState, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, SitePhaseState, CombatState, OnGuardCard, GameAction, GameEffect } from '../index.js';
import { Phase, CardStatus, isCharacterCard, isItemCard, isAllyCard, isFactionCard, isSiteCard, getPlayerIndex, GENERAL_INFLUENCE } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { collectCharacterEffects, resolveCheckModifier, resolveStatModifiers, resolveAttackProwess, resolveAttackStrikes, normalizeCreatureRace } from './effects/index.js';
import type { ResolverContext } from './effects/index.js';
import { matchesCondition } from '../effects/index.js';
import { initiateChain } from './chain-reducer.js';
import { availableDI } from './legal-actions/organization.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { handleGrantActionApply } from './reducer-organization.js';
import { buildInPlayNames } from './recompute-derived.js';
import { sweepExpired, enqueueResolution, removeConstraint } from './pending.js';
import { resolveEffective } from './effective.js';


/**
 * Handle all actions during the site phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the End-of-Turn phase.
 */
export function handleSite(state: GameState, action: GameAction): ReducerResult {
  const siteState = state.phaseState as SitePhaseState;

  // Pending wound corruption checks (Barrow-downs et al.) are now routed
  // through the unified pending-resolution dispatcher in `reducer.ts` /
  // `pending-reducers.ts` before this handler is reached.

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
    // Opponent-influence-defend and on-guard-window are now produced
    // and consumed via the unified pending-resolution dispatcher in
    // `reducer.ts` / `pending-reducers.ts`. The legacy fields are gone.
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
      phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const, resetHandDone: [false, false] as const },
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

  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const player = state.players[playerIndex];
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);

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
  // Granted-action activation (e.g. River: ranger taps to cancel
  // site-phase-do-nothing). Routed through the shared generic handler,
  // which resolves the apply from the active granted-action
  // constraint matching action.sourceCardId + action.actionId.
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }

  if (action.type !== 'enter-site' && action.type !== 'pass') {
    return { state, error: `Expected 'enter-site' or 'pass' during enter-or-skip step, got '${action.type}'` };
  }

  const playerIndex = getPlayerIndex(state, state.activePlayer!);
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

  const skipAutoAttacks = siteInPlay && state.activeConstraints.some(c =>
    c.kind.type === 'skip-automatic-attacks'
    && c.kind.siteDefinitionId === siteInPlay.definitionId,
  );
  if (skipAutoAttacks) {
    logDetail(`Site: automatic-attacks skipped by skip-automatic-attacks constraint`);
  }

  if (autoAttackCount > 0 && !skipAutoAttacks) {
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

  // Reveal on-guard card (creature or event affecting automatic-attacks)
  if (action.type === 'reveal-on-guard') {
    const activeIndex = getPlayerIndex(state, state.activePlayer!);
    const resourcePlayer = state.players[activeIndex];
    const company = resourcePlayer.companies[siteState.activeCompanyIndex];
    const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === action.cardInstanceId);
    const revealedCard = company.onGuardCards[ogIdx];
    const def = state.cardPool[revealedCard.definitionId as string];
    logDetail(`Site: hazard player reveals on-guard "${def?.name ?? revealedCard.definitionId}"`);

    const isEvent = def && def.cardType === 'hazard-event';
    const isLongOrPermanent = isEvent && 'eventType' in def &&
      (def.eventType === 'long' || def.eventType === 'permanent');

    if (isLongOrPermanent) {
      // Long/permanent events: remove from on-guard, add to hazard player's cardsInPlay
      logDetail(`${def.name} is a ${(def as { eventType: string }).eventType} event → cardsInPlay`);
      const newOnGuardCards = [...company.onGuardCards];
      newOnGuardCards.splice(ogIdx, 1);

      const newCompanies = [...resourcePlayer.companies];
      newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };

      const hazardIndex = getPlayerIndex(state, action.player);
      const newPlayers = clonePlayers(state);
      newPlayers[activeIndex] = { ...resourcePlayer, companies: newCompanies };
      newPlayers[hazardIndex] = {
        ...newPlayers[hazardIndex],
        cardsInPlay: [...newPlayers[hazardIndex].cardsInPlay, {
          instanceId: revealedCard.instanceId,
          definitionId: revealedCard.definitionId,
          status: CardStatus.Untapped,
        }],
      };

      return { state: { ...state, players: newPlayers } };
    }

    // Creatures: mark as revealed (combat happens at Step 4)
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
  const siteDef = state.cardPool[company.currentSite!.definitionId as string] as import('../types/cards.js').SiteCard;

  const attackIndex = siteState.automaticAttacksResolved;
  const autoAttacks = siteDef.automaticAttacks;

  if (attackIndex >= autoAttacks.length) {
    // Before advancing, check for auto-attack-duplicate constraints
    // (Incite Defenders). The duplicate re-uses the first auto-attack's
    // stats and is faced as an additional combat.
    const dupConstraint = state.activeConstraints.find(c =>
      c.target.kind === 'company'
      && c.target.companyId === company.id
      && c.kind.type === 'auto-attack-duplicate',
    );
    if (dupConstraint && autoAttacks.length > 0) {
      const aa = autoAttacks[0];
      const inPlayNames2 = buildInPlayNames(state);
      const creatureRace2 = normalizeCreatureRace(aa.creatureType);
      const dupProwess = resolveAttackProwess(state, aa.prowess, inPlayNames2, creatureRace2, true);
      const dupStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames2, creatureRace2);
      logDetail(`Site: initiating duplicate automatic attack (Incite Defenders): ${aa.creatureType} (${dupStrikes} strikes, ${dupProwess} prowess)`);
      const dupState = removeConstraint(state, dupConstraint.id);
      const dupCombat: CombatState = {
        attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: attackIndex },
        companyId: company.id,
        defendingPlayerId: state.activePlayer!,
        attackingPlayerId: state.players.find(p => p.id !== state.activePlayer)!.id,
        strikesTotal: dupStrikes,
        strikeProwess: dupProwess,
        creatureBody: null,
        creatureRace: creatureRace2,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      };
      return {
        state: {
          ...dupState,
          combat: dupCombat,
          phaseState: { ...siteState, automaticAttacksResolved: attackIndex + 1 },
        },
      };
    }

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
  const baseEffective = resolveAttackProwess(state, aa.prowess, inPlayNames, creatureRace, true);
  const effectiveStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames, creatureRace);

  // One-shot prowess boost from short-event environments like Choking
  // Shadows. Stored as an `attribute-modifier` constraint targeting
  // this company and gated by `site.type`. Consume the first matching
  // entry (single-use semantics).
  let boostedState: GameState = state;
  const boost = resolveEffective(
    state,
    { kind: 'company', companyId: company.id },
    'auto-attack.prowess',
    baseEffective,
    { site: { type: siteDef.siteType } },
  );
  const effectiveProwess = boost.value;
  if (boost.consumedIds.length > 0) {
    for (const id of boost.consumedIds) {
      const src = state.activeConstraints.find(c => c.id === id);
      if (src) logDetail(`Site: consuming attribute-modifier (auto-attack.prowess +${boost.value - baseEffective}) from "${state.cardPool[src.sourceDefinitionId as string]?.name ?? '?'}"`);
      boostedState = removeConstraint(boostedState, id);
    }
  }

  logDetail(`Site: initiating automatic attack ${attackIndex + 1}/${autoAttacks.length}: ${aa.creatureType} (${aa.strikes} strikes${effectiveStrikes !== aa.strikes ? ` → ${effectiveStrikes}` : ''}, ${aa.prowess} prowess${effectiveProwess !== aa.prowess ? ` → ${effectiveProwess}` : ''}${effectiveStrikes !== aa.strikes || effectiveProwess !== aa.prowess ? ' after global effects' : ''})`);

  const combat: CombatState = {
    attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: null,
    creatureRace,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return {
    state: {
      ...boostedState,
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



/**
 * Apply a hazard player's `reveal-on-guard` action during the on-guard
 * window: remove the revealed card from the active company's on-guard
 * pile and initiate a nested chain for it. Exported so the unified
 * pending-resolution dispatcher in `pending-reducers.ts` can drive
 * this from a queued `on-guard-window` resolution.
 *
 * Rule 2.V.6.1.
 */
export function applyOnGuardRevealAtResource(
  state: GameState,
  action: GameAction,
): ReducerResult {
  if (action.type !== 'reveal-on-guard') {
    return { state, error: `Expected reveal-on-guard action, got '${action.type}'` };
  }

  const siteState = state.phaseState as SitePhaseState;
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIndex];
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];
  const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === action.cardInstanceId);
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

  let newState: GameState = { ...state, players: newPlayers };

  // Initiate a nested chain for the on-guard event (rule 2.V.6.1)
  const isPermanent = def && 'eventType' in def && def.eventType === 'permanent';
  const payload = isPermanent
    ? { type: 'permanent-event' as const, targetCharacterId: action.targetCharacterId }
    : { type: 'short-event' as const };
  const cardInstance: CardInstance = { instanceId: revealedCard.instanceId, definitionId: revealedCard.definitionId };
  newState = initiateChain(newState, action.player, cardInstance, payload);

  return { state: newState };
}

/**
 * Execute a deferred site action (the pending action from an on-guard
 * window). Currently used only for `play-hero-resource`. Exported so
 * the unified pending-resolution dispatcher can run the deferred action
 * after the on-guard window closes.
 */
export function executeDeferredSiteAction(
  state: GameState,
  deferredAction: GameAction,
): ReducerResult {
  if (deferredAction.type !== 'play-hero-resource') {
    return { state, error: `Unsupported deferred site action: ${deferredAction.type}` };
  }
  return handleSitePlayHeroResource(state, deferredAction, state.phaseState as SitePhaseState);
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

  // Resource short-events (e.g. Marvels Told) — per CoE 2.1.1 they are
  // playable during any phase of the active player's turn. Delegate to
  // the shared resource short-event handler.
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }

  // On-guard intercept: when a site-tapping resource is about to be played
  // and on-guard cards exist, pause for the hazard player to reveal.
  // (Influence attempts use the chain of effects instead.)
  if (action.type === 'play-hero-resource'
    && company.onGuardCards.length > 0
    && company.currentSite?.status !== CardStatus.Tapped) {
    logDetail(`Site: resource play intercepted — enqueuing on-guard-window resolution for hazard player`);
    const hazardPlayer = state.players.find(p => p.id !== state.activePlayer)!;
    return {
      state: enqueueResolution(state, {
        source: action.cardInstanceId,
        actor: hazardPlayer.id,
        scope: { kind: 'phase-step', phase: Phase.Site, step: 'play-resources' },
        kind: {
          type: 'on-guard-window',
          stage: 'reveal-window',
          deferredAction: action,
        },
      }),
    };
  }

  // Play hero resource (items, allies)
  if (action.type === 'play-hero-resource') {
    return handleSitePlayHeroResource(state, action, siteState);
  }

  // Influence a faction — initiates chain of effects so the opponent can
  // reveal on-guard cards in response before the roll resolves.
  if (action.type === 'influence-attempt') {
    return handleInfluenceAttemptDeclare(state, action, siteState);
  }

  // Opponent influence attempt
  if (action.type === 'opponent-influence-attempt') {
    return handleOpponentInfluenceAttempt(state, action, siteState);
  }

  // Grant-action (e.g. Cram untap-bearer, rule 2.1.1)
  if (action.type === 'activate-granted-action' && action.actionId === 'untap-bearer') {
    return handleGrantActionApply(state, action);
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

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];
  const isItem = isItemCard(def);
  const isAlly = !isItem && isAllyCard(def);

  const siteInPlay = company.currentSite!;

  const targetCharId = action.attachToCharacterId!;
  const charInPlay = player.characters[targetCharId as string];
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
    currentSite: { ...siteInPlay, status: CardStatus.Tapped },
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
/**
 * Handle the declaration of a faction influence attempt.
 *
 * Validates the action, removes the faction card from hand, taps the
 * influencing character, and initiates a chain of effects so the opponent
 * can reveal on-guard cards or respond before the roll resolves.
 */
function handleInfluenceAttemptDeclare(
  state: GameState,
  action: GameAction,
  _siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'influence-attempt') return { state, error: 'Expected influence-attempt action' };

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];

  const cardIdx = player.hand.findIndex(c => c.instanceId === action.factionInstanceId);
  const handCard = player.hand[cardIdx];
  const def = state.cardPool[handCard.definitionId as string];

  const charId = action.influencingCharacterId;
  const charInPlay = player.characters[charId as string];

  logDetail(`Site: ${def.name} influence attempt declared by ${player.name} — initiating chain`);

  // Remove faction from hand (it goes onto the chain)
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Tap the influencing character
  const updatedChar: CharacterInPlay = {
    ...charInPlay,
    status: CardStatus.Tapped,
  };

  const newCharacters = { ...player.characters, [charId as string]: updatedChar };
  const newPlayers = clonePlayers(state);
  newPlayers[playerIndex] = { ...player, hand: newHand, characters: newCharacters };

  const newState: GameState = { ...state, players: newPlayers };

  // Initiate chain — faction card is held by the chain entry, opponent gets priority
  const cardInstance: CardInstance = { instanceId: handCard.instanceId, definitionId: handCard.definitionId };
  const chainState = initiateChain(newState, action.player, cardInstance, {
    type: 'influence-attempt',
    influencingCharacterId: charId,
  });

  return { state: chainState };
}

/**
 * Resolve a faction influence attempt from the chain of effects.
 *
 * Called by the chain resolver when an `influence-attempt` entry resolves.
 * Calculates modifiers using the current game state (which includes any
 * effects from on-guard cards revealed during the chain), rolls 2d6,
 * and places the faction in cardsInPlay (success) or discard (failure).
 */
export function resolveInfluenceAttemptRoll(
  state: GameState,
  entry: { readonly card: CardInstance | null; readonly declaredBy: import('../index.js').PlayerId; readonly payload: { readonly type: 'influence-attempt'; readonly influencingCharacterId: CardInstanceId } },
): { state: GameState; effects: GameEffect[] } {
  const siteState = state.phaseState as SitePhaseState;
  const playerIndex = getPlayerIndex(state, entry.declaredBy);
  const player = state.players[playerIndex];

  if (!entry.card) return { state, effects: [] };

  const def = state.cardPool[entry.card.definitionId as string];
  if (!def || !isFactionCard(def)) return { state, effects: [] };

  const charId = entry.payload.influencingCharacterId;
  const charInPlay = player.characters[charId as string];
  if (!charInPlay) return { state, effects: [] };

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = charDef?.name ?? charId;

  // Calculate influence modifier using current state (post-on-guard effects)
  let modifier = 0;
  if (charDef && isCharacterCard(charDef)) {
    modifier += charDef.directInfluence;

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

    const charEffects = collectCharacterEffects(state, charInPlay, resolverCtx);

    if (def.effects) {
      for (const effect of def.effects) {
        if (effect.when && !matchesCondition(effect.when, resolverCtx as unknown as Record<string, unknown>)) continue;
        charEffects.push({ effect, sourceDef: def, sourceInstance: entry.card.instanceId });
      }
    }

    const dslModifier = resolveCheckModifier(charEffects, 'influence');
    if (dslModifier !== 0) {
      logDetail(`DSL influence check-modifiers: ${dslModifier >= 0 ? '+' : ''}${dslModifier}`);
    }
    modifier += dslModifier;

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

  const company = player.companies[siteState.activeCompanyIndex];
  const siteInPlay = company.currentSite;

  const newPlayers = clonePlayers(state);

  // Tap the site
  const newCompanies = [...player.companies];
  newCompanies[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: siteInPlay ? { ...siteInPlay, status: CardStatus.Tapped } : siteInPlay,
  };

  newPlayers[playerIndex] = { ...player, ...newPlayers[playerIndex], companies: newCompanies, lastDiceRoll: roll };

  if (total >= influenceNumber) {
    logDetail(`Influence attempt succeeded (${total} >= ${influenceNumber})`);
    const newCardsInPlay = [...player.cardsInPlay, { instanceId: entry.card.instanceId, definitionId: entry.card.definitionId, status: CardStatus.Untapped }];
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], cardsInPlay: newCardsInPlay };

    return {
      state: {
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: { ...siteState, resourcePlayed: true },
      },
      effects: [rollEffect],
    };
  }

  logDetail(`Influence attempt failed (${total} < ${influenceNumber})`);
  const newDiscard = [...player.discardPile, entry.card];
  newPlayers[playerIndex] = { ...newPlayers[playerIndex], discardPile: newDiscard };

  return {
    state: {
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
      phaseState: { ...siteState, resourcePlayed: true },
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

  const charId = action.influencingCharacterId;
  const charInPlay = player.characters[charId as string];

  const opponentIndex = 1 - playerIndex;
  const opponent = state.players[opponentIndex];

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

  // Enqueue a pending opponent-influence-defend resolution for the
  // hazard player. The unified pending system replaces the old
  // `pendingOpponentInfluence` field.
  const stateAfterAttempt: GameState = {
    ...state,
    players: newPlayers,
    rng, cheatRollTotal,
    phaseState: {
      ...siteState,
      opponentInteractionThisTurn: 'influence',
    },
  };

  return {
    state: enqueueResolution(stateAfterAttempt, {
      source: charId,
      actor: opponent.id,
      scope: { kind: 'phase-step', phase: Phase.Site, step: 'play-resources' },
      kind: {
        type: 'opponent-influence-defend',
        attempt: {
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
    }),
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
 * Resolve an opponent influence attempt: roll the defender's 2d6, compute
 * the final result, and apply the consequences (discard the target on
 * success, discard the revealed card on failure).
 *
 * Exported so the unified pending-resolution dispatcher in
 * `pending-reducers.ts` can drive this from a queued
 * `opponent-influence-defend` resolution. The legacy
 * `handleOpponentInfluenceDefend` wrapper is gone — `applyResolution`
 * now reads the attempt from the `PendingResolution` payload and calls
 * this function directly.
 *
 * CoE rules 10.12 steps 2–6.
 */
export function resolveOpponentInfluenceDefend(
  state: GameState,
  attempt: import('../types/pending.js').OpponentInfluenceAttempt,
): ReducerResult {
  // Roll defender 2d6
  const { roll, rng, cheatRollTotal } = roll2d6(state);
  const defenderRoll = roll.die1 + roll.die2;

  const playerIndex = getPlayerIndex(state, state.activePlayer!);
  const opponentIndex = 1 - playerIndex;
  const opponent = state.players[opponentIndex];

  const rollEffect: GameEffect = {
    effect: 'dice-roll',
    playerName: opponent.name,
    die1: roll.die1,
    die2: roll.die2,
    label: `Opponent influence: defense`,
  };

  // Calculate final result:
  // attacker roll + influencer DI - opponent GI - defender roll - controller DI
  const finalResult = attempt.attackerRoll + attempt.influencerDI - attempt.opponentGI - defenderRoll - attempt.controllerDI;

  logDetail(`Opponent influence resolution: ${attempt.attackerRoll} + ${attempt.influencerDI} - ${attempt.opponentGI} - ${defenderRoll} - ${attempt.controllerDI} = ${finalResult} vs mind ${attempt.targetMind}`);

  const newPlayers = clonePlayers(state);

  if (finalResult > attempt.targetMind) {
    // Success — discard target and controlled non-follower cards
    logDetail(`Opponent influence succeeded (${finalResult} > ${attempt.targetMind})`);
    discardInfluencedCard(newPlayers, opponentIndex, attempt, state);

    return {
      state: cleanupEmptyCompanies({
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
      }),
      effects: [rollEffect],
    };
  }

  // Failure — influencer was already tapped; revealed card goes to discard
  logDetail(`Opponent influence failed (${finalResult} <= ${attempt.targetMind})`);

  // If an identical card was revealed, discard it
  if (attempt.revealedCard) {
    const attackerIndex = getPlayerIndex(state, state.activePlayer!);
    const attacker = newPlayers[attackerIndex];
    newPlayers[attackerIndex] = {
      ...attacker,
      discardPile: [...attacker.discardPile, { instanceId: attempt.revealedCard.instanceId, definitionId: attempt.revealedCard.definitionId }],
    };
    logDetail(`Revealed card ${attempt.revealedCard.instanceId as string} discarded after failed influence`);
  }

  return {
    state: {
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
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
  pending: import('../types/pending.js').OpponentInfluenceAttempt,
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



// handleWoundCorruptionCheck removed: wound corruption checks are
// now handled by `applyCorruptionCheckResolution` in
// `engine/pending-reducers.ts`.

function advanceSiteToNextCompany(
  state: GameState,
  siteState: SitePhaseState,
  handledCompanyId: CompanyId,
): ReducerResult {
  const updatedHandled = [...siteState.handledCompanyIds, handledCompanyId];

  // Sweep any active constraints / pending resolutions scoped to the
  // company that just finished its site sub-phase.
  const sweptState = sweepExpired(state, { kind: 'company-site-end', companyId: handledCompanyId });

  const playerIndex = getPlayerIndex(sweptState, sweptState.activePlayer!);
  const remainingCount = sweptState.players[playerIndex].companies.length - updatedHandled.length;

  if (remainingCount <= 0) {
    logDetail(`Site: all companies handled → advancing to End-of-Turn phase`);
    // Return remaining on-guard cards to hazard player's hand
    const cleanedState = returnOnGuardCardsToHand(sweptState);
    return {
      state: cleanupEmptyCompanies({
        ...cleanedState,
        phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const, resetHandDone: [false, false] as const },
      }),
    };
  }

  logDetail(`Site: company ${handledCompanyId} done → returning to select-company (${remainingCount} remaining)`);
  return {
    state: {
      ...sweptState,
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

