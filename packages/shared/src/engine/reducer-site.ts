/**
 * @module reducer-site
 *
 * Site phase handlers for the game reducer. Covers company selection at sites,
 * entering sites, automatic attacks, on-guard reveals, resource play,
 * influence attempts, and site phase advancement.
 */

import type { GameState, PlayerState, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, SitePhaseState, CombatState, OnGuardCard, GameAction, GameEffect, PlayerId, Company } from '../index.js';
import { Phase, CardStatus, isCharacterCard, isItemCard, isAllyCard, isFactionCard, isSiteCard, getPlayerIndex, Race, Alignment, formatSignedNumber, matchesCondition } from '../index.js';
import { logDetail } from './legal-actions/log.js';
import { buildBearerContext, collectCharacterEffects, collectCompanyAllyEffects, resolveCheckModifier, resolveStatModifiers, resolveAttackProwess, resolveAttackStrikes, resolveAttackBody, normalizeCreatureRace, applyWardToBearer } from './effects/index.js';
import type { ResolverContext } from './effects/index.js';
import { matchesContext } from '../effects/index.js';
import { initiateChain } from './chain-reducer.js';
import { availableDI } from './legal-actions/organization.js';
import { crossAlignmentInfluencePenalty } from '../alignment-rules.js';
import type { ReducerResult } from './reducer-utils.js';
import { cardName, characterEntries, cleanupEmptyCompanies, clonePlayers, defById, diceRollEffect, effectiveGeneralInfluence, findById, findCharacterCompany, getCardEffects, getOnEventEffects, hazardPlayer, playerById, removeById, roll2d6, sweepCompanyMembershipChangedEvents, toCardInstance, updatePlayer, wrongActionType } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayResourceShortEvent } from './reducer-events.js';
import { handleGrantActionApply, goldRingAutoTestModifier, goldRingAutoTestSiteName } from './reducer-organization.js';
import { BARAD_DUR_MINION } from '../card-ids.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { buildInPlayNames, buildControllerInPlayNames, buildFactionPlayableAt } from './recompute-derived.js';
import { sweepExpired, enqueueResolution, removeConstraint, enqueueCorruptionCheck, addConstraint } from './pending.js';
import { resolveEffective } from './effective.js';
import { getActiveAutoAttacks, isReduceAttacksToOneInPlay } from './manifestations.js';
import { isDetainmentAttack } from './detainment.js';
import { moveToFetchToDeckPayload } from './reducer-move.js';
import type { MoveEffect, SitePhaseRingAutoTestSiteRule } from '../types/effects.js';
import type { PendingEffect, StrikeAssignment } from '../types/state-combat.js';


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
  'declare-agent-attack': handleDeclareAgentAttack,
  'resolve-attacks': handleSiteResolveAttacks,
  'play-resources': handleSitePlayResources,
  'declare-company-attack': handleDeclareCompanyAttack,
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
  const withFetch = fireEndOfTurnFetchEffects(state);
  const withChecks = fireEndOfTurnCorruptionChecks(withFetch);
  const withRingTests = fireEndOfTurnGoldRingTests(withChecks);
  return {
    state: {
      ...withRingTests,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard' as const, discardDone: [false, false] as const, resetHandDone: [false, false] as const },
    },
  };
}

/**
 * If the company's current site declares `site-phase-ring-auto-test`,
 * enqueue a `gold-ring-test` pending resolution for every gold-ring item
 * borne by a character in the company. Called at company selection so the
 * tests fire before the enter-or-skip choice — i.e. even if the company
 * never enters the site.
 */
function enqueueSitePhaseRingAutoTests(
  state: GameState,
  actor: PlayerId,
  company: Company,
): GameState {
  if (!company.currentSite) return state;
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  if (!siteDefId) return state;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return state;
  const rule = siteDef.effects.find(
    (e): e is SitePhaseRingAutoTestSiteRule =>
      e.type === 'site-rule' && 'rule' in e && (e as { rule: string }).rule === 'site-phase-ring-auto-test',
  );
  if (!rule) return state;

  const actorPlayer = state.players.find(p => p.id === actor);
  if (!actorPlayer) return state;

  let result = state;
  for (const charInstId of company.characters) {
    const char = actorPlayer.characters[charInstId as string];
    if (!char) continue;
    for (const item of char.items) {
      const itemDef = defById(state, item.definitionId);
      if (!itemDef || !('subtype' in itemDef) || (itemDef as { subtype?: string }).subtype !== 'gold-ring') continue;
      logDetail(`Site-phase ring auto-test: ${itemDef.name} held by ${defById(state, char.definitionId)?.name ?? '?'} at ${siteDef.name} (modifier ${formatSignedNumber(rule.rollModifier)})`);
      result = enqueueResolution(result, {
        source: item.instanceId,
        actor,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: {
          type: 'gold-ring-test',
          goldRingInstanceId: item.instanceId,
          rollModifier: rule.rollModifier,
          characterInstanceId: charInstId,
        },
      });
    }
  }
  return result;
}

/**
 * Fire `site-phase-company-begins` on-event effects for the given company.
 *
 * Scans both players' `cardsInPlay` for global permanent events (no companyId)
 * that declare an `on-event: site-phase-company-begins` effect. The condition
 * is evaluated against a context including:
 *   - `company.siteRegionType` — region type of the site the company is at
 *   - `inPlay` — list of card names currently in play
 *
 * When a match is found (currently only `apply: tap-one-character` is supported),
 * a `tap-one-character` pending resolution is enqueued for the resource player.
 * The player must then tap one untapped character in the company (or pass if none).
 */
function fireSitePhaseCompanyBeginsEvents(
  state: GameState,
  actor: PlayerId,
  company: Company,
): GameState {
  if (!company.currentSite) return state;

  const siteDef = state.cardPool[company.currentSite.definitionId as string];
  if (!siteDef || !isSiteCard(siteDef)) return state;

  // Determine the region type of the company's current site.
  const regionName = siteDef.region;
  let siteRegionType: string | undefined;
  if (regionName) {
    for (const card of Object.values(state.cardPool)) {
      if (card.cardType === 'region' && card.name === regionName) {
        siteRegionType = (card as { regionType: string }).regionType;
        break;
      }
    }
  }

  if (!siteRegionType) return state;

  const inPlayNames = buildInPlayNames(state);
  const ctx: Record<string, unknown> = {
    company: { siteRegionType },
    inPlay: inPlayNames,
  };

  let result = state;
  for (let pi = 0; pi < 2; pi++) {
    const p = result.players[pi];
    for (const card of p.cardsInPlay) {
      // Only global events (no companyId) fire this trigger.
      if (card.companyId) continue;
      const def = result.cardPool[card.definitionId as string];
      for (const e of getCardEffects(def)) {
        if (e.type !== 'on-event') continue;
        if (e.event !== 'site-phase-company-begins') continue;
        if (e.when && !matchesContext(e.when, ctx)) {
          logDetail(`site-phase-company-begins: skipping "${def?.name ?? card.definitionId}" — condition not met (regionType=${siteRegionType})`);
          continue;
        }
        if (e.apply?.type !== 'tap-one-character') continue;
        logDetail(`site-phase-company-begins: "${def?.name ?? card.definitionId}" fires for company ${company.id as string} (regionType=${siteRegionType})`);
        result = enqueueResolution(result, {
          source: card.instanceId,
          actor,
          scope: { kind: 'company-site-subphase', companyId: company.id },
          kind: {
            type: 'tap-one-character',
            companyId: company.id,
            sourceDefinitionId: card.definitionId,
          },
        });
      }
    }
  }

  return result;
}

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

  const player = playerById(state, state.activePlayer)!;
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);
  const company = player.companies[companyIndex];

  logDetail(`Site: selected company ${action.companyId} (index ${companyIndex}) → advancing to enter-or-skip`);
  let nextState: GameState = {
    ...state,
    phaseState: {
      ...siteState,
      step: 'enter-or-skip' as const,
      activeCompanyIndex: companyIndex,
      automaticAttacksResolved: 0,
      siteEntered: false,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
    },
  };

  // site-phase-ring-auto-test: enqueue gold-ring-test resolutions for every
  // borne gold-ring item in the company, before the enter-or-skip decision.
  nextState = enqueueSitePhaseRingAutoTests(nextState, state.activePlayer!, company);

  // site-phase-company-begins: scan all players' cardsInPlay for global
  // permanent events that declare this trigger and enqueue tap-one-character
  // resolutions when conditions match (e.g. Stench of Mordor).
  nextState = fireSitePhaseCompanyBeginsEvents(nextState, state.activePlayer!, company);

  return { state: nextState };
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

  const player = playerById(state, state.activePlayer)!;
  const company = player.companies[siteState.activeCompanyIndex];

  // Pass = do nothing, company's site phase ends immediately
  if (action.type === 'pass') {
    logDetail(`Site: company ${company.id} does nothing → advancing to next company`);
    return advanceSiteToNextCompany(state, siteState, company.id);
  }

  // Enter site — check whether the site has automatic-attacks
  const siteInPlay = company.currentSite;
  const siteDef = siteInPlay ? defById(state, siteInPlay.definitionId) : undefined;
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
      ? defById(state, company.currentSite.definitionId)
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
    const def = defById(state, revealedCard.definitionId);
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
    ? defById(state, company.currentSite.definitionId)
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
function handleSiteAutomaticAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during automatic-attacks step` };
  }

  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
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
    // Check for auto-attack-race-duplicate constraints (The Moon Is Dead).
    // Each matching auto-attack at the site must be faced a second time.
    // duplicatesRun = attackIndex - autoAttacks.length counts how many
    // race-based duplicates have already been initiated this site phase.
    const raceDupRaces = new Set<string>();
    for (const c of state.activeConstraints) {
      if (c.kind.type === 'auto-attack-race-duplicate') {
        raceDupRaces.add(c.kind.race.toLowerCase());
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
        const dupBoostCtxR = { companyId: company.id };
        const dupProwessR = resolveAttackProwess(state, aa.prowess, inPlayNamesR, dupRace, true, undefined, dupBoostCtxR);
        const dupStrikesR = resolveAttackStrikes(state, aa.strikes, inPlayNamesR, dupRace, dupBoostCtxR);
        const dupBodyR = resolveAttackBody(state, aa.body ?? null, inPlayNamesR, dupRace, dupBoostCtxR);
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
          attackingPlayerId: hazardPlayer(state).id,
          strikesTotal: dupStrikesR,
          strikeProwess: dupProwessR,
          creatureBody: dupBodyR,
          creatureRace: dupRace,
          strikeAssignments: [],
          currentStrikeIndex: 0,
          phase: 'assign-strikes',
          assignmentPhase: 'defender',
          bodyCheckTarget: null,
          detainment: dupDetainmentR,
          ...(aa.combatRules?.includes('attacker-chooses-defenders') ? { attackerChoosesDefenders: true } : {}),
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
      const dupBoostCtx = { companyId: company.id };
      const dupProwess = resolveAttackProwess(state, aa.prowess, inPlayNames2, creatureRace2, true, undefined, dupBoostCtx);
      const dupStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames2, creatureRace2, dupBoostCtx);
      const dupBody = resolveAttackBody(state, aa.body ?? null, inPlayNames2, creatureRace2, dupBoostCtx);
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
        attackingPlayerId: hazardPlayer(state).id,
        strikesTotal: dupStrikes,
        strikeProwess: dupProwess,
        creatureBody: dupBody,
        creatureRace: creatureRace2,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: dupDetainment,
        ...(aa.combatRules?.includes('attacker-chooses-defenders') ? { attackerChoosesDefenders: true } : {}),
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
  const hazardPlayerId = hazardPlayer(state).id;

  const inPlayNames = buildInPlayNames(state);
  const creatureRace = normalizeCreatureRace(aa.creatureType);
  const aaBoostCtx = { companyId: company.id };
  const baseEffective = resolveAttackProwess(state, aa.prowess, inPlayNames, creatureRace, true, undefined, aaBoostCtx);
  const effectiveStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames, creatureRace, aaBoostCtx);
  const effectiveBody = resolveAttackBody(state, aa.body ?? null, inPlayNames, creatureRace, aaBoostCtx);

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
      if (src) logDetail(`Site: consuming attribute-modifier (auto-attack.prowess +${boost.value - baseEffective}) from "${cardName(state, src.sourceDefinitionId, '?')}"`);
      boostedState = removeConstraint(boostedState, id);
    }
  }

  const isEachCharacter = aa.combatRules?.includes('each-character') ?? false;
  // "each character faces 1 strike": total = company size, strikes pre-assigned one per character.
  const preAssignedStrikes: StrikeAssignment[] = isEachCharacter
    ? company.characters.map(charId => ({ characterId: charId, excessStrikes: 0, resolved: false }))
    : [];
  const strikesTotalValue = isEachCharacter ? company.characters.length : effectiveStrikes;

  logDetail(`Site: initiating automatic attack ${attackIndex + 1}/${autoAttacks.length}: ${aa.creatureType} (${aa.strikes} strikes${effectiveStrikes !== aa.strikes ? ` → ${effectiveStrikes}` : ''}, ${aa.prowess} prowess${effectiveProwess !== aa.prowess ? ` → ${effectiveProwess}` : ''}${effectiveStrikes !== aa.strikes || effectiveProwess !== aa.prowess ? ' after global effects' : ''}${isEachCharacter ? `, each-character mode → ${strikesTotalValue} total pre-assigned` : ''})`);

  const aaAttackerChooses = aa.combatRules?.includes('attacker-chooses-defenders') ?? false;

  // Build a temporary combat state to compute the initial phase via nextStrikePhase.
  const baseCombat: CombatState = {
    attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: resolvedAttackIndex },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: strikesTotalValue,
    strikeProwess: effectiveProwess,
    creatureBody: effectiveBody,
    creatureRace,
    strikeAssignments: preAssignedStrikes,
    currentStrikeIndex: 0,
    phase: isEachCharacter ? 'resolve-strike' : 'assign-strikes',
    assignmentPhase: isEachCharacter ? 'done' : (aaAttackerChooses ? 'cancel-window' : 'defender'),
    bodyCheckTarget: null,
    detainment: isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: creatureRace as Race | null,
      // Site auto-attacks are implicitly "keyed to" the site's type (§3.II.2.R1/B1).
      // Passing the site type lets the standard detainment rules fire correctly for
      // Ringwraith/Balrog companies at dark-holds and shadow-holds.
      attackKeyedTo: [{ siteTypes: [siteDef.siteType] }],
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defendingSiteEffects: siteDef.effects,
    }),
    ...(forewarnedIdx !== undefined ? { isolated: true, uncancelable: true } : {}),
    ...(aaAttackerChooses ? { attackerChoosesDefenders: true } : {}),
    ...(isEachCharacter ? { eachCharacterFacesOneStrike: true } : {}),
  };

  // For each-character attacks with multiple characters, start at choose-strike-order.
  let combat: CombatState = baseCombat;
  if (isEachCharacter && preAssignedStrikes.length > 1) {
    combat = { ...baseCombat, phase: 'choose-strike-order', currentStrikeIndex: 0, bodyCheckTarget: null };
  } else if (isEachCharacter && preAssignedStrikes.length === 1) {
    combat = { ...baseCombat, phase: 'resolve-strike', currentStrikeIndex: 0, attackerStep1Done: false, bodyCheckTarget: null };
  }

  return {
    state: {
      ...boostedState,
      combat,
      phaseState: { ...siteState, automaticAttacksResolved: attackIndex + 1 },
    },
  };
}

/**
 * Handle the 'declare-agent-attack' step (CoE Step 3, line 358).
 *
 * The hazard player either declares that an agent at the company's site will
 * attack, or passes to skip. On declaration:
 *  - If the agent is face-down, it is revealed in-place (rule 2.V.iii).
 *  - Prowess/body modifiers (rule 3.iv.6.1) are computed from the agent's
 *    state BEFORE any reveal, so face-down modifiers are applied correctly.
 *  - CombatState is built directly and set; the step advances to
 *    `resolve-attacks` where the resource player passes to initiate it.
 */
function handleDeclareAgentAttack(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type === 'pass') {
    logDetail(`Site: declare-agent-attack → no agent attack declared (pass)`);
    return {
      state: {
        ...state,
        phaseState: { ...siteState, step: 'resolve-attacks' as const, siteEntered: true },
      },
    };
  }

  if (action.type !== 'declare-agent-attack') {
    return { state, error: `Expected 'declare-agent-attack' or 'pass' during declare-agent-attack step, got '${action.type}'` };
  }

  // Find the agent
  let hazardPlayerIndex = -1;
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].agents.some(a => a.character.instanceId === action.agentInstanceId)) {
      hazardPlayerIndex = i;
      break;
    }
  }
  if (hazardPlayerIndex === -1) {
    return { state, error: `Agent ${action.agentInstanceId} not found` };
  }

  const hazardPlayer = state.players[hazardPlayerIndex];
  const agent = hazardPlayer.agents.find(a => a.character.instanceId === action.agentInstanceId)!;
  const agentDef = defById(state, agent.character.definitionId);
  if (!agentDef || !isCharacterCard(agentDef)) {
    return { state, error: `Agent character definition not found for ${action.agentInstanceId}` };
  }

  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];

  // --- Compute prowess/body modifiers NOW (before any reveal) ---
  // Rule 3.iv.6.1: face-down/face-up × at-home/not-at-home × wounded
  let prowess = agentDef.prowess;
  let body = agentDef.body;

  const isFaceDown = !agent.revealed;
  const isWounded = agent.character.status === CardStatus.Inverted;

  // Determine current site name for home-site check
  let currentSiteName: string | undefined;
  if (agent.siteStack.length > 0) {
    const topSite = agent.siteStack[agent.siteStack.length - 1];
    const topSiteDef = defById(state, topSite.definitionId);
    if (topSiteDef && isSiteCard(topSiteDef)) currentSiteName = topSiteDef.name;
  } else if (company?.currentSite) {
    // Empty siteStack: agent is at company's current site (which is one of its home sites)
    const companySiteDef = defById(state, company.currentSite.definitionId);
    if (companySiteDef && isSiteCard(companySiteDef)) currentSiteName = companySiteDef.name;
  }
  const homesiteNames = agentDef.homesite
    ? agentDef.homesite.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];
  const isAtHome = currentSiteName !== undefined && homesiteNames.includes(currentSiteName);

  if (isWounded) prowess -= 2;
  if (isFaceDown && !isAtHome) prowess += 2;
  if (isFaceDown && isAtHome) { prowess += 5; body += 1; }
  if (!isFaceDown && isAtHome) { prowess += 2; body += 1; }

  // Rule 3.ii.4: face-down at home → attacker assigns strikes
  const attackerAssigns = isFaceDown && isAtHome;

  // Rule 3.II.2.R3/B3: Ringwraith/Balrog players → detainment
  const defendingAlignment = state.players[activePlayerIndex].alignment;
  const detainment = defendingAlignment === Alignment.Ringwraith || defendingAlignment === Alignment.Balrog;

  logDetail(`Site: declare-agent-attack — "${agentDef.name}" prowess ${prowess}, body ${body}, faceDown: ${isFaceDown}, atHome: ${isAtHome}, detainment: ${detainment}`);

  // --- Reveal face-down agent in-place ---
  // The agent stays at its current site (top of siteStack or company's site).
  // Older siteStack entries are returned to deck. Home site card placed if provided.
  let stateAfterReveal: GameState;
  if (isFaceDown) {
    const currentSiteEntry = agent.siteStack.length > 0
      ? agent.siteStack[agent.siteStack.length - 1]
      : company?.currentSite ?? null;

    if (!currentSiteEntry) {
      return { state, error: `Cannot determine current site for face-down agent ${action.agentInstanceId}` };
    }

    // Sites to return to deck: everything in siteStack except the current (top) position,
    // plus any home site card that was declared (it stays with the agent in its stack)
    const priorStackSites = agent.siteStack.slice(0, -1); // all but top
    const emptyStack = agent.siteStack.length === 0;

    if (action.homeSiteInstanceId) {
      const homeSiteCard = findById(hazardPlayer.siteDeck, action.homeSiteInstanceId);
      if (!homeSiteCard) {
        return { state, error: `Home site ${action.homeSiteInstanceId} not in hazard player's site deck` };
      }
      // For empty siteStack (at home): siteStack = [homeSiteCard], stays at home
      // For non-empty: siteStack = [currentSite] (prior entries returned to deck, home site removed from deck)
      const newSiteStack = emptyStack
        ? [{ instanceId: homeSiteCard.instanceId, definitionId: homeSiteCard.definitionId, status: CardStatus.Untapped as const }]
        : [{ instanceId: currentSiteEntry.instanceId, definitionId: currentSiteEntry.definitionId, status: CardStatus.Untapped as const }];

      const returnedSites = emptyStack ? [] : priorStackSites;
      stateAfterReveal = updatePlayer(state, hazardPlayerIndex, p => ({
        ...p,
        agents: p.agents.map(a =>
          a.character.instanceId === action.agentInstanceId
            ? { ...a, revealed: true, siteStack: newSiteStack, attackedThisSitePhase: true }
            : a,
        ),
        siteDeck: [...removeById(p.siteDeck, homeSiteCard.instanceId), ...returnedSites],
      }));
    } else {
      // No home site — reveal without site, discard at EOT
      const newSiteStack = emptyStack
        ? []
        : [{ instanceId: currentSiteEntry.instanceId, definitionId: currentSiteEntry.definitionId, status: CardStatus.Untapped as const }];
      const returnedSites = emptyStack ? [] : priorStackSites;
      stateAfterReveal = updatePlayer(state, hazardPlayerIndex, p => ({
        ...p,
        agents: p.agents.map(a =>
          a.character.instanceId === action.agentInstanceId
            ? { ...a, revealed: true, siteStack: newSiteStack, attackedThisSitePhase: true, discardAtEndOfTurn: true }
            : a,
        ),
        siteDeck: [...p.siteDeck, ...returnedSites],
      }));
    }
  } else {
    // Already revealed — just mark as acted
    stateAfterReveal = updatePlayer(state, hazardPlayerIndex, p => ({
      ...p,
      agents: p.agents.map(a =>
        a.character.instanceId === action.agentInstanceId
          ? { ...a, attackedThisSitePhase: true }
          : a,
      ),
    }));
  }

  // Build CombatState with pre-computed modifiers
  const combat: CombatState = {
    attackSource: { type: 'agent', instanceId: action.agentInstanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer.id,
    strikesTotal: 1,
    strikeProwess: prowess,
    creatureBody: body,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: attackerAssigns ? 'attacker' : 'defender',
    bodyCheckTarget: null,
    detainment,
    ...(attackerAssigns ? { forceSingleTarget: true } : {}),
  };

  return {
    state: {
      ...stateAfterReveal,
      combat,
      phaseState: { ...siteState, step: 'resolve-attacks' as const, siteEntered: true },
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
    ? defById(state, company.currentSite.definitionId)
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
  const creatureCard = findById(hazardPlayer.hand, action.cardInstanceId);
  if (!creatureCard) {
    return { state, error: `Card ${action.cardInstanceId} not in hazard player's hand` };
  }
  const creatureDef = defById(state, creatureCard.definitionId);
  if (!creatureDef || creatureDef.cardType !== 'hazard-creature') {
    return { state, error: `Card ${action.cardInstanceId} is not a hazard creature` };
  }

  // Remove creature from hand, move to hazard player's cardsInPlay for
  // the duration of combat (finalizeCombat routes it to discard).
  const newHand = removeById(hazardPlayer.hand, creatureCard.instanceId);
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
  const effectiveSiteDynBody = resolveAttackBody(state, creatureDef.body, inPlayNames, creatureRace, sitePlayedBoostCtx);

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
    creatureBody: effectiveSiteDynBody,
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

  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);

  // If revealed on-guard creature attacks remain, initiate the next one via chain
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  if (company) {
    const revealedIdx = company.onGuardCards.findIndex(og => {
      if (!og.revealed) return false;
      const def = defById(state, og.definitionId);
      return def?.cardType === 'hazard-creature';
    });
    if (revealedIdx !== -1) {
      const attackCard = company.onGuardCards[revealedIdx];
      const def = defById(state, attackCard.definitionId);
      logDetail(`Site: initiating on-guard creature attack "${def?.name ?? attackCard.definitionId}" via chain`);

      // Remove from onGuardCards
      const newOnGuardCards = [...company.onGuardCards];
      newOnGuardCards.splice(revealedIdx, 1);

      // Update company, players
      const newCompanies = [...state.players[activePlayerIndex].companies];
      newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };

      // Initiate chain with CardInstance
      const hazardPlayerId = hazardPlayer(state).id;
      const cardInstance: CardInstance = toCardInstance(attackCard);
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
  const def = defById(state, revealedCard.definitionId);
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
  const cardInstance: CardInstance = toCardInstance(revealedCard);
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
 * Handle the Hermit's Hill (dm-32) special site grant-action: the company
 * discards two minor items they bear to unlock major item playability at the
 * current untapped site for the rest of this company's site phase.
 *
 * Locates both items by instance ID (`targetCardId` and `secondTargetCardId`),
 * detaches them from their bearers, moves them to the discard pile, then adds
 * a `major-item-unlocked` constraint scoped to the company's site phase.
 */
function handleDiscardMinorsForMajor(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };
  if (!action.targetCardId || !action.secondTargetCardId) {
    return { state, error: 'discard-minors-for-major: missing targetCardId or secondTargetCardId' };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  const discardItemIds = [action.targetCardId, action.secondTargetCardId];
  let workingState = state;

  for (const itemId of discardItemIds) {
    const currentPlayer = workingState.players[playerIndex];
    let found = false;

    for (const [charId, char] of characterEntries(currentPlayer)) {
      const itemIdx = char.items.findIndex(i => i.instanceId === itemId);
      if (itemIdx < 0) continue;

      const discardedItem = char.items[itemIdx];
      const newItems = char.items.filter((_, i) => i !== itemIdx);
      const updatedChar = { ...char, items: newItems };
      const newDiscardPile = [
        ...currentPlayer.discardPile,
        toCardInstance(discardedItem),
      ];

      workingState = updatePlayer(workingState, playerIndex, p => ({
        ...p,
        characters: { ...p.characters, [charId]: updatedChar },
        discardPile: newDiscardPile,
      }));
      logDetail(`Site: discard-minors-for-major discarded item ${itemId as string} from ${charId}`);
      found = true;
      break;
    }

    if (!found) {
      return { state, error: `discard-minors-for-major: item ${itemId as string} not found on any character` };
    }
  }

  // Add major-item-unlocked constraint scoped to this company's site phase
  const newState = addConstraint(workingState, {
    source: action.sourceCardId,
    sourceDefinitionId: action.sourceCardDefinitionId,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: { type: 'major-item-unlocked' },
  });

  logDetail(`Site: discard-minors-for-major activated for company ${company.id as string} — major items now playable`);
  return { state: newState };
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
function handleSitePlayResources(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  const player = playerById(state, action.player)!;
  const company = player.companies[siteState.activeCompanyIndex];

  // Pass — check whether CvCC attack is possible before advancing
  if (action.type === 'pass') {
    // If the company has entered the site and no opponent interaction has
    // occurred, transition to declare-company-attack so the player gets
    // the option to initiate CvCC.
    if (siteState.siteEntered && siteState.opponentInteractionThisTurn === null) {
      const hasCvCCTargets = hasCvCCAttackTargets(state, siteState, player, company.id);
      if (hasCvCCTargets) {
        logDetail(`Site: company ${company.id} done with resources — entering declare-company-attack step`);
        return {
          state: {
            ...state,
            phaseState: { ...siteState, step: 'declare-company-attack' as const },
          },
        };
      }
    }
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
    const handCard = findById(player.hand, action.cardInstanceId);
    const shortDef = handCard ? defById(state, handCard.definitionId) : undefined;
    const shortEffects = shortDef && 'effects' in shortDef
      ? ((shortDef as { effects?: readonly import('../types/effects.js').CardEffect[] }).effects ?? [])
      : [];
    const hasRequiredSkill = shortEffects.some(
      e => typeof (e as { requiredSkill?: string }).requiredSkill === 'string',
    );
    if (hasRequiredSkill) {
      logDetail(`Site: short-event "${shortDef?.name ?? handCard?.definitionId}" intercepted — enqueuing on-guard-window resolution`);
      return {
        state: enqueueResolution(state, {
          source: action.cardInstanceId,
          actor: hazardPlayer(state).id,
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
    return {
      state: enqueueResolution(state, {
        source: action.cardInstanceId,
        actor: hazardPlayer(state).id,
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

  // Site-phase grant-action: Hermit's Hill discard-minors-for-major (dm-32).
  // Handled before the generic grant-action path because it has no character
  // actor to tap — the cost is discarding two minor items directly.
  if (action.type === 'activate-granted-action' && action.actionId === 'discard-minors-for-major') {
    return handleDiscardMinorsForMajor(state, action, siteState);
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
  const def = defById(state, site.definitionId);
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

  const handCard = findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: 'Card not found in hand' };
  const def = defById(state, handCard.definitionId)!;
  const isItem = isItemCard(def);
  const isAlly = !isItem && isAllyCard(def);

  const siteInPlay = company.currentSite!;

  const targetCharId = action.attachToCharacterId!;
  const charInPlay = player.characters[targetCharId as string];
  const charDef = defById(state, charInPlay.definitionId);
  const charName = charDef?.name ?? targetCharId;
  logDetail(`Site: playing ${def.name} on ${charName} — tapping character and site`);

  // Remove card from hand
  const newHand = removeById(player.hand, handCard.instanceId);

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
  // site carries the `never-taps` site-rule (e.g. The Worthy Hills) or
  // Thorough Search is active (see below).
  const neverTaps = siteNeverTaps(state, siteInPlay);
  if (neverTaps) {
    logDetail(`Site: ${def.name}'s site has never-taps — leaving site untapped`);
  }

  // Rule 2.V.5: when a resource that taps the site is successfully played,
  // the resource player may attempt one additional minor item as the next
  // action. A `never-taps` site never triggers the bonus. The bonus is
  // consumed when the subsequent minor-item play arrives.
  const consumingBonus = siteState.resourcePlayed && siteState.minorItemAvailable;

  // Bounty of the Hoard: if played, one minor or major item may be played at
  // a tapped hoard site. Consume the flag when such an item is played.
  const siteWasTapped = siteInPlay.status === CardStatus.Tapped;
  const siteDef = defById(state, siteInPlay.definitionId);
  const siteIsHoard = siteDef && 'keywords' in siteDef
    ? ((siteDef as { keywords?: readonly string[] }).keywords ?? []).includes('hoard')
    : false;
  const itemSubtypeForBounty = isItem && 'subtype' in def
    ? (def as { subtype?: string }).subtype
    : undefined;
  const usingHoardBounty = siteWasTapped && siteState.hoardBountyAvailable && siteIsHoard
    && (itemSubtypeForBounty === 'minor' || itemSubtypeForBounty === 'major');
  const nextHoardBountyAvailable = usingHoardBounty ? false : siteState.hoardBountyAvailable;

  // Thorough Search: if played, one minor, major, or gold ring item may be played without
  // tapping the site. Consume the flag when such an item is played.
  const usingThoroughSearch = siteState.thoroughSearchAvailable
    && (itemSubtypeForBounty === 'minor' || itemSubtypeForBounty === 'major' || itemSubtypeForBounty === 'gold-ring');
  const nextThoroughSearchAvailable = usingThoroughSearch ? false : siteState.thoroughSearchAvailable;

  // Thorough Search prevents site tap and does not count as the "first resource played"
  // (so the opening minor-item bonus does not fire for it).
  const openingBonusActual = !siteState.resourcePlayed && !neverTaps && !usingThoroughSearch;
  const nextMinorItemAvailableActual = openingBonusActual
    ? true
    : consumingBonus
      ? false
      : siteState.minorItemAvailable;

  const newCompaniesActual = [...player.companies];
  newCompaniesActual[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: (neverTaps || usingThoroughSearch) ? siteInPlay : { ...siteInPlay, status: CardStatus.Tapped },
  };

  let afterAttach: GameState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand, characters: newCharacters, companies: newCompaniesActual })),
    phaseState: {
      ...siteState,
      resourcePlayed: usingThoroughSearch ? siteState.resourcePlayed : true,
      minorItemAvailable: nextMinorItemAvailableActual,
      hoardBountyAvailable: nextHoardBountyAvailable,
      thoroughSearchAvailable: nextThoroughSearchAvailable,
    },
  };

  // Apply ward-bearer effects declared by the incoming card: any hazard
  // on the bearer that matches the ward filter is immediately discarded
  // (e.g. Adamant Helmet cancelling dark enchantments on its wearer).
  if (isItem) {
    afterAttach = applyWardToBearer(afterAttach, playerIndex, targetCharId, def, action.cardInstanceId);
    afterAttach = fireCharacterGainsItemChecks(afterAttach, playerIndex, siteState.activeCompanyIndex);
  }

  // auto-test-gold-ring site-rule (Rule 9.21): playing a gold-ring item at a
  // site that declares this rule immediately enqueues a gold-ring-test resolution.
  // The ring stays on the character until the test fires (unlike the org-phase
  // store-item path which moves it to outOfPlayPile first).
  if (isItem) {
    const itemSubtype = 'subtype' in def ? (def as { subtype?: string }).subtype : undefined;
    const afterAttachPlayer = afterAttach.players[playerIndex];
    const autoTestMod = goldRingAutoTestModifier(
      afterAttach,
      afterAttachPlayer.companies,
      targetCharId,
      itemSubtype,
    );
    if (autoTestMod !== null) {
      const siteName = goldRingAutoTestSiteName(afterAttach, afterAttachPlayer.companies, targetCharId) ?? '?';
      logDetail(`Auto-test gold ring ${def.name} at ${siteName} (modifier ${formatSignedNumber(autoTestMod)})`);
      return {
        state: enqueueResolution(afterAttach, {
          source: action.cardInstanceId,
          actor: action.player,
          scope: { kind: 'phase', phase: Phase.Site },
          kind: {
            type: 'gold-ring-test',
            goldRingInstanceId: action.cardInstanceId,
            rollModifier: autoTestMod,
            characterInstanceId: targetCharId,
          },
        }),
      };
    }
  }

  // When an ally joins, company membership changes — sweep any Fellowship-like events
  if (isAlly) {
    afterAttach = sweepCompanyMembershipChangedEvents(afterAttach, [company.id]);
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
      const hDef = newState.cardPool[hazard.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
      for (const effect of getOnEventEffects(hDef, 'character-gains-item')) {
        if (effect.apply.type !== 'force-check' || effect.apply.check !== 'corruption') continue;

        logDetail(`character-gains-item: "${hDef?.name}" triggers corruption check for character ${charId as string}`);
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
          reason: `${hDef?.name} (item gained)`,
          possessions,
        });
      }
    }
  }
  return newState;
}

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
  const def = defById(state, handCard.definitionId)!;

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
  const cardInstance: CardInstance = toCardInstance(handCard);
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

  const def = defById(state, entry.card.definitionId);
  if (!def || !isFactionCard(def)) return { state, effects: [] };

  const charId = entry.payload.influencingCharacterId;
  const charInPlay = player.characters[charId as string];
  if (!charInPlay) return { state, effects: [] };

  const charDef = defById(state, charInPlay.definitionId);
  const charName = charDef?.name ?? charId;

  // Calculate influence modifier using current state (post-on-guard effects)
  let modifier = 0;
  if (charDef && isCharacterCard(charDef)) {
    // Use free DI (total DI minus mind cost of followers), not the raw card stat
    modifier += availableDI(state, charId, player);

    const resolverCtx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: buildBearerContext(charDef),
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
        if (effect.when && !matchesContext(effect.when, resolverCtx)) continue;
        charEffects.push({ effect, sourceDef: def, sourceInstance: entry.card.instanceId });
      }
    }

    const dslModifier = resolveCheckModifier(charEffects, 'influence');
    if (dslModifier !== 0) {
      logDetail(`DSL influence check-modifiers: ${formatSignedNumber(dslModifier)}`);
    }
    modifier += dslModifier;

    const dslDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
    if (dslDI !== 0) {
      logDetail(`DSL direct-influence modifiers: ${formatSignedNumber(dslDI)}`);
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
      logDetail(`Influence one-shot constraint ${formatSignedNumber(constraint.kind.value)} from ${constraint.sourceDefinitionId as string} (consumed)`);
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

  const rollEffect = diceRollEffect(player.name, roll, `Influence: ${def.name}`);

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
    const targetDef = defById(state, targetChar.definitionId);
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
    for (const [oppCharId, oppChar] of characterEntries(opponent)) {
      const allyInst = oppChar.allies.find(a => a.instanceId === action.targetInstanceId);
      if (allyInst) {
        const allyDef = defById(state, allyInst.definitionId);
        if (!allyDef || !isAllyCard(allyDef)) return { state, error: 'Target is not an ally' };
        targetMind = (allyDef as { mind: number }).mind;
        controllerDI = availableDI(state, oppCharId, opponent);
        allyFound = true;
        break;
      }
    }
    if (!allyFound) return { state, error: 'Target ally not found' };
  } else if (action.targetKind === 'faction') {
    const targetFaction = findById(opponent.cardsInPlay, action.targetInstanceId);
    if (!targetFaction) return { state, error: 'Target faction not found' };
    const factionDef = defById(state, targetFaction.definitionId);
    if (!factionDef || !isFactionCard(factionDef)) return { state, error: 'Target is not a faction' };
    // CoE rule 8.3: the comparison value is the in-play influence number.
    // No controller DI for factions (factions are controlled by the player,
    // not a character).
    targetMind = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;
    controllerDI = 0;
  }

  const charDef = defById(state, charInPlay.definitionId);
  const charName = charDef?.name ?? charId;

  // Handle identical card reveal (rule 10.11)
  let revealedCard: { instanceId: CardInstanceId; definitionId: import('../index.js').CardDefinitionId } | null = null;
  let effectiveTargetMind = targetMind;
  const newHand = [...player.hand];

  if (action.revealedCardInstanceId) {
    const revealIdx = newHand.findIndex(c => c.instanceId === action.revealedCardInstanceId);
    if (revealIdx === -1) return { state, error: 'Revealed card not in hand' };
    const revealedHandCard = newHand[revealIdx];
    const revealedDef = defById(state, revealedHandCard.definitionId);

    // Validate: must be same name as target
    let targetName: string | undefined;
    if (action.targetKind === 'character') {
      const tDef = state.cardPool[opponent.characters[action.targetInstanceId as string]?.definitionId as string];
      targetName = tDef?.name;
    } else if (action.targetKind === 'faction') {
      const targetFaction = findById(opponent.cardsInPlay, action.targetInstanceId);
      const tDef = targetFaction ? defById(state, targetFaction.definitionId) : undefined;
      targetName = tDef?.name;
    } else {
      for (const ch of Object.values(opponent.characters)) {
        const ally = ch.allies.find(a => a.instanceId === action.targetInstanceId);
        if (ally) {
          const aDef = defById(state, ally.definitionId);
          targetName = aDef?.name;
          break;
        }
      }
    }
    if (!revealedDef || revealedDef.name !== targetName) {
      return { state, error: 'Revealed card does not match target name' };
    }

    revealedCard = toCardInstance(revealedHandCard);
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

  const rollEffect = diceRollEffect(player.name, roll, `Opponent influence: ${charName} attacks${revealedCard ? ' (identical revealed)' : ''}`);

  // Calculate modifiers
  const influencerDI = availableDI(state, charId, player);
  const opponentGI = effectiveGeneralInfluence(state, opponent.id) - opponent.generalInfluenceUsed;
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

  const rollEffect = diceRollEffect(opponent.name, roll, `Opponent influence: defense`);

  // Calculate final result:
  // attacker roll + influencer DI - opponent GI - defender roll
  //   - controller DI + cross-alignment penalty (non-positive; 0 or -5)
  const finalResult = attempt.attackerRoll + attempt.influencerDI - attempt.opponentGI - defenderRoll - attempt.controllerDI + attempt.crossAlignmentPenalty;

  logDetail(`Opponent influence resolution: ${attempt.attackerRoll} + ${attempt.influencerDI} - ${attempt.opponentGI} - ${defenderRoll} - ${attempt.controllerDI} + ${attempt.crossAlignmentPenalty} (cross-alignment) = ${finalResult} vs mind ${attempt.targetMind}`);

  const newPlayers = clonePlayers(state);

  if (finalResult > attempt.targetMind) {
    // Success — discard target and controlled non-follower cards
    logDetail(`Opponent influence succeeded (${finalResult} > ${attempt.targetMind})`);
    // Find the company of the influenced target (for membership-change sweep)
    const opponent2 = state.players[opponentIndex];
    let influencedCompanyId: import('../index.js').CompanyId | undefined;
    if (attempt.targetKind === 'ally') {
      for (const [charId, ch] of characterEntries(opponent2)) {
        if (ch.allies.some(a => a.instanceId === attempt.targetInstanceId)) {
          influencedCompanyId = findCharacterCompany(opponent2.companies, charId)?.id;
          break;
        }
      }
    } else {
      influencedCompanyId = findCharacterCompany(opponent2.companies, attempt.targetInstanceId)?.id;
    }
    discardInfluencedCard(newPlayers, opponentIndex, attempt, state);

    const afterInfluence = cleanupEmptyCompanies({ ...state, players: newPlayers, rng, cheatRollTotal });
    return {
      state: influencedCompanyId
        ? sweepCompanyMembershipChangedEvents(afterInfluence, [influencedCompanyId])
        : afterInfluence,
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
      discardPile: [...attacker.discardPile, toCardInstance(attempt.revealedCard)],
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
function discardInfluencedCard(
  players: [PlayerState, PlayerState],
  opponentIndex: number,
  pending: import('../types/pending.js').OpponentInfluenceAttempt,
  state: GameState,
): void {
  const opponent = players[opponentIndex];

  if (pending.targetKind === 'ally') {
    // Find and remove the ally from its controlling character
    for (const [charId, charInPlay] of characterEntries(opponent)) {
      const allyIdx = charInPlay.allies.findIndex(a => a.instanceId === pending.targetInstanceId);
      if (allyIdx !== -1) {
        const ally = charInPlay.allies[allyIdx];
        const newAllies = [...charInPlay.allies];
        newAllies.splice(allyIdx, 1);
        const updatedChar = { ...charInPlay, allies: newAllies };
        const newChars = { ...opponent.characters, [charId]: updatedChar };
        const newDiscard = [...opponent.discardPile, toCardInstance(ally)];
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
    const newDiscard = [...opponent.discardPile, toCardInstance(faction)];
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
    newDiscard.push(toCardInstance(item));
    logDetail(`Discarded item ${item.instanceId} from influenced character`);
  }

  // Discard allies
  for (const ally of targetChar.allies) {
    newDiscard.push(toCardInstance(ally));
    logDetail(`Discarded ally ${ally.instanceId} from influenced character`);
  }

  // Dispatch hazards to their owner's discard pile
  for (const haz of targetChar.hazards) {
    const hazOwner = ownerOf(haz.instanceId);
    const hazOwnerIdx = players.findIndex(p => (p.id as string) === (hazOwner as string));
    const safeIdx = hazOwnerIdx !== -1 ? hazOwnerIdx : 1 - opponentIndex;
    players[safeIdx] = { ...players[safeIdx], discardPile: [...players[safeIdx].discardPile, toCardInstance(haz)] };
    logDetail(`discardInfluencedCard: hazard ${haz.instanceId as string} dispatched to ${players[safeIdx].name}`);
  }

  // Discard the character itself
  newDiscard.push(toCardInstance(targetChar));
  logDetail(`Discarded influenced character ${targetChar.instanceId}`);

  // Handle followers — try to place under GI, otherwise discard
  const newCharacters = { ...opponent.characters };
  for (const followerId of targetChar.followers) {
    const follower = newCharacters[followerId as string];
    if (!follower) continue;
    const followerDef = defById(state, follower.definitionId);
    const followerMind = followerDef && isCharacterCard(followerDef) && followerDef.mind !== null ? followerDef.mind : 0;

    // Check if there's room under GI
    const currentGIUsed = Object.values(newCharacters)
      .filter(ch => ch.controlledBy === 'general' && ch.instanceId !== pending.targetInstanceId)
      .reduce((sum, ch) => {
        const def = defById(state, ch.definitionId);
        return sum + (def && isCharacterCard(def) && def.mind !== null ? def.mind : 0);
      }, 0);

    if (currentGIUsed + followerMind <= effectiveGeneralInfluence(state, opponent.id)) {
      // Move to GI
      newCharacters[followerId as string] = { ...follower, controlledBy: 'general' };
      logDetail(`Follower ${followerId} falls to GI (mind ${followerMind}, GI used ${currentGIUsed})`);
    } else {
      // Discard follower and their items/allies
      for (const item of follower.items) {
        newDiscard.push(toCardInstance(item));
      }
      for (const ally of follower.allies) {
        newDiscard.push(toCardInstance(ally));
      }
      // Dispatch follower hazards to their owner's discard pile
      for (const haz of follower.hazards) {
        const hazOwner = ownerOf(haz.instanceId);
        const hazOwnerIdx = players.findIndex(p => (p.id as string) === (hazOwner as string));
        const safeIdx = hazOwnerIdx !== -1 ? hazOwnerIdx : 1 - opponentIndex;
        players[safeIdx] = { ...players[safeIdx], discardPile: [...players[safeIdx].discardPile, toCardInstance(haz)] };
        logDetail(`discardInfluencedCard: follower hazard ${haz.instanceId as string} dispatched to ${players[safeIdx].name}`);
      }
      newDiscard.push(toCardInstance(follower));
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
      returnedCards.push(...company.onGuardCards.map(og => (toCardInstance(og))));
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
 * `on-event: end-of-turn` + `apply.type: force-check, perOthersItem: true`.
 * For each match, enqueues one corruption-check pending resolution per
 * item in the bearer's company that the bearer does NOT bear. The modifier
 * for each check is the negative corruption-point value of that item.
 * Used by *Covetous Thoughts* (le-107).
 */

/**
 * Scan all cardsInPlay for permanent hazard events with an
 * `on-event: end-of-turn, actor: "both"` + move-to-deck apply shape.
 * For each found effect, enqueue one fetch-to-deck pending effect per player
 * (both players can optionally fetch from their own discard pile).
 *
 * Used by *Thrice Outnumbered* (le-142): "Each player may take one Man
 * hazard creature from his discard pile and shuffle it into his play deck
 * at the end of each turn."
 */
function fireEndOfTurnFetchEffects(state: GameState): GameState {
  let newState = state;
  const inPlayNames = buildInPlayNames(state);

  // Scan both players' cardsInPlay for matching permanent events.
  for (const player of newState.players) {
    for (const card of player.cardsInPlay) {
      const def = newState.cardPool[card.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
      for (const effect of getOnEventEffects(def, 'end-of-turn')) {
        if (effect.actor !== 'both') continue;
        if (effect.apply.type !== 'move') continue;

        // Evaluate the optional `when` condition (e.g. "if Doors of Night is in play")
        if (effect.when && !matchesContext(effect.when, { inPlay: inPlayNames })) {
          logDetail(`end-of-turn: "${def?.name}" — when condition not met, skipping`);
          continue;
        }

        const payload = moveToFetchToDeckPayload(effect.apply as unknown as MoveEffect);
        if (!payload) continue;

        const dest = payload.to === 'hand' ? 'hand' : 'deck';
        logDetail(`end-of-turn: "${def?.name}" — firing fetch-to-${dest} for both players`);

        // Enqueue one pending fetch effect per player (resource player first)
        for (const targetPlayer of newState.players) {
          const pendingEffect: PendingEffect = {
            type: 'card-effect',
            cardInstanceId: card.instanceId,
            effect: payload,
            actor: targetPlayer.id,
            skipDiscard: true,
          };
          newState = {
            ...newState,
            pendingEffects: [...newState.pendingEffects, pendingEffect],
          };
          logDetail(`end-of-turn: queued fetch-to-${dest} for player ${targetPlayer.id as string} from "${def?.name}"`);
        }
      }
    }
  }

  return newState;
}

function fireEndOfTurnCorruptionChecks(state: GameState): GameState {
  const resourcePlayer = playerById(state, state.activePlayer)!;

  let newState = state;
  for (const company of resourcePlayer.companies) {
    for (const charId of company.characters) {
      const bearer = resourcePlayer.characters[charId as string];
      if (!bearer) continue;
      for (const hazard of bearer.hazards) {
        const hDef = newState.cardPool[hazard.definitionId as string] as { name?: string; effects?: readonly import('../types/effects.js').CardEffect[] } | undefined;
        for (const effect of getOnEventEffects(hDef, 'end-of-turn')) {
          if (effect.apply.type !== 'force-check' || !effect.apply.perOthersItem) continue;
          if (effect.apply.check !== 'corruption') continue;

          const otherItems = company.characters
            .filter(oid => oid !== charId)
            .flatMap(oid => resourcePlayer.characters[oid as string]?.items ?? []);

          if (otherItems.length === 0) {
            logDetail(`end-of-turn: "${hDef?.name}" on ${charId as string} — no other-company items, skipping`);
            continue;
          }

          logDetail(`end-of-turn: "${hDef?.name}" on ${charId as string} — ${otherItems.length} other-company item(s)`);
          const possessions = [
            ...bearer.items.map(i => i.instanceId),
            ...bearer.allies.map(a => a.instanceId),
            ...bearer.hazards.map(h => h.instanceId),
          ];
          for (const item of otherItems) {
            const itemDef = defById(newState, item.definitionId);
            const cp = isItemCard(itemDef) ? itemDef.corruptionPoints : 0;
            const modifier = cp > 0 ? -cp : 0;
            logDetail(`end-of-turn: enqueuing check for ${charId as string} — item "${itemDef?.name ?? item.definitionId as string}" cp=${cp} → modifier ${modifier}`);
            newState = enqueueCorruptionCheck(newState, {
              source: hazard.instanceId,
              actor: state.activePlayer!,
              scope: { kind: 'phase', phase: Phase.EndOfTurn },
              characterId: charId,
              modifier,
              reason: `${hDef?.name} (${itemDef?.name ?? item.definitionId as string})`,
              possessions,
            });
          }
        }
      }
    }
  }
  return newState;
}

/**
 * Fire automatic gold-ring tests at the beginning of the end-of-turn phase
 * for Ringwraith and Balrog players (CoE rule 9.23).
 *
 * Any gold ring borne by a character in a Ringwraith or Balrog company is
 * automatically tested with a -2 roll modifier. For Ringwraith companies at
 * Barad-Dûr the modifier is -3 instead.
 */
function fireEndOfTurnGoldRingTests(state: GameState): GameState {
  const resourcePlayer = playerById(state, state.activePlayer)!;
  if (resourcePlayer.alignment !== Alignment.Ringwraith && resourcePlayer.alignment !== Alignment.Balrog) {
    return state;
  }

  let newState = state;
  for (const company of resourcePlayer.companies) {
    // Determine the base modifier for this company.
    // Ringwraith at Barad-Dûr: -3; otherwise Ringwraith or Balrog: -2.
    let baseModifier = -2;
    if (resourcePlayer.alignment === Alignment.Ringwraith && company.currentSite) {
      const siteDefId = resolveInstanceId(newState, company.currentSite.instanceId);
      if (siteDefId === BARAD_DUR_MINION) {
        baseModifier = -3;
      }
    }

    for (const charId of company.characters) {
      const bearer = resourcePlayer.characters[charId as string];
      if (!bearer) continue;
      for (const item of bearer.items) {
        const itemDef = defById(newState, item.definitionId) as { subtype?: string; name?: string } | undefined;
        if (!itemDef || itemDef.subtype !== 'gold-ring') continue;

        logDetail(`end-of-turn: auto-testing gold ring "${itemDef.name ?? item.definitionId as string}" on ${charId as string} (${resourcePlayer.alignment} player, modifier ${baseModifier})`);
        newState = enqueueResolution(newState, {
          source: item.instanceId,
          actor: state.activePlayer!,
          scope: { kind: 'phase', phase: Phase.EndOfTurn },
          kind: {
            type: 'gold-ring-test',
            goldRingInstanceId: item.instanceId,
            characterInstanceId: charId,
            rollModifier: baseModifier,
          },
        });
      }
    }
  }

  return newState;
}

/**
 * CvCC alignment matrix (CoE rule 8.41).
 *
 * Returns true if a company of `attackerAlignment` (and `attackerCovert` for
 * fallen-wizards) may legally attack a company of `defenderAlignment`.
 * Since covert/overt tracking is not yet implemented, fallen-wizard
 * companies default to covert restrictions (most conservative).
 */
function canAttackAlignment(
  attackerAlignment: Alignment,
  defenderAlignment: Alignment,
  _attackerCovert = true,
): boolean {
  switch (attackerAlignment) {
    case Alignment.Wizard:
      // Wizard can attack: Ringwraith, Fallen-wizard (overt), Balrog
      // Since overt is not tracked, include all fallen-wizard for now
      return defenderAlignment === Alignment.Ringwraith
        || defenderAlignment === Alignment.FallenWizard
        || defenderAlignment === Alignment.Balrog;
    case Alignment.Ringwraith:
      // Ringwraith can attack: Wizard, Fallen-wizard
      return defenderAlignment === Alignment.Wizard
        || defenderAlignment === Alignment.FallenWizard;
    case Alignment.FallenWizard:
      // Covert fallen-wizard: Ringwraith, Balrog
      // Overt fallen-wizard: any company (not yet tracked — use covert restrictions)
      return defenderAlignment === Alignment.Ringwraith
        || defenderAlignment === Alignment.Balrog;
    case Alignment.Balrog:
      // Balrog can attack: Wizard, Fallen-wizard
      return defenderAlignment === Alignment.Wizard
        || defenderAlignment === Alignment.FallenWizard;
    default:
      return false;
  }
}

/**
 * Returns true if the given company could initiate a CvCC attack this turn.
 * Checks that the opponent has at least one company at the same site, and
 * that the alignment restrictions are satisfied.
 */
function hasCvCCAttackTargets(
  state: GameState,
  siteState: SitePhaseState,
  attackingPlayer: PlayerState,
  _attackingCompanyId: CompanyId,
): boolean {
  const attackingCompany = attackingPlayer.companies[siteState.activeCompanyIndex];
  if (!attackingCompany?.currentSite) return false;

  const atkSiteDef = defById(state, attackingCompany.currentSite.definitionId);
  const atkSiteName = atkSiteDef && isSiteCard(atkSiteDef) ? atkSiteDef.name : null;

  const hazardIdx = state.players.findIndex(p => p.id !== attackingPlayer.id);
  if (hazardIdx < 0) return false;
  const opponent = state.players[hazardIdx];

  for (const opponentCompany of opponent.companies) {
    if (!opponentCompany.currentSite) continue;
    const oppSiteDef = defById(state, opponentCompany.currentSite.definitionId);
    const oppSiteName = oppSiteDef && isSiteCard(oppSiteDef) ? oppSiteDef.name : null;
    // Same site: match by name when both resolve (handles hero/minion versions of the same
    // location), fall back to definitionId equality when site definitions are unavailable.
    const sameSite = atkSiteName && oppSiteName
      ? atkSiteName === oppSiteName
      : attackingCompany.currentSite.definitionId === opponentCompany.currentSite.definitionId;
    if (!sameSite) continue;
    if (!canAttackAlignment(attackingPlayer.alignment, opponent.alignment)) continue;
    return true;
  }
  return false;
}

/**
 * Handle the 'declare-company-attack' step (CoE rules 8.38–8.41).
 *
 * The resource player either declares a CvCC attack against an opponent's
 * company at the same site, or passes to end the current company's site phase.
 *
 * On declaration:
 * - Validates eligibility (entered site, no prior interaction, alignment).
 * - Creates CombatState with isCvCC: true.
 * - Sets opponentInteractionThisTurn = 'attack'.
 */
function handleDeclareCompanyAttack(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  const player = playerById(state, action.player)!;
  const company = player.companies[siteState.activeCompanyIndex];

  // Pass — end this company's site phase
  if (action.type === 'pass') {
    logDetail(`Site: company ${company.id} passed CvCC declaration → advancing to next company`);
    return advanceSiteToNextCompany(state, siteState, company.id);
  }

  if (action.type !== 'declare-company-attack') {
    return { state, error: `Unexpected action '${action.type}' in declare-company-attack step` };
  }

  // Validate
  if (!siteState.siteEntered) {
    return { state, error: 'Company has not entered the site — cannot declare CvCC attack' };
  }
  if (siteState.opponentInteractionThisTurn !== null) {
    return { state, error: 'A company interaction has already occurred this turn — cannot declare CvCC attack' };
  }

  const hazardPlayerState = state.players.find(p => p.id !== player.id);
  if (!hazardPlayerState) return { state, error: 'No opponent found' };

  const targetCompany = hazardPlayerState.companies.find(c => c.id === action.targetCompanyId);
  if (!targetCompany) return { state, error: 'Target company not found' };

  if (!company.currentSite || !targetCompany.currentSite) {
    return { state, error: 'Target company is not at the same site' };
  }
  // Same site: match by name to handle hero/minion versions of the same location
  // (e.g. tw-391 and as-144 are both "Eagles' Eyrie"), fall back to definitionId equality.
  const atkSiteDef = defById(state, company.currentSite.definitionId);
  const atkSiteName = atkSiteDef && isSiteCard(atkSiteDef) ? atkSiteDef.name : null;
  const tgtSiteDef = defById(state, targetCompany.currentSite.definitionId);
  const tgtSiteName = tgtSiteDef && isSiteCard(tgtSiteDef) ? tgtSiteDef.name : null;
  const sameSite = atkSiteName && tgtSiteName
    ? atkSiteName === tgtSiteName
    : company.currentSite.definitionId === targetCompany.currentSite.definitionId;
  if (!sameSite) {
    return { state, error: 'Target company is not at the same site' };
  }

  if (!canAttackAlignment(player.alignment, hazardPlayerState.alignment)) {
    return { state, error: 'Alignment restrictions prevent this CvCC attack' };
  }

  // Count attackers: characters in attacking company
  const attackerCount = company.characters.length;
  if (attackerCount === 0) {
    return { state, error: 'Attacking company has no characters' };
  }

  logDetail(`Site: CvCC attack declared — ${company.id} (${player.alignment}) attacks ${targetCompany.id} (${hazardPlayerState.alignment}), ${attackerCount} strike(s)`);

  const combat: CombatState = {
    isCvCC: true,
    attackSource: { type: 'company-attack', attackingCompanyId: action.attackingCompanyId },
    companyId: action.targetCompanyId,
    defendingPlayerId: hazardPlayerState.id,
    attackingPlayerId: player.id,
    strikesTotal: attackerCount,
    strikeProwess: 0,
    creatureBody: null,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  const updatedSiteState: SitePhaseState = {
    ...siteState,
    opponentInteractionThisTurn: 'attack',
  };

  let newState: GameState = { ...state, combat, phaseState: updatedSiteState };

  // Fire cvc-combat-pre-strike on-event effects from items on attacking characters.
  // The Bow of the Galadhrim (as-68) uses this to roll for each non-unique minion
  // ally in the defending company before strikes are assigned.
  newState = fireCvccPreStrikeEffects(newState, player, company, hazardPlayerState, targetCompany);

  return { state: newState };
}

/**
 * Scan attacking company characters' items for `on-event: cvc-combat-pre-strike`
 * effects. For each qualifying item (condition met), collect non-unique minion
 * allies from the defending company and enqueue one `cvcc-ally-discard-roll`
 * pending resolution per ally per qualifying item.
 */
function fireCvccPreStrikeEffects(
  state: GameState,
  attackingPlayer: PlayerState,
  attackingCompany: { characters: readonly CardInstanceId[] },
  defendingPlayer: PlayerState,
  defendingCompany: { characters: readonly CardInstanceId[] },
): GameState {
  const defPlayerIndex = state.players.findIndex(p => p.id === defendingPlayer.id);

  // Collect non-unique minion allies in the defending company
  const defMinionAllies: Array<{ allyInstanceId: CardInstanceId; allyMind: number }> = [];
  for (const charInstId of defendingCompany.characters) {
    const char = defendingPlayer.characters[charInstId as string];
    if (!char) continue;
    for (const ally of char.allies) {
      const allyDef = defById(state, ally.definitionId);
      if (!allyDef) continue;
      const isMinion = (allyDef as { cardType?: string }).cardType === 'minion-resource-ally';
      const isUnique = (allyDef as { unique?: boolean }).unique === true;
      if (isMinion && !isUnique) {
        const mind = (allyDef as { mind?: number }).mind ?? 0;
        defMinionAllies.push({ allyInstanceId: ally.instanceId, allyMind: mind });
      }
    }
  }

  if (defMinionAllies.length === 0) return state;

  let newState = state;

  // Scan attacking characters' items for cvc-combat-pre-strike on-event effects
  for (const charInstId of attackingCompany.characters) {
    const char = attackingPlayer.characters[charInstId as string];
    if (!char) continue;
    const charDef = defById(newState, char.definitionId);

    // Build a bearer context for condition evaluation
    const bearerRace = charDef && isCharacterCard(charDef) ? charDef.race : '';
    const bearerSkills = charDef && isCharacterCard(charDef) ? (charDef.skills ?? []) : [];
    const bearerCtx = { bearer: { race: bearerRace, skills: bearerSkills } };

    for (const item of char.items) {
      const itemDef = defById(newState, item.definitionId);
      if (!itemDef) continue;

      for (const effect of getCardEffects(itemDef)) {
        if (effect.type !== 'on-event') continue;
        if (effect.event !== 'cvc-combat-pre-strike') continue;
        if (effect.apply.type !== 'roll-discard-opponent-non-unique-ally') continue;

        // Check condition
        if (effect.when && !matchesCondition(effect.when, bearerCtx)) {
          logDetail(`CvCC pre-strike: ${(itemDef as { name?: string }).name} condition not met for bearer — skipping`);
          continue;
        }

        const threshold = (effect.apply as { threshold?: number }).threshold ?? 5;
        const itemName = (itemDef as { name?: string }).name ?? (item.definitionId as string);
        logDetail(`CvCC pre-strike: ${itemName} fires — enqueuing ${defMinionAllies.length} ally-discard roll(s)`);

        for (const { allyInstanceId, allyMind } of defMinionAllies) {
          newState = enqueueResolution(newState, {
            source: item.instanceId,
            actor: attackingPlayer.id,
            scope: { kind: 'phase', phase: Phase.Site },
            kind: {
              type: 'cvcc-ally-discard-roll',
              allyInstanceId,
              allyMind,
              threshold,
              allyOwnerPlayerIndex: defPlayerIndex,
              sourceItemInstanceId: item.instanceId,
            },
          });
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
    const withFetch = fireEndOfTurnFetchEffects(cleanedState);
    const withChecks = fireEndOfTurnCorruptionChecks(withFetch);
    const withRingTests = fireEndOfTurnGoldRingTests(withChecks);
    return {
      state: cleanupEmptyCompanies({
        ...withRingTests,
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
        hoardBountyAvailable: false,
        thoroughSearchAvailable: false,
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

