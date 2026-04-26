/**
 * @module reducer-site
 *
 * Site phase handlers for the game reducer. Covers company selection at sites,
 * entering sites, automatic attacks, on-guard reveals, resource play,
 * influence attempts, and site phase advancement.
 */

import type { GameState, PlayerState, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, SitePhaseState, CombatState, OnGuardCard, GameAction, GameEffect } from '../index.js';
import { Phase, CardStatus, isCharacterCard, isItemCard, isAllyCard, isFactionCard, isSiteCard, getPlayerIndex, GENERAL_INFLUENCE, Race } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { collectCharacterEffects, collectCompanyAllyEffects, resolveCheckModifier, resolveStatModifiers, resolveAttackProwess, resolveAttackStrikes, normalizeCreatureRace, applyWardToBearer } from './effects/index.js';
import type { ResolverContext } from './effects/index.js';
import { matchesCondition } from '../effects/index.js';
import { initiateChain } from './chain-reducer.js';
import { availableDI } from './legal-actions/organization.js';
import { crossAlignmentInfluencePenalty } from '../alignment-rules.js';
import type { ReducerResult } from './reducer-utils.js';
import { roll2d6, clonePlayers, cleanupEmptyCompanies, updatePlayer, wrongActionType } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { handleGrantActionApply } from './reducer-organization.js';
import { buildInPlayNames, buildControllerInPlayNames, buildFactionPlayableAt } from './recompute-derived.js';
import { sweepExpired, enqueueResolution, removeConstraint, enqueueCorruptionCheck } from './pending.js';
import { resolveEffective } from './effective.js';
import { getActiveAutoAttacks, isReduceAttacksToOneInPlay } from './manifestations.js';
import { isDetainmentAttack } from './detainment.js';


/**
 * Handle all actions during the site phase.
 *
 * The phase begins with the 'select-company' step where the resource player
 * picks which company to handle next. After all companies are handled, the
 * phase advances to the End-of-Turn phase.
 */
type SiteHandler = (state: GameState, action: GameAction, siteState: SitePhaseState) => ReducerResult;

/**
 * Per-step dispatch for the Site phase. Pending wound corruption checks
 * (Barrow-downs et al.) are intercepted by the unified pending-resolution
 * dispatcher before this table is consulted. Opponent-influence-defend and
 * on-guard-window are likewise produced and consumed through the unified
 * dispatcher.
 */
const SITE_STEP_HANDLERS: Readonly<Partial<Record<SitePhaseState['step'], SiteHandler>>> = {
  'select-company': handleSiteSelectCompany,
  'enter-or-skip': handleSiteEnterOrSkip,
  'reveal-on-guard-attacks': handleRevealOnGuardAttacks,
  'forewarned-select-attack': handleForewarnedSelectAttack,
  'play-site-auto-attack': handleSitePlaySiteAutoAttack,
  'automatic-attacks': handleSiteAutomaticAttacks,
  'declare-agent-attack': (state, action, siteState) =>
    handleSitePassStep(state, action, siteState, 'declare-agent-attack', 'resolve-attacks', true),
  'resolve-attacks': handleSiteResolveAttacks,
  'play-resources': handleSitePlayResources,
  // TODO: play-minor-item
};

export function handleSite(state: GameState, action: GameAction): ReducerResult {
  const siteState = state.phaseState as SitePhaseState;
  const handler = SITE_STEP_HANDLERS[siteState.step];
  if (handler) return handler(state, action, siteState);

  if (action.type !== 'pass') {
    return { state, error: `Unexpected action '${action.type}' in site phase step '${siteState.step}'` };
  }

  logDetail(`Site: active player ${action.player as string} passed → advancing to End-of-Turn phase`);
  const withChecks = fireEndOfTurnCorruptionChecks(state);
  return {
    state: {
      ...withChecks,
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
    return wrongActionType(state, action, 'select-company', 'select-company step');
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
  const autoAttackCount = siteDef && isSiteCard(siteDef)
    ? getActiveAutoAttacks(state, siteDef).length
    : 0;

  const skipAutoAttacks = siteInPlay && state.activeConstraints.some(c =>
    c.kind.type === 'skip-automatic-attacks'
    && c.kind.siteDefinitionId === siteInPlay.definitionId,
  );
  if (skipAutoAttacks) {
    logDetail(`Site: automatic-attacks skipped by skip-automatic-attacks constraint`);
  }

  const hasDynamicAutoAttack = !skipAutoAttacks && siteDef && isSiteCard(siteDef)
    && (siteDef.effects?.some(e => e.type === 'site-rule' && e.rule === 'dynamic-auto-attack') ?? false);

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

  if (hasDynamicAutoAttack) {
    logDetail(`Site: company ${company.id} enters site with dynamic auto-attack effect → advancing to play-site-auto-attack`);
    return {
      state: {
        ...state,
        phaseState: {
          ...siteState,
          step: 'play-site-auto-attack' as const,
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
  // Pass: advance to play-site-auto-attack (if dynamic) or forewarned-select-attack
  // (if Forewarned Is Forearmed is in play and site has >1 attacks) or automatic-attacks.
  if (action.type === 'pass') {
    const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
    const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
    const siteDef = company?.currentSite
      ? state.cardPool[company.currentSite.definitionId as string]
      : undefined;
    const hasDynamicAutoAttack = siteDef && isSiteCard(siteDef)
      && (siteDef.effects?.some(e => e.type === 'site-rule' && e.rule === 'dynamic-auto-attack') ?? false);
    let nextStep: SitePhaseState['step'];
    if (hasDynamicAutoAttack) {
      nextStep = 'play-site-auto-attack';
    } else if (
      !hasDynamicAutoAttack
      && siteDef && isSiteCard(siteDef)
      && !(siteDef as { lairOf?: unknown }).lairOf
      && isReduceAttacksToOneInPlay(state)
      && getActiveAutoAttacks(state, siteDef).length > 1
    ) {
      nextStep = 'forewarned-select-attack';
    } else {
      nextStep = 'automatic-attacks';
    }
    logDetail(`Site: reveal-on-guard-attacks → advancing to ${nextStep}`);
    return {
      state: {
        ...state,
        phaseState: { ...siteState, step: nextStep },
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

    return { state: updatePlayer(state, activeIndex, p => ({ ...p, companies: newCompanies })) };
  }

  return { state, error: `Unexpected action '${action.type}' during reveal-on-guard-attacks step` };
}

/**
 * Handle the 'forewarned-select-attack' step: hazard player selects which
 * automatic attack to retain when *Forewarned Is Forearmed* is in play and
 * the site has more than one automatic attack.
 *
 * Only `select-forewarned-attack` from the hazard player is legal here.
 * After selection, `selectedAutoAttackIndex` is stored and the step advances
 * to `automatic-attacks`.
 */
function handleForewarnedSelectAttack(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'select-forewarned-attack') {
    return { state, error: `Expected 'select-forewarned-attack' during forewarned-select-attack step, got '${action.type}'` };
  }
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  const siteDef = company?.currentSite
    ? state.cardPool[company.currentSite.definitionId as string]
    : undefined;
  const autoAttacks = siteDef && isSiteCard(siteDef)
    ? getActiveAutoAttacks(state, siteDef)
    : [];
  if (action.attackIndex < 0 || action.attackIndex >= autoAttacks.length) {
    return { state, error: `Invalid attackIndex ${action.attackIndex} for forewarned-select-attack` };
  }
  logDetail(`Forewarned Is Forearmed: hazard player selected attack ${action.attackIndex} (${autoAttacks[action.attackIndex].creatureType})`);
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'automatic-attacks' as const,
        selectedAutoAttackIndex: action.attackIndex,
      },
    },
  };
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
  const autoAttacks = getActiveAutoAttacks(state, siteDef);

  // When Forewarned Is Forearmed selected a single attack, only that attack
  // is resolved; consider done after 1 attack (not after all autoAttacks.length).
  const forewarnedIdx = siteState.selectedAutoAttackIndex;
  const allAttacksDone = forewarnedIdx !== undefined
    ? attackIndex >= 1
    : attackIndex >= autoAttacks.length;

  if (allAttacksDone) {
    // Check for auto-attack-race-duplicate effects from permanent events in play
    // (The Moon Is Dead). Each Undead auto-attack at the site must be faced
    // a second time. duplicatesRun = attackIndex - autoAttacks.length counts
    // how many race-based duplicates have already been initiated this site phase.
    const raceDupRaces = new Set<string>();
    for (const player of state.players) {
      for (const card of player.cardsInPlay) {
        const def = state.cardPool[card.definitionId as string];
        if (!def || !('effects' in def) || !def.effects) continue;
        for (const effect of def.effects) {
          if (effect.type === 'auto-attack-race-duplicate') {
            raceDupRaces.add(effect.race.toLowerCase());
          }
        }
      }
    }
    if (raceDupRaces.size > 0) {
      const duplicatableAttacks = autoAttacks.filter(aa =>
        raceDupRaces.has(normalizeCreatureRace(aa.creatureType)),
      );
      const duplicatesRun = attackIndex - autoAttacks.length;
      if (duplicatesRun < duplicatableAttacks.length) {
        const aa = duplicatableAttacks[duplicatesRun];
        const dupRace = normalizeCreatureRace(aa.creatureType);
        const inPlayNamesR = buildInPlayNames(state);
        const dupProwessR = resolveAttackProwess(state, aa.prowess, inPlayNamesR, dupRace, true);
        const dupStrikesR = resolveAttackStrikes(state, aa.strikes, inPlayNamesR, dupRace);
        logDetail(`Site: duplicating ${aa.creatureType} auto-attack (The Moon Is Dead): ${dupStrikesR} strikes, ${dupProwessR} prowess`);
        const dupDetainmentR = isDetainmentAttack({
          attackEffects: siteDef.effects,
          attackRace: dupRace as Race | null,
          defendingAlignment: state.players[activePlayerIndex].alignment,
          defendingSiteEffects: siteDef.effects,
        });
        const dupCombatR: CombatState = {
          attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: attackIndex },
          companyId: company.id,
          defendingPlayerId: state.activePlayer!,
          attackingPlayerId: state.players.find(p => p.id !== state.activePlayer)!.id,
          strikesTotal: dupStrikesR,
          strikeProwess: dupProwessR,
          creatureBody: null,
          creatureRace: dupRace,
          strikeAssignments: [],
          currentStrikeIndex: 0,
          phase: 'assign-strikes',
          assignmentPhase: 'defender',
          bodyCheckTarget: null,
          detainment: dupDetainmentR,
        };
        return {
          state: {
            ...state,
            combat: dupCombatR,
            phaseState: { ...siteState, automaticAttacksResolved: attackIndex + 1 },
          },
        };
      }
    }

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
      const dupProwess = resolveAttackProwess(state, aa.prowess, inPlayNames2, creatureRace2, true, undefined, { companyId: company.id });
      const dupStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames2, creatureRace2, { companyId: company.id });
      logDetail(`Site: initiating duplicate automatic attack (Incite Defenders): ${aa.creatureType} (${dupStrikes} strikes, ${dupProwess} prowess)`);
      const dupState = removeConstraint(state, dupConstraint.id);
      const dupDetainment = isDetainmentAttack({
        attackEffects: siteDef.effects,
        attackRace: creatureRace2 as Race | null,
        defendingAlignment: state.players[activePlayerIndex].alignment,
        defendingSiteEffects: siteDef.effects,
      });
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
        detainment: dupDetainment,
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

  // Initiate combat for the next automatic attack (or the Forewarned-selected one)
  const resolvedAttackIndex = forewarnedIdx !== undefined ? forewarnedIdx : attackIndex;
  const aa = autoAttacks[resolvedAttackIndex];
  const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;

  const inPlayNames = buildInPlayNames(state);
  const creatureRace = normalizeCreatureRace(aa.creatureType);
  const baseEffective = resolveAttackProwess(state, aa.prowess, inPlayNames, creatureRace, true, undefined, { companyId: company.id });
  const effectiveStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames, creatureRace, { companyId: company.id });

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
    attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: resolvedAttackIndex },
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
    detainment: isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: creatureRace as Race | null,
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defendingSiteEffects: siteDef.effects,
    }),
    ...(forewarnedIdx !== undefined ? { isolated: true, uncancelable: true } : {}),
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
 * Handle the `play-site-auto-attack` step: hazard player may play one
 * creature from hand as the site's automatic-attack (Framsburg td-175 and
 * any future site with a `site-rule: dynamic-auto-attack` effect). On a
 * play, the creature initiates combat using its own stats; on pass, the
 * window closes without combat. Either way, the step advances to
 * `automatic-attacks` (which passes through for sites without static
 * auto-attacks).
 */
function handleSitePlaySiteAutoAttack(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  const siteDef = company?.currentSite
    ? state.cardPool[company.currentSite.definitionId as string]
    : undefined;

  if (action.type === 'pass') {
    logDetail(`Site: play-site-auto-attack → advancing to automatic-attacks (pass)`);
    return {
      state: {
        ...state,
        phaseState: { ...siteState, step: 'automatic-attacks' as const },
      },
    };
  }

  if (action.type !== 'play-site-auto-attack') {
    return { state, error: `Expected 'play-site-auto-attack' or 'pass' during play-site-auto-attack step, got '${action.type}'` };
  }

  const hazardPlayerId = action.player;
  const hazardIndex = getPlayerIndex(state, hazardPlayerId);
  const hazardPlayer = state.players[hazardIndex];
  const creatureIdx = hazardPlayer.hand.findIndex(c => c.instanceId === action.cardInstanceId);
  if (creatureIdx === -1) {
    return { state, error: `Card ${action.cardInstanceId} not in hazard player's hand` };
  }
  const creatureCard = hazardPlayer.hand[creatureIdx];
  const creatureDef = state.cardPool[creatureCard.definitionId as string];
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') {
    return { state, error: `Card ${action.cardInstanceId} is not a hazard creature` };
  }

  // Remove creature from hand, move to hazard player's cardsInPlay for
  // the duration of combat (finalizeCombat routes it to discard).
  const newHand = hazardPlayer.hand.filter((_, i) => i !== creatureIdx);
  const stateAfterMove = updatePlayer(state, hazardIndex, p => ({
    ...p,
    hand: newHand,
    cardsInPlay: [...p.cardsInPlay, {
      instanceId: creatureCard.instanceId,
      definitionId: creatureCard.definitionId,
      status: CardStatus.Untapped,
    }],
  }));

  const inPlayNames = buildInPlayNames(state);
  const creatureRace = creatureDef.race;
  const sitePlayedBoostCtx = { companyId: company.id, creatureInstanceId: creatureCard.instanceId };
  const effectiveProwess = resolveAttackProwess(state, creatureDef.prowess, inPlayNames, creatureRace, false, undefined, sitePlayedBoostCtx);
  const effectiveStrikes = resolveAttackStrikes(state, creatureDef.strikes, inPlayNames, creatureRace, sitePlayedBoostCtx);

  logDetail(`Site: hazard plays "${creatureDef.name}" as dynamic auto-attack (${effectiveStrikes} strikes, ${effectiveProwess} prowess) vs company ${company.id as string}`);

  const combat: CombatState = {
    attackSource: {
      type: 'played-auto-attack',
      instanceId: creatureCard.instanceId,
      siteInstanceId: company.currentSite!.instanceId,
    },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: creatureDef.body,
    creatureRace,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: isDetainmentAttack({
      attackEffects: creatureDef.effects,
      attackRace: creatureRace as Race | null,
      attackKeyedTo: creatureDef.keyedTo,
      inPlayNames,
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defendingSiteEffects: siteDef && isSiteCard(siteDef) ? siteDef.effects : undefined,
    }),
  };

  return {
    state: {
      ...stateAfterMove,
      combat,
      phaseState: { ...siteState, step: 'automatic-attacks' as const },
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

      // Initiate chain with CardInstance
      const hazardPlayerId = state.players.find(p => p.id !== state.activePlayer)!.id;
      const cardInstance: CardInstance = { instanceId: attackCard.instanceId, definitionId: attackCard.definitionId };
      let newState: GameState = updatePlayer(state, activePlayerIndex, p => ({ ...p, companies: newCompanies }));
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

  let newState: GameState = updatePlayer(state, activeIndex, p => ({ ...p, companies: newCompanies }));

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
  if (deferredAction.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, deferredAction);
  }
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
  //
  // On-guard intercept: when a scout-skill resource short (i.e. the card
  // has a `requiredSkill` tag on any effect) is about to be played and
  // on-guard cards exist on the company's site, pause for the hazard
  // player to reveal. Mirrors the play-hero-resource intercept below.
  // Used by Searching Eye (reveals from on-guard to cancel a scout-skill
  // card during the opponent's site phase).
  if (action.type === 'play-short-event' && company.onGuardCards.length > 0) {
    const handCard = player.hand.find(c => c.instanceId === action.cardInstanceId);
    const shortDef = handCard ? state.cardPool[handCard.definitionId as string] : undefined;
    const shortEffects = shortDef && 'effects' in shortDef
      ? ((shortDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects ?? [])
      : [];
    const hasRequiredSkill = shortEffects.some(
      e => typeof (e as { requiredSkill?: string }).requiredSkill === 'string',
    );
    if (hasRequiredSkill) {
      logDetail(`Site: short-event "${shortDef?.name ?? handCard?.definitionId}" intercepted — enqueuing on-guard-window resolution`);
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
  }
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

  // Rule 2.1.1: any-phase grant-actions (Cram, Orc-draughts). The
  // legal-action emitter only offers activations flagged
  // `anyPhase: true` during site phase, so we can delegate unconditionally.
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }

  return { state, error: `Unexpected action '${action.type}' in play-resources step` };
}

/**
 * Returns `true` when the given site definition carries the `never-taps`
 * site-rule. Used to skip the otherwise-automatic site tap on resource
 * play and influence-attempt resolution (e.g. The Worthy Hills / le-415).
 */
function siteNeverTaps(
  state: GameState,
  site: { readonly definitionId: import('../index.js').CardDefinitionId } | null | undefined,
): boolean {
  if (!site) return false;
  const def = state.cardPool[site.definitionId as string];
  if (!def || !isSiteCard(def)) return false;
  return (def.effects ?? []).some(
    e => e.type === 'site-rule' && e.rule === 'never-taps',
  );
}

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
  if (action.type !== 'play-hero-resource') return wrongActionType(state, action, 'play-hero-resource');

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

  // Tap the site by updating company's currentSite status, unless the
  // site carries the `never-taps` site-rule (e.g. The Worthy Hills).
  const neverTaps = siteNeverTaps(state, siteInPlay);
  if (neverTaps) {
    logDetail(`Site: ${def.name}'s site has never-taps — leaving site untapped`);
  }
  const newCompanies = [...player.companies];
  newCompanies[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: neverTaps ? siteInPlay : { ...siteInPlay, status: CardStatus.Tapped },
  };

  // Rule 2.V.5: when a resource that taps the site is successfully played,
  // the resource player may attempt one additional minor item as the next
  // action. A `never-taps` site never triggers the bonus. The bonus is
  // consumed when the subsequent minor-item play arrives.
  const openingBonus = !siteState.resourcePlayed && !neverTaps;
  const consumingBonus = siteState.resourcePlayed && siteState.minorItemAvailable;
  const nextMinorItemAvailable = openingBonus
    ? true
    : consumingBonus
      ? false
      : siteState.minorItemAvailable;

  let afterAttach: GameState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand, characters: newCharacters, companies: newCompanies })),
    phaseState: {
      ...siteState,
      resourcePlayed: true,
      minorItemAvailable: nextMinorItemAvailable,
    },
  };

  // Apply ward-bearer effects declared by the incoming card: any hazard
  // on the bearer that matches the ward filter is immediately discarded
  // (e.g. Adamant Helmet cancelling dark enchantments on its wearer).
  if (isItem) {
    afterAttach = applyWardToBearer(afterAttach, playerIndex, targetCharId, def, action.cardInstanceId);
    afterAttach = fireCharacterGainsItemChecks(afterAttach, playerIndex, siteState.activeCompanyIndex);
  }

  return { state: afterAttach };
}

/**
 * Fire `on-event: character-gains-item` corruption checks for all characters
 * in the active company that bear a hazard declaring this event. Called after
 * an item is successfully attached to any company member during site phase.
 * The check is enqueued for the hazard bearer, not the character who gained
 * the item — matching the card text "makes a corruption check each time a
 * character in his company gains an item."
 */
function fireCharacterGainsItemChecks(
  state: GameState,
  playerIndex: number,
  companyIndex: number,
): GameState {
  const player = state.players[playerIndex];
  const company = player.companies[companyIndex];
  let newState = state;

  for (const charId of company.characters) {
    const char = player.characters[charId as string];
    if (!char) continue;
    for (const hazard of char.hazards) {
      const hDef = newState.cardPool[hazard.definitionId as string];
      if (!hDef || !('effects' in hDef) || !hDef.effects) continue;
      for (const effect of hDef.effects) {
        if (effect.type !== 'on-event') continue;
        if (effect.event !== 'character-gains-item') continue;
        if (effect.apply.type !== 'force-check' || effect.apply.check !== 'corruption') continue;

        logDetail(`character-gains-item: "${hDef.name}" triggers corruption check for character ${charId as string}`);
        const possessions = [
          ...char.items.map(i => i.instanceId),
          ...char.allies.map(a => a.instanceId),
          ...char.hazards.map(h => h.instanceId),
        ];
        newState = enqueueCorruptionCheck(newState, {
          source: hazard.instanceId,
          actor: player.id,
          scope: { kind: 'phase', phase: Phase.Site },
          characterId: charId,
          reason: `${hDef.name} (item gained)`,
          possessions,
        });
      }
    }
  }
  return newState;
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
  if (action.type !== 'influence-attempt') return wrongActionType(state, action, 'influence-attempt');

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

  const newState: GameState = updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand, characters: newCharacters }));

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
        playableAt: buildFactionPlayableAt(def),
      },
      controller: { inPlay: buildControllerInPlayNames(state, entry.declaredBy) },
    };

    const charEffects = collectCharacterEffects(state, charInPlay, resolverCtx);
    charEffects.push(...collectCompanyAllyEffects(state, charInPlay, resolverCtx));

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

    // One-shot check-modifier constraints for influence (e.g. Muster): consume after use
    const consumedConstraintIds: string[] = [];
    for (const constraint of state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'influence') continue;
      if (constraint.target.kind !== 'character') continue;
      if (constraint.target.characterId !== charId) continue;
      modifier += constraint.kind.value;
      consumedConstraintIds.push(constraint.id as string);
      logDetail(`Influence one-shot constraint ${constraint.kind.value >= 0 ? '+' : ''}${constraint.kind.value} from ${constraint.sourceDefinitionId as string} (consumed)`);
    }
    if (consumedConstraintIds.length > 0) {
      state = { ...state, activeConstraints: state.activeConstraints.filter(c => !consumedConstraintIds.includes(c.id as string)) };
    }
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

  // Tap the site, unless it carries the `never-taps` site-rule
  // (e.g. The Worthy Hills — influence attempts there do not tap the site).
  const neverTaps = siteNeverTaps(state, siteInPlay);
  if (neverTaps) {
    logDetail(`Site: influence at ${def.name} — site has never-taps, leaving site untapped`);
  }
  const newCompanies = [...player.companies];
  newCompanies[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: siteInPlay && !neverTaps ? { ...siteInPlay, status: CardStatus.Tapped } : siteInPlay,
  };

  newPlayers[playerIndex] = { ...player, ...newPlayers[playerIndex], companies: newCompanies, lastDiceRoll: roll };

  if (total >= influenceNumber) {
    logDetail(`Influence attempt succeeded (${total} >= ${influenceNumber})`);
    const newCardsInPlay = [...player.cardsInPlay, { instanceId: entry.card.instanceId, definitionId: entry.card.definitionId, status: CardStatus.Untapped }];
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], cardsInPlay: newCardsInPlay };

    // Rule 2.V.5: a successful resource that taps the site opens the
    // additional-minor-item window.
    const openMinorItemBonus = !siteState.resourcePlayed && !neverTaps;

    return {
      state: {
        ...state,
        players: newPlayers,
        rng, cheatRollTotal,
        phaseState: {
          ...siteState,
          resourcePlayed: true,
          minorItemAvailable: openMinorItemBonus ? true : siteState.minorItemAvailable,
        },
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
  if (action.type !== 'opponent-influence-attempt') return wrongActionType(state, action, 'opponent-influence-attempt');

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
  } else if (action.targetKind === 'faction') {
    const targetFaction = opponent.cardsInPlay.find(c => c.instanceId === action.targetInstanceId);
    if (!targetFaction) return { state, error: 'Target faction not found' };
    const factionDef = state.cardPool[targetFaction.definitionId as string];
    if (!factionDef || !isFactionCard(factionDef)) return { state, error: 'Target is not a faction' };
    // CoE rule 8.3: the comparison value is the in-play influence number.
    // No controller DI for factions (factions are controlled by the player,
    // not a character).
    targetMind = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;
    controllerDI = 0;
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
    } else if (action.targetKind === 'faction') {
      const targetFaction = opponent.cardsInPlay.find(c => c.instanceId === action.targetInstanceId);
      const tDef = targetFaction ? state.cardPool[targetFaction.definitionId as string] : undefined;
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
  const stateAfterTap = updatePlayer(state, playerIndex, p => ({
    ...p,
    hand: newHand,
    characters: { ...p.characters, [charId as string]: updatedChar },
  }));

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
  // CoE rules 8.W1, 8.R1, 8.F1, 8.B1: cross-alignment influence penalty.
  const crossAlignmentPenalty = crossAlignmentInfluencePenalty(player.alignment, opponent.alignment);

  logDetail(`Opponent influence attempt: ${charName} rolls ${roll.die1} + ${roll.die2} = ${attackerRoll} (DI: ${influencerDI}, opponent GI: ${opponentGI}, target mind: ${effectiveTargetMind}${revealedCard ? ' [revealed]' : ''}, controller DI: ${controllerDI}, cross-alignment penalty: ${crossAlignmentPenalty})`);

  // Enqueue a pending opponent-influence-defend resolution for the
  // hazard player. The unified pending system replaces the old
  // `pendingOpponentInfluence` field.
  const stateAfterAttempt: GameState = {
    ...stateAfterTap,
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
          crossAlignmentPenalty,
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
  // attacker roll + influencer DI - opponent GI - defender roll
  //   - controller DI + cross-alignment penalty (non-positive; 0 or -5)
  const finalResult = attempt.attackerRoll + attempt.influencerDI - attempt.opponentGI - defenderRoll - attempt.controllerDI + attempt.crossAlignmentPenalty;

  logDetail(`Opponent influence resolution: ${attempt.attackerRoll} + ${attempt.influencerDI} - ${attempt.opponentGI} - ${defenderRoll} - ${attempt.controllerDI} + ${attempt.crossAlignmentPenalty} (cross-alignment) = ${finalResult} vs mind ${attempt.targetMind}`);

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

  if (pending.targetKind === 'faction') {
    // Remove the faction from cardsInPlay and move it to the discard pile.
    // CoE rule 8.3 last paragraph: on a successful influence check, "the
    // card being influenced is immediately discarded along with any
    // non-follower cards that it controlled". Factions do not control
    // other cards so only the faction itself is discarded.
    const factionIdx = opponent.cardsInPlay.findIndex(c => c.instanceId === pending.targetInstanceId);
    if (factionIdx === -1) return;
    const faction = opponent.cardsInPlay[factionIdx];
    const newCardsInPlay = [...opponent.cardsInPlay];
    newCardsInPlay.splice(factionIdx, 1);
    const newDiscard = [...opponent.discardPile, { instanceId: faction.instanceId, definitionId: faction.definitionId }];
    players[opponentIndex] = { ...opponent, cardsInPlay: newCardsInPlay, discardPile: newDiscard };
    logDetail(`Discarded faction ${faction.instanceId as string}`);
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
    return wrongActionType(state, action, 'pass', `${currentStep} step`);
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

/**
 * Scans the active player's characters for attached hazards with
 * `on-event: end-of-turn` + `apply.type: force-check-per-others-item`.
 * For each match, enqueues one corruption-check pending resolution per
 * item in the bearer's company that the bearer does NOT bear. The modifier
 * for each check is the negative corruption-point value of that item.
 * Used by *Covetous Thoughts* (le-107).
 */
function fireEndOfTurnCorruptionChecks(state: GameState): GameState {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIndex];

  let newState = state;
  for (const company of resourcePlayer.companies) {
    for (const charId of company.characters) {
      const bearer = resourcePlayer.characters[charId as string];
      if (!bearer) continue;
      for (const hazard of bearer.hazards) {
        const hDef = newState.cardPool[hazard.definitionId as string];
        if (!hDef || !('effects' in hDef) || !hDef.effects) continue;
        for (const effect of hDef.effects) {
          if (effect.type !== 'on-event') continue;
          if (effect.event !== 'end-of-turn') continue;
          if (effect.apply.type !== 'force-check-per-others-item') continue;
          if (effect.apply.check !== 'corruption') continue;

          const otherItems = company.characters
            .filter(oid => oid !== charId)
            .flatMap(oid => resourcePlayer.characters[oid as string]?.items ?? []);

          if (otherItems.length === 0) {
            logDetail(`end-of-turn: "${hDef.name}" on ${charId as string} — no other-company items, skipping`);
            continue;
          }

          logDetail(`end-of-turn: "${hDef.name}" on ${charId as string} — ${otherItems.length} other-company item(s)`);
          const possessions = [
            ...bearer.items.map(i => i.instanceId),
            ...bearer.allies.map(a => a.instanceId),
            ...bearer.hazards.map(h => h.instanceId),
          ];
          for (const item of otherItems) {
            const itemDef = newState.cardPool[item.definitionId as string];
            const cp = isItemCard(itemDef) ? itemDef.corruptionPoints : 0;
            const modifier = cp > 0 ? -cp : 0;
            logDetail(`end-of-turn: enqueuing check for ${charId as string} — item "${itemDef?.name ?? item.definitionId as string}" cp=${cp} → modifier ${modifier}`);
            newState = enqueueCorruptionCheck(newState, {
              source: hazard.instanceId,
              actor: state.activePlayer!,
              scope: { kind: 'phase', phase: Phase.EndOfTurn },
              characterId: charId,
              modifier,
              reason: `${hDef.name} (${itemDef?.name ?? item.definitionId as string})`,
              possessions,
            });
          }
        }
      }
    }
  }
  return newState;
}

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
    const withChecks = fireEndOfTurnCorruptionChecks(cleanedState);
    return {
      state: cleanupEmptyCompanies({
        ...withChecks,
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

