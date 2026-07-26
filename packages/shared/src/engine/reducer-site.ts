/**
 * @module reducer-site
 *
 * Site phase handlers for the game reducer. Covers company selection at sites,
 * entering sites, automatic attacks, on-guard reveals, resource play,
 * influence attempts, and site phase advancement.
 */

import type { GameState, PlayerState, CardInstanceId, CompanyId, CharacterInPlay, CardInstance, SitePhaseState, CombatState, OnGuardCard, GameAction, GameEffect, PlayerId, Company, AutomaticAttack, TwoDiceSix } from '../index.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { formatSignedNumber } from '../format-helpers.js';
import { getPlayerIndex, requirePhaseState } from '../state-utils.js';
import { isCharacterCard, isItemCard, isAllyCard, isFactionCard, isSiteCard, isResourceEventCard } from '../types/cards.js';
import { CardStatus, Race, Alignment } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { logDetail } from './legal-actions/log.js';
import { buildBearerContext, collectCharacterEffects, collectCompanyAllyEffects, resolveCheckModifier, resolveAutoInfluenceFaction, resolveStatModifiers, resolveAttackProwess, resolveAttackStrikes, resolveAttackBody, normalizeCreatureRace, applyWardToBearer } from './effects/index.js';
import type { ResolverContext } from './effects/index.js';
import { allyEffectiveMind } from './ally-stats.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { matchesContext } from '../effects/index.js';
import { initiateChain } from './chain-reducer.js';
import { availableDI } from './legal-actions/organization.js';
import { crossAlignmentInfluencePenalty } from '../alignment-rules.js';
import type { ReducerResult } from './reducer-utils.js';
import { controlCostOf } from './control-cost.js';
import { gateDeckSearchFetch, hasSiteFlag, makeCombatState, canAttackAlignment, cvccAttackPermitted, siteDeniesCompanyAttack, cardName, characterEntries, cleanupEmptyCompanies, clonePlayers, collectFactionInfluenceRestriction, collectPlayerInPlayInfluenceEffects, collectGlobalCheckModifier, defById, diceRollEffect, effectiveGeneralInfluence, generalInfluenceControlLimit, findById, findCharacterCompany, getCardEffects, getOnEventEffects, isSelfDiscardMove, getOpponentInfluenceOverride, generalInfluenceSubstitutionValue, companySiteRegion, factionPlayableSiteRegions, influenceRegionPenalty, hazardPlayer, isCovertCompany, leaderControlEligibility, parseHomesiteNames, playerById, playerConvertsDetainmentToNormal, playedAfterFactionMpPin, siteTypeForcesAutoAttacksNormal, siteLockAntiMinion, siteFactionInfluenceModifier, findAttachment, updateAttachment, removeAttachment, removeById, rescuablePrisonersAtSite, roll2d6, siteHasTechnologyItemUnlock, sweepCompanyMembershipChangedEvents, sweepLeaderLeavesCompanyEvents, toCardInstance, updatePlayer, wrongActionType, playerWizardName } from './reducer-utils.js';
import { handlePlayPermanentEvent, handlePlayResourceShortEvent, handlePlayShortEvent, dispatchShortEventByCardType } from './reducer-events.js';
import { goldRingAutoTestModifier, goldRingAutoTestSiteName, handlePlayCharacter, handleManifestationSwap, handleDiscardToRecruit } from './reducer-organization.js';
import { handleGrantActionApply } from './grant-action-apply.js';
import { resolveInstanceId, ownerOf } from '../types/state.js';
import { shuffle } from '../rng.js';
import { buildInPlayNames, buildControllerInPlayNames, buildControllerFactionRaces, buildFactionPlayableAt, buildFactionPlayableRegions } from './recompute-derived.js';
import { sweepExpired, enqueueResolution, removeConstraint, enqueueCorruptionCheck, addConstraint } from './pending.js';
import { resolveEffective, getEffectiveSiteType, siteAutoAttacksForcedDetainment, siteAttacksCanceled } from './effective.js';
import { getActiveAutoAttacks, isReduceAttacksToOneInPlay } from './manifestations.js';
import { isDetainmentAttack } from './detainment.js';
import { moveToFetchToDeckPayload } from './reducer-move.js';
import { fireStageCardPlayedTriggers } from './stage-card-played.js';
import type { AgentAttackModifierEffect, MoveEffect, SitePhaseRingAutoTestSiteRule } from '../types/effects.js';
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
  'troll-purse-attacks': handleSiteTrollPurseAttacks,
  'rescue-attacks': handleSiteRescueAttacks,
  'declare-agent-attack': handleDeclareAgentAttack,
  'resolve-attacks': handleSiteResolveAttacks,
  'play-resources': handleSitePlayResources,
  'declare-company-attack': handleDeclareCompanyAttack,
  // TODO: play-minor-item
};

export function handleSite(state: GameState, action: GameAction): ReducerResult {
  const siteState = requirePhaseState(state, Phase.Site);
  const handler = SITE_STEP_HANDLERS[siteState.step];
  if (handler) {
    const result = handler(state, action, siteState);
    // Chains and pending resolutions open short-event response windows in
    // every step; if a rigid step handler rejected one, fall back to the
    // shared by-card-type dispatch so an advertised action is never refused.
    if (result.error && action.type === 'play-short-event') {
      logDetail(`Site step '${siteState.step}' rejected play-short-event (${result.error}) — dispatching via shared short-event flow`);
      return dispatchShortEventByCardType(state, action);
    }
    return result;
  }

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
    const char = actorPlayer.characters[charInstId];
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

  const siteDef = state.cardPool[company.currentSite.definitionId];
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
      const def = result.cardPool[card.definitionId];
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
  // Rule 2.1.1: the resource player may play resource short-events during any
  // phase of their turn, including the select-company step (before any company
  // has been selected). `siteActions` offers these plays here, so the reducer
  // must accept them — otherwise the engine rejects an action it advertised as
  // legal, leaving a client (or AI) with no state update and stuck. The event
  // resolves without changing the site step, so the player then selects a
  // company as normal.
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }

  // Pass is only offered (and only accepted) when no unhandled company is
  // left to select — every remaining company dissolved mid-phase (e.g. its
  // last character died to a corruption check), so nothing can advance the
  // phase through the normal per-company flow.
  if (action.type === 'pass') {
    const player = playerById(state, state.activePlayer)!;
    const handledSet = new Set(siteState.handledCompanyIds);
    const unhandled = player.companies.filter(c => !handledSet.has(c.id));
    if (unhandled.length > 0) {
      return { state, error: 'Cannot pass the site phase while companies remain unhandled' };
    }
    logDetail('Site: no companies left to select → ending site phase');
    return endSitePhase(state);
  }

  // Granted-action activation (e.g. River: ranger taps to cancel
  // site-phase-do-nothing). The constraint pass-through offers these in
  // every step, so every step handler must route them — mirror of the
  // enter-or-skip handler above (engine gap class: an offered action must
  // never be rejected by the reducer).
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }

  if (action.type !== 'select-company') {
    return wrongActionType(state, action, 'select-company', 'select-company step');
  }

  const player = playerById(state, state.activePlayer)!;
  const companyIndex = player.companies.findIndex(c => c.id === action.companyId);
  if (companyIndex === -1) return { state, error: 'Company not found' };
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
      // Framsburg (as-146): if the company's current site grants "first minor
      // item does not tap the site each turn", refresh the free-minor-item
      // allowance for this site phase.
      firstMinorItemNoTapAvailable: siteFirstMinorItemNoTap(state, company.currentSite),
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

  // Rule 2.1.1: resource short-events remain playable at the enter-or-skip
  // decision window (`siteActions` offers them here too). Accept them so the
  // engine never rejects an action it advertised as legal; the event resolves
  // without changing the step, leaving the enter-or-skip choice pending.
  if (action.type === 'play-short-event') {
    return handlePlayResourceShortEvent(state, action);
  }

  // The selected company may have dissolved before the enter-or-skip choice
  // (e.g. its last character died to an on-guard corruption check) — pass
  // finishes its slot.
  {
    const activeOwner = playerById(state, state.activePlayer)!;
    if (!activeOwner.companies[siteState.activeCompanyIndex] && action.type === 'pass') {
      logDetail('Site enter-or-skip: active company dissolved — finishing its site-phase slot');
      return finishDissolvedCompanySlot(state, siteState);
    }
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

  // Enter site — check whether the site has automatic-attacks. Attacks that
  // do not apply to this company's covert/overt status (e.g. Minas Tirith's
  // "against overt company only" Dúnedain attack vs a covert company) are not
  // counted, so a company facing none of them skips straight past the
  // auto-attack steps.
  const siteInPlay = company.currentSite;
  const siteDef = siteInPlay ? defById(state, siteInPlay.definitionId) : undefined;
  const enterCovert = isCovertCompany(company, player, state);
  const autoAttackCount = siteDef && isSiteCard(siteDef)
    ? getActiveAutoAttacks(state, siteDef, siteInPlay?.instanceId).filter(aa => autoAttackAppliesToCompany(aa, enterCovert)).length
    : 0;

  const skipAutoAttacks = hasSiteFlag(
    state.activeConstraints, 'skip-automatic-attacks', siteInPlay?.definitionId,
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
      && getActiveAutoAttacks(state, siteDef, company.currentSite?.instanceId).filter(aa =>
        autoAttackAppliesToCompany(aa, isCovertCompany(company, state.players[activePlayerIndex], state)),
      ).length > 1
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
    if (ogIdx === -1) return { state, error: 'On-guard card not found' };
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
    ? getActiveAutoAttacks(state, siteDef, company?.currentSite?.instanceId)
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
 * Returns whether a site automatic-attack is faced by a company of the given
 * covert/overt status (MELE site guardians). An attack restricted to one
 * status via {@link AutomaticAttack.appliesTo} (e.g. Minas Tirith le-391's
 * Dúnedain attack, "against overt company only") is faced only by companies of
 * that status; an attack without `appliesTo` is faced by every company. A
 * "detainment against covert company" attack deliberately has *no* `appliesTo`
 * — overt companies still face it (as a regular, non-detainment attack), and
 * its detainment-vs-covert nature is expressed by a separate `combat-detainment`
 * site effect gated on `defender.covert`.
 */
function autoAttackAppliesToCompany(aa: AutomaticAttack, covert: boolean): boolean {
  if (aa.appliesTo === 'covert') return covert;
  if (aa.appliesTo === 'overt') return !covert;
  return true;
}

/**
 * Handle the 'automatic-attacks' step: initiate combat for each automatic
 * attack listed on the site card, one at a time.
 *
 * When entering this step, if no combat is active, the next unresolved
 * automatic attack initiates combat. The `automaticAttacksResolved` counter
 * tracks progress. Attacks that do not apply to the defending company's
 * covert/overt status are skipped without initiating combat. When all
 * applicable auto-attacks are resolved, advances to 'declare-agent-attack'.
 */
function handleSiteAutomaticAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  // A chain response may arrive during the automatic-attacks step (e.g. a
  // hazard short event answering a declared effect while an auto-attack
  // chain is open). Dispatch it like the organization phase does: resource
  // events through the resource flow, everything else through the
  // chain/hazard short-event flow.
  if (action.type === 'play-short-event') {
    const player = playerById(state, action.player);
    const card = action.cardInstanceId ? player?.hand.find(c => c.instanceId === action.cardInstanceId) : undefined;
    const def = card ? defById(state, card.definitionId) : undefined;
    return isResourceEventCard(def)
      ? handlePlayResourceShortEvent(state, action)
      : handlePlayShortEvent(state, action);
  }

  if (action.type !== 'pass' && action.type !== 'cancel-auto-attack') {
    return { state, error: `Expected 'pass' during automatic-attacks step` };
  }

  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];

  // The company may have dissolved mid-sequence (e.g. every character died
  // to an earlier automatic attack). Remaining attacks are moot — finish
  // this company's site-phase slot and move on.
  if (!company) {
    logDetail('Site automatic-attacks: active company dissolved — finishing its site-phase slot');
    return finishDissolvedCompanySlot(state, siteState);
  }

  const siteDef = state.cardPool[company.currentSite!.definitionId] as import('../types/cards.js').SiteCard;

  const attackIndex = siteState.automaticAttacksResolved;
  const autoAttacks = getActiveAutoAttacks(state, siteDef, company.currentSite!.instanceId);

  // Covert/overt status of the defending company (MELE site guardians). It
  // selects which auto-attacks apply (see autoAttackAppliesToCompany) and is
  // threaded into detainment computation so a "detainment against covert
  // company" site effect fires only against a covert company.
  const defendingCovert = isCovertCompany(company, state.players[activePlayerIndex], state);

  // Effective site type and forced-detainment flag, honoring any
  // site-transforming constraint bound to this site's definition id (Hold
  // Rebuilt and Repaired, as-88: the Ruins & Lairs becomes a Shadow-hold and
  // all automatic-attacks become detainment). The effective type drives the
  // standard detainment keying (§3.II.2.R1/B1); the forced flag overrides
  // detainment unconditionally for every alignment.
  const siteDefIdForAttacks = company.currentSite!.definitionId;
  const effectiveSiteType = getEffectiveSiteType(state, siteDefIdForAttacks, siteDef.siteType, company.currentSite!.instanceId);
  const forcedDetainment = siteAutoAttacksForcedDetainment(state, siteDefIdForAttacks);
  // Alatar wh-1: above 7 stage points, all detainment attacks against this
  // player's companies become normal — overriding even site-forced detainment.
  // Awaken Defenders le-103: an in-play long-event makes every automatic-attack
  // at this site type (Free-hold / Border-hold) resolve as a normal attack.
  // No Strangers at this Time (as-51): a bound `site-lock` with
  // `convertDetainmentVsMinion` makes the site's detainment attacks resolve
  // normally against a minion (Ringwraith) company.
  // Any source forces the site's automatic-attacks to be non-detainment.
  const antiMinionLock = siteLockAntiMinion(state, siteDefIdForAttacks);
  const defenderIsMinion = state.players[activePlayerIndex].alignment === Alignment.Ringwraith;
  const forcesNormalAttacks = playerConvertsDetainmentToNormal(state, state.players[activePlayerIndex])
    || siteTypeForcesAutoAttacksNormal(state, effectiveSiteType)
    || (defenderIsMinion && antiMinionLock.convertDetainment);

  // Advance past attacks that do not apply to this company's covert/overt
  // status (e.g. Minas Tirith's Dúnedain attack, "against overt company
  // only"). Indices into `autoAttacks` are preserved so combat.attackSource
  // still references the printed attack list correctly.
  const forewarnedIdx = siteState.selectedAutoAttackIndex;
  let resolveIdx = attackIndex;
  if (forewarnedIdx === undefined) {
    while (resolveIdx < autoAttacks.length
      && !autoAttackAppliesToCompany(autoAttacks[resolveIdx], defendingCovert)) {
      logDetail(`Site: skipping automatic-attack ${resolveIdx + 1}/${autoAttacks.length} (${autoAttacks[resolveIdx].creatureType}, against ${autoAttacks[resolveIdx].appliesTo} company only) — company is ${defendingCovert ? 'covert' : 'overt'}`);
      resolveIdx++;
    }
  }

  // CRF Site Phase / Automatic-attacks: "Any character may tap to cancel one
  // automatic-attack at his home site" if the home site is named. The
  // canceled attack still counts as faced — advance past it exactly like a
  // resolved attack, without initiating combat. Not offered for Forewarned's
  // single fixed selection (see legal-actions/site.ts).
  if (action.type === 'cancel-auto-attack') {
    if (forewarnedIdx !== undefined || resolveIdx >= autoAttacks.length) {
      return { state, error: `No automatic-attack left to cancel` };
    }
    const char = state.players[activePlayerIndex].characters[action.characterId];
    const charDef = char ? defById(state, char.definitionId) : undefined;
    if (!char || !charDef || !isCharacterCard(charDef)) {
      return { state, error: `${action.characterId} is not a character` };
    }
    if (char.status !== CardStatus.Untapped) {
      return { state, error: `${charDef.name} must be untapped to cancel an automatic-attack` };
    }
    if (!company.characters.includes(action.characterId)) {
      return { state, error: `${charDef.name} is not in the active company` };
    }
    if (!parseHomesiteNames(charDef.homesite ?? '').includes(siteDef.name)) {
      return { state, error: `${charDef.name}'s home site does not include "${siteDef.name}"` };
    }
    logDetail(`Site: ${charDef.name} taps to cancel automatic-attack ${resolveIdx + 1}/${autoAttacks.length} (${autoAttacks[resolveIdx].creatureType}) at home site "${siteDef.name}"`);
    return {
      state: {
        ...updatePlayer(state, activePlayerIndex, p => ({
          ...p,
          characters: { ...p.characters, [action.characterId]: { ...char, status: CardStatus.Tapped } },
        })),
        phaseState: { ...siteState, automaticAttacksResolved: resolveIdx + 1 },
      },
    };
  }

  // When Forewarned Is Forearmed selected a single attack, only that attack
  // is resolved; consider done after 1 attack (not after all autoAttacks.length).
  const allAttacksDone = forewarnedIdx !== undefined
    ? attackIndex >= 1
    : resolveIdx >= autoAttacks.length;

  // In the done-branch, treat skipped trailing attacks as resolved so the
  // duplicate-counting math (`effectiveResolved - autoAttacks.length`) holds.
  const effectiveResolved = forewarnedIdx !== undefined ? attackIndex : resolveIdx;

  if (allAttacksDone) {
    // Check for auto-attack-race-duplicate constraints (The Moon Is Dead).
    // Each matching auto-attack at the site must be faced a second time.
    // duplicatesRun = attackIndex - autoAttacks.length counts how many
    // race-based duplicates have already been initiated this site phase.
    const raceDupRaces = new Set<Race>();
    for (const c of state.activeConstraints) {
      if (c.kind.type === 'auto-attack-race-duplicate') {
        raceDupRaces.add(c.kind.race);
      }
    }
    if (raceDupRaces.size > 0) {
      const duplicatableAttacks = autoAttacks.filter(aa => {
        const aaRace = normalizeCreatureRace(aa.creatureType);
        return aaRace !== undefined && raceDupRaces.has(aaRace);
      });
      const duplicatesRun = effectiveResolved - autoAttacks.length;
      if (duplicatesRun < duplicatableAttacks.length) {
        const aa = duplicatableAttacks[duplicatesRun];
        const dupRace = normalizeCreatureRace(aa.creatureType);
        const inPlayNamesR = buildInPlayNames(state);
        const dupBoostCtxR = { companyId: company.id };
        const dupProwessR = resolveAttackProwess(state, aa.prowess, inPlayNamesR, dupRace, true, undefined, dupBoostCtxR);
        const dupStrikesR = resolveAttackStrikes(state, aa.strikes, inPlayNamesR, dupRace, true, dupBoostCtxR, effectiveSiteType);
        const dupBodyR = resolveAttackBody(state, aa.body ?? null, inPlayNamesR, dupRace, dupBoostCtxR);
        logDetail(`Site: duplicating ${aa.creatureType} auto-attack (The Moon Is Dead): ${dupStrikesR} strikes, ${dupProwessR} prowess`);
        const dupDetainmentR = (!forcesNormalAttacks && (forcedDetainment || aa.forceDetainment === true || aa.detainmentAgainstPlayer === state.activePlayer)) || isDetainmentAttack({
          attackEffects: siteDef.effects,
          attackRace: dupRace ?? null,
          defendingAlignment: state.players[activePlayerIndex].alignment,
          defendingCovert,
          defendingSiteEffects: siteDef.effects,
          isAutomaticAttack: true,
          defenderForcesNormalAttacks: forcesNormalAttacks,
        });
        const dupCombatR: CombatState = makeCombatState({
          attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: effectiveResolved },
          companyId: company.id,
          defendingPlayerId: state.activePlayer!,
          attackingPlayerId: hazardPlayer(state).id,
          strikesTotal: dupStrikesR,
          strikeProwess: dupProwessR,
          creatureBody: dupBodyR,
          creatureRace: dupRace,
          assignmentPhase: 'defender',
          detainment: dupDetainmentR,
          ...(aa.combatRules?.includes('attacker-chooses-defenders') ? { attackerChoosesDefenders: true } : {}),
        });
        return {
          state: {
            ...state,
            combat: dupCombatR,
            phaseState: { ...siteState, automaticAttacksResolved: effectiveResolved + 1 },
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
      const dupStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames2, creatureRace2, true, dupBoostCtx, effectiveSiteType);
      const dupBody = resolveAttackBody(state, aa.body ?? null, inPlayNames2, creatureRace2, dupBoostCtx);
      logDetail(`Site: initiating duplicate automatic attack (Incite Defenders): ${aa.creatureType} (${dupStrikes} strikes, ${dupProwess} prowess)`);
      const dupState = removeConstraint(state, dupConstraint.id);
      const dupDetainment = (!forcesNormalAttacks && (forcedDetainment || aa.forceDetainment === true || aa.detainmentAgainstPlayer === state.activePlayer)) || isDetainmentAttack({
        attackEffects: siteDef.effects,
        attackRace: creatureRace2 ?? null,
        defendingAlignment: state.players[activePlayerIndex].alignment,
        defendingCovert,
        defendingSiteEffects: siteDef.effects,
        isAutomaticAttack: true,
        defenderForcesNormalAttacks: forcesNormalAttacks,
      });
      const dupCombat: CombatState = makeCombatState({
        attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: effectiveResolved },
        companyId: company.id,
        defendingPlayerId: state.activePlayer!,
        attackingPlayerId: hazardPlayer(state).id,
        strikesTotal: dupStrikes,
        strikeProwess: dupProwess,
        creatureBody: dupBody,
        creatureRace: creatureRace2,
        assignmentPhase: 'defender',
        detainment: dupDetainment,
        ...(aa.combatRules?.includes('attacker-chooses-defenders') ? { attackerChoosesDefenders: true } : {}),
      });
      return {
        state: {
          ...dupState,
          combat: dupCombat,
          phaseState: { ...siteState, automaticAttacksResolved: effectiveResolved + 1 },
        },
      };
    }

    // No Strangers at this Time (as-51): a bound `site-lock` with
    // `duplicateFirstAutoAttackVsMinion` gives every version of the site one
    // additional automatic-attack against a minion (Ringwraith) company — an
    // exact copy of the first automatic-attack listed on the site card. The
    // copy re-resolves through `resolveAttack*`, so its runtime modifications
    // ("including all modifications") are re-applied. Faced exactly once
    // (guarded by `siteLockMinionAttackDone`), after every printed attack and
    // any race/incite duplicates.
    if (!siteState.siteLockMinionAttackDone
      && defenderIsMinion
      && antiMinionLock.duplicateFirstAutoAttack
      && autoAttacks.length > 0) {
      const aa = autoAttacks[0];
      const inPlayNamesM = buildInPlayNames(state);
      const creatureRaceM = normalizeCreatureRace(aa.creatureType);
      const dupBoostCtxM = { companyId: company.id };
      const dupProwessM = resolveAttackProwess(state, aa.prowess, inPlayNamesM, creatureRaceM, true, undefined, dupBoostCtxM);
      const dupStrikesM = resolveAttackStrikes(state, aa.strikes, inPlayNamesM, creatureRaceM, true, dupBoostCtxM, effectiveSiteType);
      const dupBodyM = resolveAttackBody(state, aa.body ?? null, inPlayNamesM, creatureRaceM, dupBoostCtxM);
      logDetail(`Site: initiating minion-only additional automatic-attack (No Strangers at this Time): ${aa.creatureType} (${dupStrikesM} strikes, ${dupProwessM} prowess)`);
      const dupDetainmentM = (!forcesNormalAttacks && (forcedDetainment || aa.forceDetainment === true || aa.detainmentAgainstPlayer === state.activePlayer)) || isDetainmentAttack({
        attackEffects: siteDef.effects,
        attackRace: creatureRaceM ?? null,
        attackKeyedTo: [{ siteTypes: [effectiveSiteType] }],
        defendingAlignment: state.players[activePlayerIndex].alignment,
        defendingCovert,
        defendingSiteEffects: siteDef.effects,
        isAutomaticAttack: true,
        defenderForcesNormalAttacks: forcesNormalAttacks,
      });
      const dupCombatM: CombatState = makeCombatState({
        attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex: effectiveResolved },
        companyId: company.id,
        defendingPlayerId: state.activePlayer!,
        attackingPlayerId: hazardPlayer(state).id,
        strikesTotal: dupStrikesM,
        strikeProwess: dupProwessM,
        creatureBody: dupBodyM,
        creatureRace: creatureRaceM,
        assignmentPhase: 'defender',
        detainment: dupDetainmentM,
        ...(aa.combatRules?.includes('attacker-chooses-defenders') ? { attackerChoosesDefenders: true } : {}),
        ...(aa.combatRules?.includes('cannot-be-canceled') ? { uncancelable: true } : {}),
        ...(aa.combatRules?.includes('wound-eliminates') ? { woundEliminates: true } : {}),
        ...(aa.combatRules?.includes('weapons-ineffective') ? { weaponsIneffective: true } : {}),
      });
      return {
        state: {
          ...state,
          combat: dupCombatM,
          phaseState: { ...siteState, automaticAttacksResolved: effectiveResolved + 1, siteLockMinionAttackDone: true },
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

  // Initiate combat for the next applicable automatic attack (or the
  // Forewarned-selected one). `resolveIdx` has already advanced past any
  // attacks that do not apply to this company's covert/overt status.
  const resolvedAttackIndex = forewarnedIdx !== undefined ? forewarnedIdx : resolveIdx;
  const aa = autoAttacks[resolvedAttackIndex];
  const hazardPlayerId = hazardPlayer(state).id;

  const inPlayNames = buildInPlayNames(state);
  const creatureRace = normalizeCreatureRace(aa.creatureType);
  const aaBoostCtx = { companyId: company.id };
  const baseEffective = resolveAttackProwess(state, aa.prowess, inPlayNames, creatureRace, true, undefined, aaBoostCtx);
  const effectiveStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames, creatureRace, true, aaBoostCtx, effectiveSiteType);
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
  let effectiveProwess = boost.value;
  if (boost.consumedIds.length > 0) {
    for (const id of boost.consumedIds) {
      const src = state.activeConstraints.find(c => c.id === id);
      if (src) logDetail(`Site: consuming attribute-modifier (auto-attack.prowess +${boost.value - baseEffective}) from "${cardName(state, src.sourceDefinitionId, '?')}"`);
      boostedState = removeConstraint(boostedState, id);
    }
  }

  // Arouse Defenders (le-101): a single-use `auto-attack-boost` constraint on
  // this company boosts the prowess of one automatic-attack (the first faced)
  // and can make it uncancelable. Consume the first matching constraint.
  let arouseUncancelable = false;
  const arouseBoost = boostedState.activeConstraints.find(
    c => c.target.kind === 'company'
      && c.target.companyId === company.id
      && c.kind.type === 'auto-attack-boost',
  );
  if (arouseBoost && arouseBoost.kind.type === 'auto-attack-boost') {
    effectiveProwess += arouseBoost.kind.prowessBonus;
    arouseUncancelable = arouseBoost.kind.uncancelable;
    logDetail(`Site: consuming auto-attack-boost (+${arouseBoost.kind.prowessBonus} prowess${arouseBoost.kind.uncancelable ? ', cannot be canceled' : ''}) from "${cardName(state, arouseBoost.sourceDefinitionId, '?')}"`);
    boostedState = removeConstraint(boostedState, arouseBoost.id);
  }

  const isEachCharacter = aa.combatRules?.includes('each-character') ?? false;
  // "each character faces 1 strike": total = company size, strikes pre-assigned one per character.
  const preAssignedStrikes: StrikeAssignment[] = isEachCharacter
    ? company.characters.map(charId => ({ characterId: charId, excessStrikes: 0, resolved: false }))
    : [];
  const strikesTotalValue = isEachCharacter ? company.characters.length : effectiveStrikes;

  logDetail(`Site: initiating automatic attack ${resolvedAttackIndex + 1}/${autoAttacks.length}: ${aa.creatureType} (${aa.strikes} strikes${effectiveStrikes !== aa.strikes ? ` → ${effectiveStrikes}` : ''}, ${aa.prowess} prowess${effectiveProwess !== aa.prowess ? ` → ${effectiveProwess}` : ''}${effectiveStrikes !== aa.strikes || effectiveProwess !== aa.prowess ? ' after global effects' : ''}${isEachCharacter ? `, each-character mode → ${strikesTotalValue} total pre-assigned` : ''})`);

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
    // `aa.forceDetainment` is set on runtime-injected attacks with no race/keying
    // (FEAR! FIRE! FOES! as-29 Mode A), for which the §3.II derivation cannot
    // apply — still overridden to normal when the defender forces normal attacks.
    detainment: (!forcesNormalAttacks && (forcedDetainment || aa.forceDetainment === true || aa.detainmentAgainstPlayer === state.activePlayer)) || isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: creatureRace ?? null,
      // Site auto-attacks are implicitly "keyed to" the site's type (§3.II.2.R1/B1).
      // The effective type honors any site-type override (e.g. Hold Rebuilt and
      // Repaired turning a Ruins & Lairs into a Shadow-hold) so the standard
      // detainment rules fire correctly for Ringwraith/Balrog companies.
      attackKeyedTo: [{ siteTypes: [effectiveSiteType] }],
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defendingCovert,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
      defenderForcesNormalAttacks: forcesNormalAttacks,
    }),
    ...(forewarnedIdx !== undefined ? { isolated: true, uncancelable: true } : {}),
    // "cannot be canceled" (Vile Fumes' Gas wh-54, Shelob's Lair le-402)
    // suppresses cancel-attack actions; "wound-eliminates" upgrades any wound
    // dealt by this attack into immediate elimination. Arouse Defenders
    // (le-101) makes its boosted attack uncancelable via `arouseUncancelable`.
    ...((aa.combatRules?.includes('cannot-be-canceled') || arouseUncancelable) ? { uncancelable: true } : {}),
    ...(aa.combatRules?.includes('wound-eliminates') ? { woundEliminates: true } : {}),
    ...(aa.combatRules?.includes('weapons-ineffective') ? { weaponsIneffective: true } : {}),
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
      phaseState: { ...siteState, automaticAttacksResolved: effectiveResolved + 1 },
    },
  };
}

/**
 * Build the combat state for re-facing one of the site's automatic-attacks,
 * shared by the Troll-purse (dm-95) item-trap re-face and the prisoner-rescue
 * (rule 8.36) rescue-attack. Mirrors the normal site auto-attack combat
 * construction (detainment keying, each-character, attacker-chooses,
 * cannot-be-canceled, wound-eliminates).
 *
 * `opts.prowessBonus` adds to the attack's prowess (Troll-purse: +3; rescue: 0).
 * `opts.trollPursePrisoner`, when set, flags the combat so a successful strike
 * takes the character prisoner at the site instead of wounding (handled in
 * `reducer-combat.ts` `resolveStrike`). `opts.protectedFromStrikeAssignment`
 * excludes those characters from being assigned strikes (held prisoners during
 * a rescue-attack are captive, not fighting).
 */
function buildSiteRepeatedAttackCombat(
  state: GameState,
  company: Company,
  siteDef: import('../types/cards.js').SiteCard,
  aa: AutomaticAttack,
  attackIndex: number,
  opts: {
    prowessBonus: number;
    trollPursePrisoner?: { hostInstanceId: CardInstanceId; siteInstanceId: CardInstanceId };
    protectedFromStrikeAssignment?: readonly CardInstanceId[];
  },
): CombatState {
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const defendingCovert = isCovertCompany(company, state.players[activePlayerIndex], state);
  const siteDefId = company.currentSite!.definitionId;
  const effectiveSiteType = getEffectiveSiteType(state, siteDefId, siteDef.siteType, company.currentSite!.instanceId);
  const forcedDetainment = siteAutoAttacksForcedDetainment(state, siteDefId);
  const forcesNormalAttacks = playerConvertsDetainmentToNormal(state, state.players[activePlayerIndex])
    || siteTypeForcesAutoAttacksNormal(state, effectiveSiteType);
  const inPlayNames = buildInPlayNames(state);
  const creatureRace = normalizeCreatureRace(aa.creatureType);
  const boostCtx = { companyId: company.id };
  const baseProwess = resolveAttackProwess(state, aa.prowess, inPlayNames, creatureRace, true, undefined, boostCtx);
  const effectiveProwess = baseProwess + opts.prowessBonus;
  const effectiveStrikes = resolveAttackStrikes(state, aa.strikes, inPlayNames, creatureRace, true, boostCtx, effectiveSiteType);
  const effectiveBody = resolveAttackBody(state, aa.body ?? null, inPlayNames, creatureRace, boostCtx);
  const isEachCharacter = aa.combatRules?.includes('each-character') ?? false;
  const aaAttackerChooses = aa.combatRules?.includes('attacker-chooses-defenders') ?? false;
  const protectedSet = new Set((opts.protectedFromStrikeAssignment ?? []).map(id => id as string));
  // For each-character, only non-protected characters face a strike.
  const facingChars = company.characters.filter(id => !protectedSet.has(id as string));
  const preAssignedStrikes: StrikeAssignment[] = isEachCharacter
    ? facingChars.map(charId => ({ characterId: charId, excessStrikes: 0, resolved: false }))
    : [];
  const strikesTotalValue = isEachCharacter ? facingChars.length : effectiveStrikes;
  const detainment = (!forcesNormalAttacks && (forcedDetainment || aa.forceDetainment === true || aa.detainmentAgainstPlayer === state.activePlayer)) || isDetainmentAttack({
    attackEffects: siteDef.effects,
    attackRace: creatureRace ?? null,
    attackKeyedTo: [{ siteTypes: [effectiveSiteType] }],
    defendingAlignment: state.players[activePlayerIndex].alignment,
    defendingCovert,
    defendingSiteEffects: siteDef.effects,
    isAutomaticAttack: true,
    defenderForcesNormalAttacks: forcesNormalAttacks,
  });
  const base: CombatState = {
    attackSource: { type: 'automatic-attack', siteInstanceId: company.currentSite!.instanceId, attackIndex },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer(state).id,
    strikesTotal: strikesTotalValue,
    strikeProwess: effectiveProwess,
    creatureBody: effectiveBody,
    creatureRace,
    strikeAssignments: preAssignedStrikes,
    currentStrikeIndex: 0,
    phase: isEachCharacter ? 'resolve-strike' : 'assign-strikes',
    assignmentPhase: isEachCharacter ? 'done' : (aaAttackerChooses ? 'cancel-window' : 'defender'),
    bodyCheckTarget: null,
    detainment,
    ...(opts.trollPursePrisoner ? { trollPursePrisoner: opts.trollPursePrisoner } : {}),
    ...(protectedSet.size > 0 ? { protectedFromStrikeAssignment: [...protectedSet] as CardInstanceId[] } : {}),
    ...(aaAttackerChooses ? { attackerChoosesDefenders: true } : {}),
    ...(aa.combatRules?.includes('cannot-be-canceled') ? { uncancelable: true } : {}),
    ...(aa.combatRules?.includes('wound-eliminates') ? { woundEliminates: true } : {}),
    ...(aa.combatRules?.includes('weapons-ineffective') ? { weaponsIneffective: true } : {}),
    ...(isEachCharacter ? { eachCharacterFacesOneStrike: true } : {}),
  };
  if (isEachCharacter && preAssignedStrikes.length > 1) {
    return { ...base, phase: 'choose-strike-order', currentStrikeIndex: 0, bodyCheckTarget: null };
  }
  if (isEachCharacter && preAssignedStrikes.length === 1) {
    return { ...base, phase: 'resolve-strike', currentStrikeIndex: 0, attackerStep1Done: false, bodyCheckTarget: null };
  }
  return base;
}

/**
 * Troll-purse (dm-95): when an item is played at a site bearing an opponent's
 * Troll-purse, the company must face all the site's automatic-attacks again.
 * If such a trap exists at the active company's site, initiate the first
 * re-faced attack and enter the `troll-purse-attacks` site sub-step; the rest
 * are sequenced by {@link handleSiteTrollPurseAttacks}. Returns null if no
 * trap is bound to the company's current site.
 */
function maybeTriggerSiteItemTrap(
  state: GameState,
  playerIndex: number,
  companyIndex: number,
): GameState | null {
  const player = state.players[playerIndex];
  const company = player.companies[companyIndex];
  if (!company?.currentSite) return null;
  const siteDefId = company.currentSite.definitionId;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef)) return null;
  const autoAttacks = getActiveAutoAttacks(state, siteDef, company.currentSite.instanceId);
  if (autoAttacks.length === 0) return null;

  // Find an opponent's Troll-purse attached to this site's location.
  const opponent = state.players[1 - playerIndex];
  let hostInstanceId: CardInstanceId | undefined;
  let prowessBonus = 0;
  for (const card of opponent.cardsInPlay) {
    if (card.attachedToSite !== siteDefId) continue;
    const def = defById(state, card.definitionId);
    const eff = getCardEffects(def).find(
      (e): e is import('../types/effects.js').SiteItemTrapEffect => e.type === 'site-item-trap',
    );
    if (eff) {
      hostInstanceId = card.instanceId;
      prowessBonus = eff.prowessBonus;
      break;
    }
  }
  if (!hostInstanceId) return null;

  logDetail(`Troll-purse: item played at ${siteDef.name} — company re-faces ${autoAttacks.length} automatic-attack(s) at +${prowessBonus} prowess`);
  const combat = buildSiteRepeatedAttackCombat(state, company, siteDef, autoAttacks[0], 0, {
    prowessBonus,
    trollPursePrisoner: { hostInstanceId, siteInstanceId: company.currentSite.instanceId },
  });
  const siteState = requirePhaseState(state, Phase.Site);
  return {
    ...state,
    combat,
    phaseState: {
      ...siteState,
      step: 'troll-purse-attacks' as const,
      trollPurseReface: { hostInstanceId, prowessBonus, resolved: 1 },
    },
  };
}

/**
 * Handle the 'troll-purse-attacks' step: sequence the remaining re-faced
 * automatic-attacks (Troll-purse dm-95). Each `pass` initiates the next
 * re-faced attack; once all of the site's automatic-attacks have been
 * re-faced, control returns to the 'play-resources' step so the resource
 * player may continue playing resources.
 */
function handleSiteTrollPurseAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during troll-purse-attacks step` };
  }
  const reface = siteState.trollPurseReface;
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  const autoAttacks = siteDef && isSiteCard(siteDef) ? getActiveAutoAttacks(state, siteDef, company.currentSite?.instanceId) : [];

  if (!reface || reface.resolved >= autoAttacks.length) {
    logDetail('Troll-purse: all re-faced automatic-attacks resolved → play-resources');
    return {
      state: {
        ...state,
        phaseState: { ...siteState, step: 'play-resources' as const, trollPurseReface: undefined },
      },
    };
  }

  const aa = autoAttacks[reface.resolved];
  logDetail(`Troll-purse: re-facing automatic-attack ${reface.resolved + 1}/${autoAttacks.length} (+${reface.prowessBonus} prowess)`);
  const combat = buildSiteRepeatedAttackCombat(state, company, siteDef as import('../types/cards.js').SiteCard, aa, reface.resolved, {
    prowessBonus: reface.prowessBonus,
    trollPursePrisoner: { hostInstanceId: reface.hostInstanceId, siteInstanceId: company.currentSite!.instanceId },
  });
  return {
    state: {
      ...state,
      combat,
      phaseState: { ...siteState, trollPurseReface: { ...reface, resolved: reface.resolved + 1 } },
    },
  };
}

/**
 * The rescue-attack a company must face to rescue prisoners held by `host`
 * (CoE rule 8.36), expressed as a list of automatic-attack shapes:
 * - a `take-prisoner` host (e.g. Flies and Spiders dm-58) faces the effect's
 *   fixed `rescueAttacks` (race / strikes / prowess), at the rescue site drawn
 *   from the hazard player's location deck;
 * - a `site-item-trap` host (Troll-purse dm-95) faces the bound site's current
 *   automatic-attacks ("at the time of rescue"), i.e. the company's current
 *   site (which equals the host's rescue site).
 */
function rescueAttacksForHost(
  state: GameState,
  host: GameState['hazardHosts'][number],
  currentSiteDef: import('../types/cards.js').SiteCard | undefined,
): readonly AutomaticAttack[] {
  const hostDef = defById(state, host.hostCard.definitionId);
  for (const eff of getCardEffects(hostDef)) {
    if (eff.type === 'take-prisoner') {
      return eff.rescueAttacks.map(ra => ({ creatureType: ra.race, strikes: ra.strikes, prowess: ra.prowess }));
    }
  }
  return currentSiteDef && isSiteCard(currentSiteDef) ? getActiveAutoAttacks(state, currentSiteDef) : [];
}

/**
 * Free all prisoners held by `hostInstanceId`: remove their
 * `character-is-prisoner` constraints and drop them from the host's prisoner
 * list (removing the host record if it becomes empty). Used when a rescue-attack
 * has been faced (CoE rule 8.36). If the host card lives only in the host record
 * (i.e. it is not a permanent in `cardsInPlay`, e.g. Flies and Spiders dm-58),
 * it is discarded to its owner's pile when the record is dropped, so no instance
 * is lost. A site-bound trap (Troll-purse) stays in `cardsInPlay`.
 */
function freePrisonersOfHost(state: GameState, hostInstanceId: CardInstanceId): GameState {
  const host = state.hazardHosts.find(h => h.hostCard.instanceId === hostInstanceId);
  if (!host || host.prisoners.length === 0) return state;
  const freed = new Set(host.prisoners.map(p => p as string));
  logDetail(`Rescue: freeing ${host.prisoners.length} prisoner(s) held by ${hostInstanceId as string}`);
  const activeConstraints = state.activeConstraints.filter(c =>
    !(c.kind.type === 'character-is-prisoner'
      && c.kind.hostInstanceId === hostInstanceId
      && c.target.kind === 'character'
      && freed.has(c.target.characterId as string)),
  );
  // Drop the host record (no remaining prisoners).
  const hazardHosts = state.hazardHosts.filter(h => h.hostCard.instanceId !== hostInstanceId);
  let newState: GameState = { ...state, activeConstraints, hazardHosts };
  // If the host card lives only in the record (not a `cardsInPlay` permanent),
  // discard it to its owner so the instance is preserved.
  const hostInPlay = state.players.some(p => p.cardsInPlay.some(c => c.instanceId === hostInstanceId));
  if (!hostInPlay) {
    const ownerIdx = getPlayerIndex(state, host.ownedBy);
    logDetail(`Rescue: host ${hostInstanceId as string} discarded to ${state.players[ownerIdx].name}'s pile`);
    newState = updatePlayer(newState, ownerIdx, p => ({ ...p, discardPile: [...p.discardPile, host.hostCard] }));
  }
  return newState;
}

/**
 * Handle the 'rescue-attacks' step: sequence the rescue-attack (the site's
 * automatic-attacks, CoE rule 8.36). Each `pass` initiates the next
 * automatic-attack as a normal (wounding) attack with the held prisoners
 * protected from strike assignment; once all are faced the prisoners are freed
 * and control returns to 'play-resources'.
 */
function handleSiteRescueAttacks(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'pass') {
    return { state, error: `Expected 'pass' during rescue-attacks step` };
  }
  const rescue = siteState.rescueInProgress;
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
  const host = rescue ? state.hazardHosts.find(h => h.hostCard.instanceId === rescue.hostInstanceId) : undefined;
  const siteCardDef = siteDef && isSiteCard(siteDef) ? siteDef : undefined;
  const rescueAttacks = host ? rescueAttacksForHost(state, host, siteCardDef) : [];

  if (!rescue || rescue.resolved >= rescueAttacks.length) {
    const freedState = rescue ? freePrisonersOfHost(state, rescue.hostInstanceId) : state;
    logDetail('Rescue: rescue-attack faced — prisoners freed → play-resources');
    return {
      state: {
        ...freedState,
        phaseState: { ...siteState, step: 'play-resources' as const, rescueInProgress: undefined },
      },
    };
  }

  const protectedIds = host ? host.prisoners : [];
  const aa = rescueAttacks[rescue.resolved];
  logDetail(`Rescue: facing rescue-attack ${rescue.resolved + 1}/${rescueAttacks.length}`);
  const combat = buildSiteRepeatedAttackCombat(state, company, siteDef as import('../types/cards.js').SiteCard, aa, rescue.resolved, {
    prowessBonus: 0,
    protectedFromStrikeAssignment: protectedIds,
  });
  return {
    state: {
      ...state,
      combat,
      phaseState: { ...siteState, rescueInProgress: { ...rescue, resolved: rescue.resolved + 1 } },
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
  const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
  const isAtHome = currentSiteName !== undefined && homesiteNames.includes(currentSiteName);

  if (isWounded) prowess -= 2;
  if (isFaceDown && !isAtHome) prowess += 2;
  if (isFaceDown && isAtHome) { prowess += 5; body += 1; }
  if (!isFaceDown && isAtHome) { prowess += 2; body += 1; }

  // Rule 3.ii.4: face-down at home → attacker assigns strikes. An
  // `agent-attack-modifier` effect on the agent's card (Taladhan dm-25:
  // "chooses defending characters") grants attacker assignment regardless
  // of the agent's face-down/at-home state, and may substitute the strike
  // result (a successful strike forces an item discard instead of a wound).
  const attackModifier = getCardEffects(agentDef).find(
    (e): e is AgentAttackModifierEffect => e.type === 'agent-attack-modifier',
  );
  if (attackModifier) {
    logDetail(`Site: declare-agent-attack — "${agentDef.name}" has agent-attack-modifier (attackerAssigns: ${String(attackModifier.attackerAssigns ?? false)}, strikeEffect: ${attackModifier.strikeEffect ?? 'none'})`);
  }
  const attackerAssigns = (isFaceDown && isAtHome) || attackModifier?.attackerAssigns === true;

  // "Agent only: may tap for an extra strike" (Elerína dm-7): the declare
  // action may carry tapForExtraStrike — the agent taps as part of the
  // declaration and the attack has 2 strikes instead of 1.
  const tapForExtraStrike = action.tapForExtraStrike === true;
  if (tapForExtraStrike) {
    if (attackModifier?.tapForExtraStrike !== true) {
      return { state, error: `Agent "${agentDef.name}" has no tap-for-extra-strike ability` };
    }
    if (agent.character.status !== CardStatus.Untapped) {
      return { state, error: `Agent "${agentDef.name}" must be untapped to tap for an extra strike` };
    }
  }
  const strikesTotal = tapForExtraStrike ? 2 : 1;

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

  // Tap the agent when the extra strike was bought (tapForExtraStrike).
  if (tapForExtraStrike) {
    logDetail(`Site: declare-agent-attack — "${agentDef.name}" taps for an extra strike (2 strikes)`);
    stateAfterReveal = updatePlayer(stateAfterReveal, hazardPlayerIndex, p => ({
      ...p,
      agents: p.agents.map(a =>
        a.character.instanceId === action.agentInstanceId
          ? { ...a, character: { ...a.character, status: CardStatus.Tapped } }
          : a,
      ),
    }));
  }

  // Build CombatState with pre-computed modifiers. forceSingleTarget only
  // applies to the normal 1-strike agent attack — a 2-strike attack follows
  // the standard assignment rules (each strike to a different character
  // where possible), even when the attacker assigns.
  const combat: CombatState = makeCombatState({
    attackSource: { type: 'agent', instanceId: action.agentInstanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayer.id,
    strikesTotal,
    strikeProwess: prowess,
    creatureBody: body,
    assignmentPhase: attackerAssigns ? 'attacker' : 'defender',
    detainment,
    ...(attackerAssigns && strikesTotal === 1 ? { forceSingleTarget: true } : {}),
    ...(attackModifier?.strikeEffect ? { strikeEffect: attackModifier.strikeEffect } : {}),
  });

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
  const effectiveStrikes = resolveAttackStrikes(state, creatureDef.strikes, inPlayNames, creatureRace, false, sitePlayedBoostCtx);
  const effectiveSiteDynBody = resolveAttackBody(state, creatureDef.body, inPlayNames, creatureRace, sitePlayedBoostCtx);

  logDetail(`Site: hazard plays "${creatureDef.name}" as dynamic auto-attack (${effectiveStrikes} strikes, ${effectiveProwess} prowess) vs company ${company.id as string}`);

  const combat: CombatState = makeCombatState({
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
    assignmentPhase: 'defender',
    detainment: (() => {
      const dynSiteType = company.currentSite && siteDef && isSiteCard(siteDef)
        ? getEffectiveSiteType(state, company.currentSite.definitionId, siteDef.siteType, company.currentSite.instanceId)
        : undefined;
      const dynForcesNormal = playerConvertsDetainmentToNormal(state, state.players[activePlayerIndex])
        || (dynSiteType !== undefined && siteTypeForcesAutoAttacksNormal(state, dynSiteType));
      return (!dynForcesNormal && (company.currentSite ? siteAutoAttacksForcedDetainment(state, company.currentSite.definitionId) : false)) || isDetainmentAttack({
        attackEffects: creatureDef.effects,
        attackRace: creatureRace ?? null,
        attackKeyedTo: creatureDef.keyedTo,
        inPlayNames,
        defendingAlignment: state.players[activePlayerIndex].alignment,
        defendingSiteEffects: siteDef && isSiteCard(siteDef) ? siteDef.effects : undefined,
        isAutomaticAttack: true,
        defenderForcesNormalAttacks: dynForcesNormal,
      });
    })(),
  });

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

  // Hidden Haven (wh-75): "all attacks against it are canceled." If the company
  // occupies a site under a `cancel-attacks-at-site` constraint, every revealed
  // on-guard creature attack is canceled — the creature is discarded without
  // combat — and the step advances straight to play-resources.
  const cancelSiteDefId = company?.currentSite?.definitionId;
  if (company && cancelSiteDefId && siteAttacksCanceled(state, cancelSiteDefId)) {
    const canceled = company.onGuardCards.filter(og => {
      if (!og.revealed) return false;
      const def = defById(state, og.definitionId);
      return def?.cardType === 'hazard-creature';
    });
    if (canceled.length > 0) {
      logDetail(`Site: ${canceled.length} on-guard creature attack(s) canceled by Hidden Haven`);
      const remainingOnGuard = company.onGuardCards.filter(og => !canceled.includes(og));
      const newCompanies = [...state.players[activePlayerIndex].companies];
      newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: remainingOnGuard };
      let newState: GameState = updatePlayer(state, activePlayerIndex, p => ({ ...p, companies: newCompanies }));
      // A canceled attack creature is discarded to its owner (the hazard player).
      const hazardPlayerIndex = getPlayerIndex(newState, hazardPlayer(newState).id);
      newState = updatePlayer(newState, hazardPlayerIndex, p => ({
        ...p,
        discardPile: [...p.discardPile, ...canceled.map(c => toCardInstance(c))],
      }));
      return {
        state: { ...newState, phaseState: { ...siteState, step: 'play-resources' as const } },
      };
    }
  }

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

  const siteState = requirePhaseState(state, Phase.Site);
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIndex];
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];
  const ogIdx = company.onGuardCards.findIndex(c => c.instanceId === action.cardInstanceId);
  if (ogIdx === -1) return { state, error: 'On-guard card not found' };
  const revealedCard = company.onGuardCards[ogIdx];
  const def = defById(state, revealedCard.definitionId);
  logDetail(`Site: hazard player reveals on-guard event "${def?.name ?? revealedCard.definitionId}" in response to resource play`);

  // Remove from on-guard
  const newOnGuardCards = [...company.onGuardCards];
  newOnGuardCards.splice(ogIdx, 1);

  const newCompanies = [...resourcePlayer.companies];
  newCompanies[siteState.activeCompanyIndex] = { ...company, onGuardCards: newOnGuardCards };

  let newState: GameState = updatePlayer(state, activeIndex, p => ({ ...p, companies: newCompanies }));

  // Initiate a nested chain for the on-guard event (rule 2.V.6.1).
  // `fromOnGuard` marks the reveal origin so cancels that "cannot be used
  // against an on-guard card" (The Great Eye as-85) exclude this entry.
  const isPermanent = def && 'eventType' in def && def.eventType === 'permanent';
  const payload = isPermanent
    ? { type: 'permanent-event' as const, targetCharacterId: action.targetCharacterId, fromOnGuard: true }
    : { type: 'short-event' as const, fromOnGuard: true };
  const cardInstance: CardInstance = toCardInstance(revealedCard);

  // Revealed short events mirror hand-played ones: the card moves to its
  // owner's discard pile at reveal time and resolves off the chain (a
  // permanent event instead lands in play at resolution). Without this the
  // instance would vanish from state once the chain completes.
  if (!isPermanent) {
    const hazardIndex = getPlayerIndex(newState, action.player);
    newState = updatePlayer(newState, hazardIndex, p => ({
      ...p,
      discardPile: [...p.discardPile, cardInstance],
    }));
  }
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
  return handleSitePlayHeroResource(state, deferredAction, requirePhaseState(state, Phase.Site));
}

/**
 * Handle the Hermit's Hill special site grant-actions: the company discards
 * two minor items they bear to unlock item playability at the current
 * untapped site for the rest of this company's site phase. The hero version
 * (dm-32, `discard-minors-for-major`) unlocks major/hoard items via a
 * `major-item-unlocked` constraint; the minion version (le-382,
 * `discard-minors-for-gold-ring`, covert companies only) unlocks one gold
 * ring regardless of its text restrictions via `gold-ring-item-unlocked`.
 *
 * Locates both items by instance ID (`targetCardId` and `secondTargetCardId`),
 * detaches them from their bearers, moves them to the discard pile, then adds
 * the unlock constraint scoped to the company's site phase.
 */
function handleDiscardMinorsForUnlock(
  state: GameState,
  action: GameAction,
  siteState: SitePhaseState,
): ReducerResult {
  if (action.type !== 'activate-granted-action') return { state, error: 'Expected activate-granted-action' };
  if (!action.targetCardId || !action.secondTargetCardId) {
    return { state, error: `${action.actionId}: missing targetCardId or secondTargetCardId` };
  }

  const playerIndex = getPlayerIndex(state, action.player);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  const discardItemIds = [action.targetCardId, action.secondTargetCardId];
  let workingState = state;

  for (const itemId of discardItemIds) {
    const currentPlayer = workingState.players[playerIndex];
    const removed = removeAttachment(currentPlayer, 'items', itemId);
    if (!removed) {
      return { state, error: `${action.actionId}: item ${itemId as string} not found on any character` };
    }

    workingState = updatePlayer(workingState, playerIndex, () => ({
      ...removed.player,
      discardPile: [...removed.player.discardPile, toCardInstance(removed.attachment)],
    }));
    logDetail(`Site: ${action.actionId} discarded item ${itemId as string} from ${removed.charId as string}`);
  }

  // Add the unlock constraint scoped to this company's site phase
  const unlockKind = action.actionId === 'discard-minors-for-gold-ring'
    ? { type: 'gold-ring-item-unlocked' as const }
    : { type: 'major-item-unlocked' as const };
  const newState = addConstraint(workingState, {
    source: action.sourceCardId,
    sourceDefinitionId: action.sourceCardDefinitionId,
    scope: { kind: 'company-site-phase', companyId: company.id },
    target: { kind: 'company', companyId: company.id },
    kind: unlockKind,
  });

  logDetail(`Site: ${action.actionId} activated for company ${company.id as string} — ${unlockKind.type === 'gold-ring-item-unlocked' ? 'one gold ring now playable regardless of text restrictions' : 'major items now playable'}`);
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

  // The active company may have dissolved mid-site-phase (e.g. every
  // character died to an automatic-attack after entering) — mirror of the
  // enter-or-skip guard: pass finishes the dissolved company's slot.
  if (!company && action.type === 'pass') {
    logDetail('Site play-resources: active company dissolved — finishing its site-phase slot');
    return finishDissolvedCompanySlot(state, siteState);
  }

  // Character-recruitment event (A Chance Meeting tw-188): bring a character
  // into play during the site phase. Routed to the shared play-character
  // reducer, which discards the enabling event and skips the
  // one-character-per-turn bookkeeping.
  if (action.type === 'play-character' && action.viaEventInstanceId) {
    return handlePlayCharacter(state, action);
  }

  // Manifestation swap (Strider ba-1 → Aragorn II): a resource-style play,
  // available whenever a normal resource could be played (CRF 22).
  if (action.type === 'manifestation-swap') {
    return handleManifestationSwap(state, action);
  }

  // Discard-to-recruit (Folco Boffin dm-180): a resource-style replacement
  // play, available whenever a normal resource could be played (CRF 22).
  if (action.type === 'discard-to-recruit') {
    return handleDiscardToRecruit(state, action);
  }

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

  // Eddy in Fate's Tide (ba-57): tap one character toward the two-character tax
  // that gates ally/item play at any version of the bound site this site phase.
  if (action.type === 'pay-site-tax') {
    const char = player.characters[action.characterId];
    if (!char || char.status === CardStatus.Tapped) {
      return { state, error: 'pay-site-tax: character is not an untapped member' };
    }
    if (!company.characters.includes(action.characterId)) {
      return { state, error: 'pay-site-tax: character is not in the active company' };
    }
    const tappedSoFar = (siteState.eddyTaxTapped ?? 0) + 1;
    const charName = defById(state, char.definitionId)?.name ?? action.characterId;
    logDetail(`Site: paying Eddy in Fate's Tide tax — tapping ${charName} (${tappedSoFar} tapped this site phase)`);
    const taxPlayerIndex = getPlayerIndex(state, action.player);
    const afterTap = updatePlayer(state, taxPlayerIndex, p => ({
      ...p,
      characters: { ...p.characters, [action.characterId]: { ...char, status: CardStatus.Tapped } },
    }));
    return {
      state: {
        ...afterTap,
        phaseState: { ...siteState, eddyTaxTapped: tappedSoFar },
      },
    };
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
  // `company` may be undefined here: a chain-response short event from the
  // hazard player reaches this handler too, and their companies array does
  // not correspond to the active company index.
  if (action.type === 'play-short-event' && (company?.onGuardCards.length ?? 0) > 0) {
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
    // Hazard short events (chain responses played during the opponent's
    // site phase) must go through the hazard flow, not the resource flow.
    const shortHandCard = action.cardInstanceId ? player.hand.find(c => c.instanceId === action.cardInstanceId) : undefined;
    const shortEventDef = shortHandCard ? defById(state, shortHandCard.definitionId) : undefined;
    return isResourceEventCard(shortEventDef)
      ? handlePlayResourceShortEvent(state, action)
      : handlePlayShortEvent(state, action);
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

  // Rescue prisoners held at this site (CoE rule 8.36): face the host's
  // rescue-attack (the site's automatic-attacks) — held prisoners are freed
  // once it is faced. Initiate the first rescue-attack now.
  if (action.type === 'rescue-prisoner') {
    const playerIndex = getPlayerIndex(state, action.player);
    const rescuable = rescuablePrisonersAtSite(state, playerIndex, siteState.activeCompanyIndex);
    if (!rescuable || rescuable.hostInstanceId !== action.hostInstanceId) {
      return { state, error: 'No rescuable prisoners at this site for that host' };
    }
    const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
    const siteCardDef = siteDef && isSiteCard(siteDef) ? siteDef : undefined;
    const host = state.hazardHosts.find(h => h.hostCard.instanceId === action.hostInstanceId);
    const rescueAttacks = host ? rescueAttacksForHost(state, host, siteCardDef) : [];
    if (rescueAttacks.length === 0) {
      // No rescue-attack to face — free immediately.
      return {
        state: {
          ...freePrisonersOfHost(state, action.hostInstanceId),
          phaseState: { ...siteState },
        },
      };
    }
    const protectedIds = host ? host.prisoners : [];
    logDetail(`Rescue: company ${company.id} attempts to rescue prisoners of ${action.hostInstanceId as string} — facing ${rescueAttacks.length} rescue-attack(s)`);
    const combat = buildSiteRepeatedAttackCombat(state, company, siteCardDef as import('../types/cards.js').SiteCard, rescueAttacks[0], 0, {
      prowessBonus: 0,
      protectedFromStrikeAssignment: protectedIds,
    });
    return {
      state: {
        ...state,
        combat,
        phaseState: { ...siteState, step: 'rescue-attacks' as const, rescueInProgress: { hostInstanceId: action.hostInstanceId, resolved: 1 } },
      },
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

  // Site-phase grant-action: Hermit's Hill discard-minors-for-major (dm-32) /
  // discard-minors-for-gold-ring (le-382). Handled before the generic
  // grant-action path because it has no character actor to tap — the cost is
  // discarding two minor items directly.
  if (action.type === 'activate-granted-action'
    && (action.actionId === 'discard-minors-for-major' || action.actionId === 'discard-minors-for-gold-ring')) {
    return handleDiscardMinorsForUnlock(state, action, siteState);
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
 * Returns `true` when the given site definition carries the
 * `first-minor-item-no-tap` site-rule (Framsburg, as-146). Used to seed the
 * per-site-phase free-minor-item allowance when a company selects its site.
 */
function siteFirstMinorItemNoTap(
  state: GameState,
  site: { readonly definitionId: import('../index.js').CardDefinitionId } | null | undefined,
): boolean {
  if (!site) return false;
  const def = defById(state, site.definitionId);
  if (!def || !isSiteCard(def)) return false;
  return (def.effects ?? []).some(
    e => e.type === 'site-rule' && e.rule === 'first-minor-item-no-tap',
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

  // Glove of Radagast (wh-111): a granted ally may be sourced from the discard
  // pile instead of the hand (`fromDiscard`). Otherwise the card is in hand.
  const fromDiscard = action.fromDiscard === true;
  const handCard = fromDiscard
    ? findById(player.discardPile, action.cardInstanceId)
    : findById(player.hand, action.cardInstanceId);
  if (!handCard) return { state, error: fromDiscard ? 'Card not found in discard pile' : 'Card not found in hand' };
  const def = defById(state, handCard.definitionId)!;
  const isItem = isItemCard(def);
  const isAlly = !isItem && isAllyCard(def);

  const siteInPlay = company.currentSite!;

  const targetCharId = action.attachToCharacterId!;
  const charInPlay = player.characters[targetCharId];
  const charDef = defById(state, charInPlay.definitionId);
  const charName = charDef?.name ?? targetCharId;

  // no-tap-on-play (Radagast's Black Bird wh-114): playing this ally taps
  // neither the controlling character nor the site ("need not tap himself or
  // the site to do so"). The controller keeps its current status.
  const noTapOnPlay = isAlly && hasPlayFlag(def, 'no-tap-on-play');
  logDetail(`Site: playing ${def.name} on ${charName}${fromDiscard ? ' (from discard pile)' : ''}${noTapOnPlay ? ' — no-tap-on-play (leaving character and site untapped)' : ' — tapping character and site'}`);

  // Remove card from its source zone (hand, or the discard pile for a granted
  // discard-sourced ally).
  const newHand = fromDiscard ? player.hand : removeById(player.hand, handCard.instanceId);
  const newDiscardPile = fromDiscard
    ? removeById(player.discardPile, handCard.instanceId)
    : player.discardPile;

  // Tap the character and attach the item or ally (unless no-tap-on-play)
  const updatedChar: CharacterInPlay = {
    ...charInPlay,
    status: noTapOnPlay ? charInPlay.status : CardStatus.Tapped,
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

  // item-play-site doesNotTapSite: the played item explicitly leaves the
  // site untapped (e.g. Helm of Fear as-126 — "does not tap the site").
  const itemDoesNotTapSite = isItem && (def.effects ?? []).some(
    e => e.type === 'item-play-site' && e.doesNotTapSite === true,
  );
  if (itemDoesNotTapSite) {
    logDetail(`Site: ${def.name} does not tap the site (special play rule) — leaving site untapped`);
  }

  // Saruman's Machinery (wh-120): a Technology-keyword item played at a site
  // bearing this player's `technology-item-unlocked` constraint is the one
  // allowed Technology item "whether the site is tapped or untapped". It is a
  // bonus allowance that neither taps the site nor counts as the company's
  // tapping resource; mark it consumed so no further Technology item is offered.
  const isTechnologyItem = isItem
    && ((def as { keywords?: readonly string[] }).keywords ?? []).includes('Technology');
  const usingTechnologyBonus = isTechnologyItem
    && siteState.technologyItemPlayed !== true
    && siteHasTechnologyItemUnlock(state, siteInPlay.definitionId, player.id);
  if (usingTechnologyBonus) {
    logDetail(`Site: ${def.name} played via Saruman's Machinery (Technology unlock) — site not tapped, allowance consumed`);
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

  // Come By Night Upon Them (le-176): if played, the first item played at the
  // site (any subtype) does not tap the site. Consume the flag when any item
  // is played.
  const usingFirstItemNoTap = isItem && siteState.firstItemNoTapAvailable === true;
  const nextFirstItemNoTapAvailable = usingFirstItemNoTap ? false : siteState.firstItemNoTapAvailable;
  if (usingFirstItemNoTap) {
    logDetail(`Site: ${def.name} is the first item played at the site (Come By Night Upon Them) — leaving site untapped`);
  }

  // Framsburg (as-146): the first minor item played at the site each turn does
  // not tap the site. Passive, per-site counterpart to firstItemNoTapAvailable,
  // restricted to minor-subtype items. Consume the allowance once used.
  const usingFirstMinorItemNoTap = isItem
    && itemSubtypeForBounty === 'minor'
    && siteState.firstMinorItemNoTapAvailable === true;
  const nextFirstMinorItemNoTapAvailable = usingFirstMinorItemNoTap ? false : siteState.firstMinorItemNoTapAvailable;
  if (usingFirstMinorItemNoTap) {
    logDetail(`Site: ${def.name} is the first minor item played at the site (Framsburg) — leaving site untapped`);
  }

  // Thorough Search (and the Saruman's Machinery Technology bonus, and a
  // no-tap-on-play ally) prevent site tap and do not count as the "first
  // resource played" (so the opening minor-item bonus does not fire for them).
  const openingBonusActual = !siteState.resourcePlayed && !neverTaps && !usingThoroughSearch && !itemDoesNotTapSite && !usingTechnologyBonus && !noTapOnPlay && !usingFirstItemNoTap && !usingFirstMinorItemNoTap;
  const nextMinorItemAvailableActual = openingBonusActual
    ? true
    : consumingBonus
      ? false
      : siteState.minorItemAvailable;

  const leavesSiteUntapped = neverTaps || usingThoroughSearch || itemDoesNotTapSite || usingTechnologyBonus || noTapOnPlay || usingFirstItemNoTap || usingFirstMinorItemNoTap;
  const newCompaniesActual = [...player.companies];
  newCompaniesActual[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: leavesSiteUntapped ? siteInPlay : { ...siteInPlay, status: CardStatus.Tapped },
  };

  let afterAttach: GameState = {
    ...updatePlayer(state, playerIndex, p => ({ ...p, hand: newHand, discardPile: newDiscardPile, characters: newCharacters, companies: newCompaniesActual })),
    phaseState: {
      ...siteState,
      resourcePlayed: (usingThoroughSearch || usingTechnologyBonus || noTapOnPlay || usingFirstItemNoTap || usingFirstMinorItemNoTap) ? siteState.resourcePlayed : true,
      minorItemAvailable: nextMinorItemAvailableActual,
      hoardBountyAvailable: nextHoardBountyAvailable,
      thoroughSearchAvailable: nextThoroughSearchAvailable,
      firstItemNoTapAvailable: nextFirstItemNoTapAvailable,
      firstMinorItemNoTapAvailable: nextFirstMinorItemNoTapAvailable,
      ...(usingTechnologyBonus ? { technologyItemPlayed: true } : {}),
    },
  };

  // Await the Advent of Allies (dm-117): if this resource play tapped the
  // company's site, discard any attached event on a company character that
  // self-discards "when you play a resource that taps or requires the site".
  afterAttach = fireResourceTapsSiteDiscards(afterAttach, playerIndex, siteState.activeCompanyIndex, !leavesSiteUntapped);

  // Apply ward-bearer effects declared by the incoming card: any hazard
  // on the bearer that matches the ward filter is immediately discarded
  // (e.g. Adamant Helmet cancelling dark enchantments on its wearer).
  if (isItem) {
    afterAttach = applyWardToBearer(afterAttach, playerIndex, targetCharId, def, action.cardInstanceId);
    afterAttach = fireCharacterGainsItemChecks(afterAttach, playerIndex, siteState.activeCompanyIndex);
    // Greed (le-113 / tw-42): if a turn-scoped item-play-corruption-check
    // constraint is bound to this site, every non-exempt character at the
    // site (other than the item-player) makes a corruption check modified by
    // subtracting the item's corruption points.
    afterAttach = fireItemPlayCorruptionChecks(afterAttach, playerIndex, siteState.activeCompanyIndex, targetCharId, def);
  }

  // auto-test-gold-ring site-rule (Rule 9.21): playing a gold-ring item at a
  // site that declares this rule immediately enqueues a gold-ring-test resolution.
  // The ring stays on the character until the test fires (unlike the org-phase
  // store-item path which moves it to killPile first).
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

  // An Untimely Brood (wh-62): an ally played through the player's Wizardhaven
  // `grant-ally-play` permission consumes its once-per-site-phase allowance —
  // record a turn-scoped lock keyed by the granting permanent-event so the
  // legal-action scanner suppresses a second grant-enabled play this phase.
  if (isAlly && action.viaWizardhavenAllyGrant) {
    const grantId = action.viaWizardhavenAllyGrant;
    const grantCard = afterAttach.players[playerIndex].cardsInPlay.find(c => c.instanceId === grantId);
    afterAttach = addConstraint(afterAttach, {
      source: grantId,
      sourceDefinitionId: grantCard?.definitionId ?? handCard.definitionId,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: action.player },
      kind: { type: 'granted-action-used', sourceInstanceId: grantId, actionId: 'grant-ally-play' },
    });
    logDetail(`An Untimely Brood: recorded once-per-site-phase Wizardhaven ally lock on ${grantId as string}`);
  }

  // Inner Rot (wh-23): a stage item (Keys of Orthanc wh-88, Keys to the White
  // Towers wh-89) or the stage ally (Radagast's Black Bird wh-114) entering
  // play is "playing a stage card" just as much as a stage permanent-event is.
  afterAttach = fireStageCardPlayedTriggers(afterAttach, playerIndex, def);

  // Troll-purse (dm-95): playing an item at a site bearing an opponent's
  // Troll-purse forces the company to re-face all the site's automatic-attacks
  // (+3 prowess, prisoner-on-success). If triggered, the first re-faced attack
  // is initiated now and the site enters the 'troll-purse-attacks' sub-step.
  if (isItem) {
    const trapped = maybeTriggerSiteItemTrap(afterAttach, playerIndex, siteState.activeCompanyIndex);
    if (trapped) return { state: trapped };
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
    const char = player.characters[charId];
    if (!char) continue;
    for (const hazard of char.hazards) {
      const hDef = defById(newState, hazard.definitionId);
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
 * Await the Advent of Allies (dm-117): "Discard this card … when you play a
 * resource that taps or requires the site (as an active condition of playing
 * the resource itself)." When a resource play in `companyIndex` taps the
 * company's current site (`siteTapped` — false for never-taps sites, Thorough
 * Search, a leader taking a faction under control, etc.), scan every character
 * in that company for an attached permanent-event carrying
 * `on-event: resource-taps-or-requires-site` with a self-discard `move` apply,
 * and move each such card to its owner's (the active player's) discard pile.
 *
 * Discarding the card removes its `general-influence-exempt`, `own-mp-not-counted`,
 * and `bearer-cannot-move` markers from the host character, so the character
 * becomes an ordinary company member again the instant the awaited resource
 * lands. Detected by effect — not card id — so any future card that self-discards
 * on a site-tapping play works unchanged.
 */
function fireResourceTapsSiteDiscards(
  state: GameState,
  playerIndex: number,
  companyIndex: number,
  siteTapped: boolean,
): GameState {
  if (!siteTapped) return state;
  const player = state.players[playerIndex];
  const company = player.companies[companyIndex];
  if (!company) return state;

  let newCharacters = player.characters;
  const discarded: CardInstance[] = [];
  for (const charId of company.characters) {
    const char = newCharacters[charId];
    if (!char) continue;
    const toDiscard = char.items.filter(item => {
      const def = defById(state, item.definitionId);
      return getOnEventEffects(def, 'resource-taps-or-requires-site').some(e => isSelfDiscardMove(e.apply));
    });
    if (toDiscard.length === 0) continue;
    for (const item of toDiscard) {
      const def = defById(state, item.definitionId);
      logDetail(`resource-taps-or-requires-site: discarding "${def?.name ?? (item.definitionId as string)}" from ${charId as string} (site tapped by resource play)`);
      discarded.push(toCardInstance(item));
    }
    const remaining = char.items.filter(i => !toDiscard.some(d => d.instanceId === i.instanceId));
    newCharacters = { ...newCharacters, [charId as string]: { ...char, items: remaining } };
  }
  if (discarded.length === 0) return state;
  return updatePlayer(state, playerIndex, p => ({
    ...p,
    characters: newCharacters,
    discardPile: [...p.discardPile, ...discarded],
  }));
}

/**
 * Greed (le-113 / tw-42): fire the item-play corruption checks. When an item
 * is played at a site carrying a turn-scoped `item-play-corruption-check`
 * constraint, every character at the site — except the character who played
 * the item and any character matching the constraint's `exemptFilter`
 * (Hobbits, Wizards, Ringwraiths for Greed) — makes a corruption check. Each
 * check is modified by subtracting the item's printed corruption points.
 *
 * Multiple Greed constraints at the same site each fire their own check per
 * eligible character (the card is `duplication-limit` scope `site` max 1, so
 * in practice only one is ever bound to a given site — but the loop is written
 * generally).
 */
function fireItemPlayCorruptionChecks(
  state: GameState,
  playerIndex: number,
  companyIndex: number,
  itemPlayerCharId: CardInstanceId,
  itemDef: ReturnType<typeof defById>,
): GameState {
  const player = state.players[playerIndex];
  const company = player.companies[companyIndex];
  const siteDefId = company.currentSite ? resolveInstanceId(state, company.currentSite.instanceId) : undefined;
  if (!siteDefId) return state;

  const constraints = state.activeConstraints.filter(
    c => c.kind.type === 'item-play-corruption-check' && c.kind.siteDefinitionId === siteDefId,
  );
  if (constraints.length === 0) return state;

  const cp = isItemCard(itemDef) ? itemDef.corruptionPoints : 0;
  const modifier = cp > 0 ? -cp : 0;
  const itemName = (itemDef as { name?: string } | undefined)?.name ?? 'item';

  let newState = state;
  for (const constraint of constraints) {
    if (constraint.kind.type !== 'item-play-corruption-check') continue;
    const exemptFilter = constraint.kind.exemptFilter;
    for (const charId of company.characters) {
      // The character playing the item need not make a corruption check.
      if (charId === itemPlayerCharId) continue;
      const char = player.characters[charId];
      if (!char) continue;
      const charDef = defById(newState, char.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;
      // Exempt characters (Hobbits, Wizards, Ringwraiths) make no check.
      if (exemptFilter) {
        const ctx = { target: { race: charDef.race, skills: charDef.skills, name: charDef.name } };
        if (matchesCondition(exemptFilter, ctx)) {
          logDetail(`Greed: ${charDef.name} is exempt (matches exempt filter) — no corruption check`);
          continue;
        }
      }
      logDetail(`Greed: item "${itemName}" (cp ${cp}) played at site — ${charDef.name} makes a corruption check (modifier ${formatSignedNumber(modifier)})`);
      const possessions = [
        ...char.items.map(i => i.instanceId),
        ...char.allies.map(a => a.instanceId),
        ...char.hazards.map(h => h.instanceId),
      ];
      newState = enqueueCorruptionCheck(newState, {
        source: constraint.source,
        actor: player.id,
        scope: { kind: 'phase', phase: Phase.Site },
        characterId: charId,
        modifier,
        reason: `Greed (${itemName})`,
        possessions,
      });
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
  if (cardIdx === -1) return { state, error: 'Faction card not found in hand' };
  const handCard = player.hand[cardIdx];
  const def = defById(state, handCard.definitionId)!;

  const charId = action.influencingCharacterId;
  const charInPlay = player.characters[charId];
  // The influencer may be a character or an ally that "influences factions as
  // if a character" (Radagast's Black Bird wh-114); the latter lives in some
  // character's `allies` list rather than in `player.characters`.
  const influencerAlly = charInPlay ? null : findAttachment(player, 'allies', charId);
  if (!charInPlay && !influencerAlly) return { state, error: 'Influencing character not found' };

  logDetail(`Site: ${def.name} influence attempt declared by ${player.name} — initiating chain`);

  // Remove faction from hand (it goes onto the chain)
  const newHand = [...player.hand];
  newHand.splice(cardIdx, 1);

  // Tap the influencer (character or influencing ally)
  let newState: GameState = updatePlayer(state, playerIndex, p => {
    const withHand = { ...p, hand: newHand };
    if (charInPlay) {
      return { ...withHand, characters: { ...withHand.characters, [charId as string]: { ...withHand.characters[charId], status: CardStatus.Tapped } } };
    }
    const tapped = updateAttachment(withHand, 'allies', charId, a => ({ ...a, status: CardStatus.Tapped }));
    return tapped ? tapped.player : withHand;
  });

  // Paid `influence-modification` (Dragons "Roused" factions, e.g. Smaug Roused
  // le-285): the influencer discards the chosen carried item now, as the cost.
  // The gained modifier is threaded onto the chain payload → faction-influence
  // roll (applied whether or not the check then succeeds).
  let bonusModifier: number | undefined;
  if (action.discardForBonus) {
    const discardForBonus = action.discardForBonus;
    const removed = removeAttachment(newState.players[playerIndex], 'items', discardForBonus.itemInstanceId);
    if (!removed) return { state, error: 'Item to discard for influence bonus not found' };
    const discardedItem = toCardInstance(removed.attachment);
    newState = updatePlayer(newState, playerIndex, () => ({
      ...removed.player,
      discardPile: [...removed.player.discardPile, discardedItem],
    }));
    bonusModifier = discardForBonus.value;
    logDetail(`Site: ${def.name} paid influence modification — discarding ${cardName(state, removed.attachment.definitionId, '?')} for ${formatSignedNumber(bonusModifier)}`);
  }

  // Initiate chain — faction card is held by the chain entry, opponent gets priority
  const cardInstance: CardInstance = toCardInstance(handCard);
  const chainState = initiateChain(newState, action.player, cardInstance, {
    type: 'influence-attempt',
    influencingCharacterId: charId,
    placeUnderLeaderControl: action.placeUnderLeaderControl,
    bonusModifier,
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
/**
 * Fire `successful-influence-attempt` on-event triggers carried by bare
 * in-play events (either player's `cardsInPlay`) after an influence attempt
 * succeeds — a faction influence attempt ({@link resolveInfluenceAttemptRoll})
 * or an opponent-influence attempt ({@link resolveOpponentInfluenceDefend}).
 *
 * Lure of Power (tw-59): "The next non-Hobbit character to make a successful
 * influence attempt (e.g., against a faction, an opponent's character, etc.)
 * must immediately make a corruption check modified by -4. Discard this card
 * after this corruption check." The effect's `when` is matched against
 * `{ target: { race, name } }` built from the influencing character; an ally
 * influencing factions "as if he were a character" (Radagast's Black Bird
 * wh-114) never triggers — the printed text says "character". The apply is a
 * `sequence` of `enqueue-corruption-check` (a Site-phase pending check on the
 * influencer, so it resolves immediately before any further site action) and
 * a self-discard `move`. Duplicate copies of the same definition fire only
 * ONE corruption check but are ALL discarded, per the card's official
 * clarification ("If 2 Lure of Power are in play, only one corruption check
 * is made and all Lure of Power are discarded").
 */
export function fireSuccessfulInfluenceTriggers(
  state: GameState,
  influencerCharId: CardInstanceId,
  controllerId: PlayerId,
): GameState {
  const controllerIndex = getPlayerIndex(state, controllerId);
  const controller = state.players[controllerIndex];
  const char = controller.characters[influencerCharId];
  if (!char) return state;
  const charDef = defById(state, char.definitionId);
  if (!charDef || !isCharacterCard(charDef)) return state;

  const ctx = { target: { race: charDef.race, name: charDef.name } };
  // Definitions that already produced a corruption check this firing: extra
  // copies of the same card cause no additional check (but still discard).
  const firedDefIds = new Set<string>();
  let next = state;

  for (let pi = 0; pi < state.players.length; pi++) {
    const owner = next.players[pi];
    const discardIds = new Set<string>();
    for (const card of owner.cardsInPlay) {
      const def = defById(next, card.definitionId);
      for (const effect of getOnEventEffects(def, 'successful-influence-attempt')) {
        if (effect.when && !matchesContext(effect.when, ctx)) {
          logDetail(`"${def?.name}" successful-influence-attempt: when condition not met for ${charDef.name} — not triggered`);
          continue;
        }
        const steps = effect.apply.type === 'sequence' ? (effect.apply.apps ?? []) : [effect.apply];
        for (const step of steps) {
          if (step.type === 'enqueue-corruption-check') {
            if (firedDefIds.has(card.definitionId as string)) {
              logDetail(`"${def?.name}": duplicate copy in play — only one corruption check is made (all copies are discarded)`);
              continue;
            }
            firedDefIds.add(card.definitionId as string);
            const possessions = [
              ...char.items.map(i => i.instanceId),
              ...char.allies.map(a => a.instanceId),
              ...char.hazards.map(h => h.instanceId),
            ];
            logDetail(`"${def?.name}": ${charDef.name} made a successful influence attempt — corruption check (modifier ${formatSignedNumber(step.modifier ?? 0)})`);
            next = enqueueCorruptionCheck(next, {
              source: card.instanceId,
              actor: controllerId,
              scope: { kind: 'phase', phase: Phase.Site },
              characterId: influencerCharId,
              modifier: step.modifier ?? 0,
              reason: `${def?.name ?? 'Influence trigger'} (successful influence attempt)`,
              possessions,
            });
          } else if (isSelfDiscardMove(step)) {
            discardIds.add(card.instanceId as string);
          }
        }
      }
    }
    if (discardIds.size > 0) {
      const newPlayers = clonePlayers(next);
      const ownerNow = newPlayers[pi];
      const discarded = ownerNow.cardsInPlay.filter(c => discardIds.has(c.instanceId as string));
      for (const c of discarded) {
        logDetail(`Successful-influence-attempt: discarding "${cardName(next, c.definitionId, '?')}" from cardsInPlay`);
      }
      newPlayers[pi] = {
        ...ownerNow,
        cardsInPlay: ownerNow.cardsInPlay.filter(c => !discardIds.has(c.instanceId as string)),
        discardPile: [...ownerNow.discardPile, ...discarded.map(toCardInstance)],
      };
      next = {
        ...next,
        players: newPlayers,
        activeConstraints: next.activeConstraints.filter(c => !discardIds.has(c.source as string)),
      };
    }
  }
  return next;
}

export function resolveInfluenceAttemptRoll(
  state: GameState,
  entry: { readonly card: CardInstance | null; readonly declaredBy: import('../index.js').PlayerId; readonly payload: { readonly type: 'influence-attempt'; readonly influencingCharacterId: CardInstanceId; readonly placeUnderLeaderControl?: boolean; readonly bonusModifier?: number } },
): { state: GameState; effects: GameEffect[] } {
  const siteState = requirePhaseState(state, Phase.Site);
  const playerIndex = getPlayerIndex(state, entry.declaredBy);
  const player = state.players[playerIndex];

  if (!entry.card) return { state, effects: [] };

  const def = defById(state, entry.card.definitionId);
  if (!def || !isFactionCard(def)) return { state, effects: [] };

  const charId = entry.payload.influencingCharacterId;
  const charInPlay = player.characters[charId];
  // The influencer may be a character or an ally that "influences factions as
  // if a character" (Radagast's Black Bird wh-114).
  const influencerAlly = charInPlay ? null : findAttachment(player, 'allies', charId);
  if (!charInPlay && !influencerAlly) return { state, effects: [] };

  const charDef = defById(state, (charInPlay ?? influencerAlly!.attachment).definitionId);
  const charName = charDef?.name ?? charId;

  // Calculate influence modifier using current state (post-on-guard effects)
  let modifier = 0;
  // The Dark Power (as-79): a consumed one-shot boost may flag that a failed
  // check shuffles the faction into the play deck instead of discarding it.
  let shuffleFactionOnFailure = false;
  // Red Arrow (tw-312): an `auto-influence-faction` grant on the influencer (or
  // an item they bear) lets this faction be influenced with no 2d6 check.
  let autoInfluence = false;
  if (charInPlay && charDef && isCharacterCard(charDef)) {
    // Use free DI (total DI minus mind cost of followers), not the raw card stat
    const freeDI = availableDI(state, charId, player);
    modifier += freeDI;

    const resolverCtx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: buildBearerContext(charDef),
      faction: {
        name: def.name,
        race: def.race,
        playableAt: buildFactionPlayableAt(def),
        playableRegions: buildFactionPlayableRegions(state, def),
      },
      controller: {
        inPlay: buildControllerInPlayNames(state, entry.declaredBy),
        factionRaces: buildControllerFactionRaces(state, entry.declaredBy),
        wizard: playerWizardName(state, player),
      },
    };

    const charEffects = collectCharacterEffects(state, charInPlay, resolverCtx);
    charEffects.push(...collectCompanyAllyEffects(state, charInPlay, resolverCtx));
    // Player-scoped ongoing influence bonuses from bare in-play permanent-events
    // (Great Army of the North ba-38: +1 vs Orc/Troll factions while in play).
    charEffects.push(...collectPlayerInPlayInfluenceEffects(state, entry.declaredBy, resolverCtx));

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

    autoInfluence = resolveAutoInfluenceFaction(charEffects, def.name);
    if (autoInfluence) {
      logDetail(`Auto-influence grant applies to ${def.name} — attempt succeeds with no check`);
    }

    // Faction-influence-restriction environment (e.g. Mordor in Arms dm-72):
    // a hazard permanent-event in play penalises faction influence at sites in
    // named regions and may suppress specific card boosts ("cannot be done with
    // Muster"). Has no effect on a minion (Ringwraith) influencer when so flagged.
    const influencingCompanyForRegion = player.companies[siteState.activeCompanyIndex];
    const currentSiteDef = influencingCompanyForRegion?.currentSite
      ? defById(state, influencingCompanyForRegion.currentSite.definitionId)
      : undefined;
    const siteRegionName = (currentSiteDef as { region?: string } | undefined)?.region;
    const influencerIsMinion = player.alignment === Alignment.Ringwraith;
    const { modifier: restrictionModifier, blockedCardNames: blockedBoostCardNames } =
      collectFactionInfluenceRestriction(state, siteRegionName, influencerIsMinion);
    if (restrictionModifier !== 0) {
      logDetail(`Faction-influence-restriction at ${siteRegionName}: ${formatSignedNumber(restrictionModifier)}${blockedBoostCardNames.size > 0 ? `, blocks [${[...blockedBoostCardNames].join(', ')}]` : ''}`);
      modifier += restrictionModifier;
    }

    // One-shot check-modifier constraints for influence (e.g. Muster): consume after use
    const consumedConstraintIds: string[] = [];
    for (const constraint of state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'influence') continue;
      if (constraint.target.kind !== 'character') continue;
      if (constraint.target.characterId !== charId) continue;
      // A constraint that opted into a specific influence flavour via `when`
      // (e.g. Mine or No One's ba-68 → opponent-influence only) is left for that
      // path; only consume it here if its condition matches this faction check.
      if (constraint.kind.when && !matchesContext(constraint.kind.when, resolverCtx)) continue;
      const boostSourceName = (defById(state, constraint.sourceDefinitionId) as { name?: string } | undefined)?.name;
      if (boostSourceName && blockedBoostCardNames.has(boostSourceName)) {
        // "cannot be done with <named card>": the boost is suppressed (still consumed).
        consumedConstraintIds.push(constraint.id as string);
        logDetail(`Influence boost from "${boostSourceName}" suppressed by faction-influence-restriction (consumed, no effect)`);
        continue;
      }
      if (constraint.kind.prowessSubstitution) {
        // Threats (le-244): the warrior does not use his unused direct
        // influence — back out the whole DI contribution (free DI plus
        // conditional DI bonuses) and add min(effective prowess, max)
        // instead. Prowess is read here, at resolution (CRF 22).
        const effectiveProwess = charInPlay.effectiveStats.prowess;
        const substituted = Math.min(constraint.kind.prowessSubstitution.max, effectiveProwess);
        modifier += substituted - freeDI - dslDI;
        consumedConstraintIds.push(constraint.id as string);
        logDetail(`Prowess substitution from ${constraint.sourceDefinitionId as string}: unused DI ${formatSignedNumber(freeDI + dslDI)} replaced by min(prowess ${effectiveProwess}, ${constraint.kind.prowessSubstitution.max}) = ${formatSignedNumber(substituted)} (consumed)`);
        continue;
      }
      modifier += constraint.kind.value;
      consumedConstraintIds.push(constraint.id as string);
      if (constraint.kind.onFailure === 'shuffle-faction-into-deck') {
        shuffleFactionOnFailure = true;
      }
      logDetail(`Influence one-shot constraint ${formatSignedNumber(constraint.kind.value)} from ${constraint.sourceDefinitionId as string} (consumed)`);
    }
    if (consumedConstraintIds.length > 0) {
      state = { ...state, activeConstraints: state.activeConstraints.filter(c => !consumedConstraintIds.includes(c.id as string)) };
    }

    // Player-scoped influence check-modifier constraints (Terror Heralds Doom
    // ba-78: "+2 to all influence attempts this turn by any of your
    // characters"): applied to every influence check by any character of the
    // targeted player, and NOT consumed (persist for the constraint's scope).
    for (const constraint of state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'influence') continue;
      if (constraint.target.kind !== 'player') continue;
      if (constraint.target.playerId !== player.id) continue;
      modifier += constraint.kind.value;
      logDetail(`Influence player-wide constraint ${formatSignedNumber(constraint.kind.value)} from ${constraint.sourceDefinitionId as string}`);
    }
  } else if (influencerAlly && charDef && isAllyCard(charDef)) {
    // Ally influencing "as if a character" (Radagast's Black Bird wh-114): its
    // printed direct influence plus the player-scoped/region influence
    // modifiers that apply to any influencer.
    const allyDI = charDef.directInfluence ?? 0;
    modifier += allyDI;
    logDetail(`Influence attempt by ally ${charName}: DI ${allyDI}`);

    const influencingCompanyForRegion = player.companies[siteState.activeCompanyIndex];
    const currentSiteDef = influencingCompanyForRegion?.currentSite
      ? defById(state, influencingCompanyForRegion.currentSite.definitionId)
      : undefined;
    const siteRegionName = (currentSiteDef as { region?: string } | undefined)?.region;
    const influencerIsMinion = player.alignment === Alignment.Ringwraith;
    const { modifier: restrictionModifier } = collectFactionInfluenceRestriction(state, siteRegionName, influencerIsMinion);
    if (restrictionModifier !== 0) {
      modifier += restrictionModifier;
      logDetail(`Faction-influence-restriction at ${siteRegionName}: ${formatSignedNumber(restrictionModifier)}`);
    }

    for (const constraint of state.activeConstraints) {
      if (constraint.kind.type !== 'check-modifier') continue;
      if (constraint.kind.check !== 'influence') continue;
      if (constraint.target.kind !== 'player') continue;
      if (constraint.target.playerId !== player.id) continue;
      modifier += constraint.kind.value;
      logDetail(`Influence player-wide constraint ${formatSignedNumber(constraint.kind.value)} from ${constraint.sourceDefinitionId as string}`);
    }
  }

  // Game-wide ongoing influence modifier from a bare in-play event owned by
  // either player (Times Are Evil td-76: "All … influence attempts are modified
  // by -3"). Applies to every influence attempt regardless of the influencer.
  const globalInfluenceMod = collectGlobalCheckModifier(state, 'influence', { reason: 'faction-influence-check' });
  if (globalInfluenceMod !== 0) {
    modifier += globalInfluenceMod;
    logDetail(`Game-wide influence check-modifier: ${formatSignedNumber(globalInfluenceMod)}`);
  }

  // People Diminished (ba-72) / Long Grievous Siege (ba-40): a bound
  // `site-lock` / `faction-siege` card modifies every faction-play influence
  // attempt at any version of the company's current site, for either player —
  // mirroring the legal-action `need` computation.
  const influenceSiteDefId = player.companies[siteState.activeCompanyIndex]?.currentSite?.definitionId;
  const siteBoundInfluenceMod = siteFactionInfluenceModifier(state, influenceSiteDefId);
  if (siteBoundInfluenceMod !== 0) {
    modifier += siteBoundInfluenceMod;
    logDetail(`Site-bound faction-influence modifier at ${influenceSiteDefId as string}: ${formatSignedNumber(siteBoundInfluenceMod)}`);
  }

  // Paid `influence-modification` bonus (Dragons "Roused" factions, e.g. Smaug
  // Roused le-285): the influencer discarded an item on declare to gain this
  // modifier. The item is already in the discard pile; the modifier applies
  // whether or not the check now succeeds.
  const paidBonus = entry.payload.bonusModifier ?? 0;
  if (paidBonus !== 0) {
    modifier += paidBonus;
    logDetail(`Influence paid-modification bonus ${formatSignedNumber(paidBonus)} (item discarded on declare)`);
  }

  const influenceNumber = def.influenceNumber;

  // Auto-influence (Red Arrow tw-312) skips the 2d6 check entirely: the attempt
  // succeeds guaranteed and consumes no dice. Otherwise roll 2d6 + modifier.
  let roll: TwoDiceSix | undefined;
  let rng = state.rng;
  let cheatRollTotal: number | null = null;
  let total: number;
  let rollEffect: GameEffect | undefined;
  if (autoInfluence) {
    total = influenceNumber; // guaranteed success (total >= influence #)
    logDetail(`Influence attempt: ${charName} automatically influences ${def.name} (no check)`);
  } else {
    const rolled = roll2d6(state);
    roll = rolled.roll;
    rng = rolled.rng;
    cheatRollTotal = rolled.cheatRollTotal;
    const d1 = roll.die1;
    const d2 = roll.die2;
    total = d1 + d2 + modifier;
    const modStr = modifier !== 0 ? ` + ${modifier}` : '';
    logDetail(`Influence attempt: ${charName} rolls ${d1} + ${d2}${modStr} = ${total} vs influence # ${influenceNumber}`);
    rollEffect = diceRollEffect(player.name, roll, `Influence: ${def.name}`);
  }

  const company = player.companies[siteState.activeCompanyIndex];
  const siteInPlay = company.currentSite;

  const newPlayers = clonePlayers(state);

  // LE "Orcs of Udûn"-style control: an eligible Orc/Troll leader may take a
  // `leader-control` faction under its control on success, leaving the site
  // untapped. The option is only honoured when the attempt succeeds and the
  // influencing character still matches the effect's race + keyword gate.
  const willPlaceUnderControl = total >= influenceNumber
    && !!entry.payload.placeUnderLeaderControl
    && charDef !== undefined && isCharacterCard(charDef)
    && leaderControlEligibility(def, charDef);
  if (willPlaceUnderControl) {
    logDetail(`Site: ${charName} takes ${def.name} under leader control — site left untapped`);
  }

  // Tap the site, unless it carries the `never-taps` site-rule
  // (e.g. The Worthy Hills — influence attempts there do not tap the site)
  // or the leader is taking the faction under control (untapped per text).
  const neverTaps = siteNeverTaps(state, siteInPlay);
  if (neverTaps) {
    logDetail(`Site: influence at ${def.name} — site has never-taps, leaving site untapped`);
  }
  const skipSiteTap = neverTaps || willPlaceUnderControl;
  const newCompanies = [...player.companies];
  newCompanies[siteState.activeCompanyIndex] = {
    ...company,
    currentSite: siteInPlay && !skipSiteTap ? { ...siteInPlay, status: CardStatus.Tapped } : siteInPlay,
  };

  newPlayers[playerIndex] = { ...player, ...newPlayers[playerIndex], companies: newCompanies, ...(roll ? { lastDiceRoll: roll } : {}) };

  if (total >= influenceNumber) {
    logDetail(`Influence attempt succeeded (${total} >= ${influenceNumber})`);
    // Await the Onset (wh-96): a faction influenced into play while it is in play
    // is "placed under Await the Onset" — pinned to 1 MP regardless of other
    // cards. The pin is stamped on the instance so it persists per faction.
    const mpPin = playedAfterFactionMpPin(state, player);
    if (mpPin !== undefined) {
      logDetail(`Site: ${def.name} placed under Await the Onset — pinned to ${mpPin} marshalling point(s)`);
    }
    const factionEntry = willPlaceUnderControl
      ? { instanceId: entry.card.instanceId, definitionId: entry.card.definitionId, status: CardStatus.Untapped, controlledBy: charId, ...(mpPin !== undefined ? { mpPinned: mpPin } : {}) }
      : { instanceId: entry.card.instanceId, definitionId: entry.card.definitionId, status: CardStatus.Untapped, ...(mpPin !== undefined ? { mpPinned: mpPin } : {}) };
    const newCardsInPlay = [...player.cardsInPlay, factionEntry];
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], cardsInPlay: newCardsInPlay };

    // Rule 2.V.5: a successful resource that taps the site opens the
    // additional-minor-item window. Taking the faction under control leaves
    // the site untapped, so it does not open that window.
    const openMinorItemBonus = !siteState.resourcePlayed && !skipSiteTap;

    // To Fealty Sworn (ba-33): record when the active company successfully plays
    // a unique hero faction at a Free-hold that is not Bag End, so the
    // `company-context` play-condition can open the window to attach it to a
    // Hobbit in the company during this same site phase.
    const siteDefForFaction = siteInPlay ? defById(state, siteInPlay.definitionId) : undefined;
    const factionAtFreeHold = def.unique
      && def.cardType === 'hero-resource-faction'
      && !!siteDefForFaction && isSiteCard(siteDefForFaction)
      && siteDefForFaction.siteType === 'free-hold'
      && siteDefForFaction.name !== 'Bag End';
    if (factionAtFreeHold) {
      logDetail(`Site: ${def.name} is a unique hero faction played at Free-hold ${siteDefForFaction.name} — opening To Fealty Sworn window`);
    }

    // Await the Advent of Allies (dm-117): a faction played (influenced) at the
    // company's site taps and requires that site — discard any attached event
    // that self-discards on such a play.
    const successState = fireResourceTapsSiteDiscards({
      ...state,
      players: newPlayers,
      rng, cheatRollTotal,
      phaseState: {
        ...siteState,
        resourcePlayed: true,
        minorItemAvailable: openMinorItemBonus ? true : siteState.minorItemAvailable,
        factionPlayedThisSitePhase: true,
        ...(factionAtFreeHold ? { uniqueHeroFactionPlayedAtFreeHold: true } : {}),
      },
    }, playerIndex, siteState.activeCompanyIndex, !skipSiteTap);
    // Lure of Power (tw-59): a successful influence attempt by a matching
    // character fires `successful-influence-attempt` triggers on bare in-play
    // events (corruption check on the influencer, then self-discard). Only a
    // character influencer qualifies — an ally (wh-114) is not a "character".
    const triggeredState = charInPlay
      ? fireSuccessfulInfluenceTriggers(successState, charId, entry.declaredBy)
      : successState;
    // Inner Rot (wh-23): a stage faction (Half-orcs wh-87, Greater Half-orcs
    // wh-86) influenced into play counts as "playing a stage card". A failed
    // influence attempt never puts the faction in play, so it does not trigger.
    const stageTriggered = fireStageCardPlayedTriggers(triggeredState, playerIndex, def);
    return { state: stageTriggered, effects: rollEffect ? [rollEffect] : [] };
  }

  logDetail(`Influence attempt failed (${total} < ${influenceNumber})`);
  let failRng = rng;
  if (shuffleFactionOnFailure) {
    // The Dark Power (as-79): the consumed boost sends the failed faction back
    // into its player's play deck (reshuffled) instead of the discard pile.
    const [shuffledDeck, nextRng] = shuffle([...newPlayers[playerIndex].playDeck, entry.card], failRng);
    failRng = nextRng;
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], playDeck: shuffledDeck };
    logDetail(`Influence: ${def.name} shuffled into ${player.name}'s play deck (failed check under shuffle-on-failure boost)`);
  } else {
    newPlayers[playerIndex] = { ...newPlayers[playerIndex], discardPile: [...player.discardPile, entry.card] };
  }

  const failureState = fireResourceTapsSiteDiscards({
    ...state,
    players: newPlayers,
    rng: failRng, cheatRollTotal,
    phaseState: { ...siteState, resourcePlayed: true },
  }, playerIndex, siteState.activeCompanyIndex, !skipSiteTap);
  return { state: failureState, effects: rollEffect ? [rollEffect] : [] };
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
  const charInPlay = player.characters[charId];

  const opponentIndex = 1 - playerIndex;
  const opponent = state.players[opponentIndex];

  let targetMind = 0;
  let controllerDI = 0;
  // Target identity for the opponent-influence resolver context (booster gating).
  let targetRace: Race | undefined;
  let targetName = '';
  // Character-target stats for the resolver context — effective mind/prowess,
  // set only for a character target so stat-gated DI bonuses (Whip le-348:
  // "against one character with a mind and prowess less than the bearer's")
  // can compare them; they stay undefined for ally/faction/item targets.
  let targetCtxMind: number | undefined;
  let targetCtxProwess: number | undefined;

  if (action.targetKind === 'character') {
    const targetChar = opponent.characters[action.targetInstanceId];
    if (!targetChar) return { state, error: 'Target character not found' };
    const targetDef = defById(state, targetChar.definitionId);
    if (!targetDef || !isCharacterCard(targetDef)) return { state, error: 'Target is not a character' };
    if (targetDef.mind === null) return { state, error: 'Cannot influence an avatar' };
    // A `control-restriction` (e.g. Wizard's Myrmidon) overrides the
    // influence-to-control threshold the opponent must beat.
    targetMind = controlCostOf(state, targetChar, targetDef.mind) ?? targetDef.mind;
    targetRace = targetDef.race;
    targetName = targetDef.name;
    targetCtxMind = targetChar.effectiveStats.mind ?? targetDef.mind;
    targetCtxProwess = targetChar.effectiveStats.prowess;

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
        // A converted-creature ally (Ready to His Will) carries its mind on the
        // instance override; otherwise the target must be a real ally card.
        if (!allyInst.statOverride && (!allyDef || !isAllyCard(allyDef))) return { state, error: 'Target is not an ally' };
        targetMind = allyEffectiveMind(state, allyInst);
        controllerDI = availableDI(state, oppCharId, opponent);
        // Allies carry no race field; only kind matters for booster gating.
        targetName = allyDef?.name ?? '';
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
    targetRace = factionDef.race;
    targetName = factionDef.name;
  } else if (action.targetKind === 'item') {
    // CoE rule 8.3: influencing an item — the comparison value is the mind of
    // the character controlling the item, and its controller's unused DI is
    // subtracted (rule 10.12 step 5 / 8.3 step 5). The identical-item reveal is
    // enforced at legal-action time and required to declare the attempt.
    let itemFound = false;
    for (const [oppCharId, oppChar] of characterEntries(opponent)) {
      const itemInst = oppChar.items.find(i => i.instanceId === action.targetInstanceId);
      if (itemInst) {
        const itemDef = defById(state, itemInst.definitionId);
        const ctrlDef = defById(state, oppChar.definitionId);
        targetMind = ctrlDef && isCharacterCard(ctrlDef) && ctrlDef.mind !== null ? ctrlDef.mind : 0;
        controllerDI = availableDI(state, oppCharId, opponent);
        // Items carry no race field; only kind matters for booster gating.
        targetName = itemDef?.name ?? '';
        itemFound = true;
        break;
      }
    }
    if (!itemFound) return { state, error: 'Target item not found' };
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

    // Validate: must be same name as the target (computed above for every kind).
    if (!revealedDef || revealedDef.name !== targetName) {
      return { state, error: 'Revealed card does not match target name' };
    }

    revealedCard = toCardInstance(revealedHandCard);
    newHand.splice(revealIdx, 1);
    // CoE rule 8.3: the comparison value is treated as zero only when an
    // identical *non-item* card was revealed. Influencing an item requires
    // revealing an identical item (rule 8.1) but the value — the controlling
    // character's mind — is NOT zeroed.
    if (action.targetKind !== 'item') {
      effectiveTargetMind = 0;
      logDetail(`Opponent influence: revealing identical ${revealedDef.name} from hand — target mind treated as 0`);
    } else {
      logDetail(`Opponent influence: revealing identical item ${revealedDef.name} from hand (required; mind not zeroed)`);
    }
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

  // Prophet of Doom (wh-106): when the named influencer (Pallando) makes this
  // attempt while the override is in play, substitute half (rounded up) of the
  // player's unused general influence — capped — for the influencer's unused
  // direct influence, and subtract the inclusive region distance to the target.
  const override = getOpponentInfluenceOverride(state, player);
  const overrideActive = override !== undefined && override.influencer === charName;
  let influencerContribution = influencerDI;
  let regionPenalty = 0;
  if (overrideActive && override) {
    if (override.generalInfluenceSubstitution) {
      const unusedGI = effectiveGeneralInfluence(state, player.id) - player.generalInfluenceUsed;
      influencerContribution = generalInfluenceSubstitutionValue(unusedGI, override.generalInfluenceSubstitution);
      logDetail(`Prophet of Doom: substituting general influence — unused GI ${unusedGI} → contribution ${influencerContribution} (was DI ${influencerDI})`);
    }
    if (override.regionDistancePenalty) {
      const influencerRegion = companySiteRegion(state, findCharacterCompany(player.companies, charId));
      let targetRegions: readonly string[];
      if (action.targetKind === 'faction') {
        const tf = findById(opponent.cardsInPlay, action.targetInstanceId);
        const fdef = tf ? defById(state, tf.definitionId) : undefined;
        targetRegions = fdef ? factionPlayableSiteRegions(state, fdef) : [];
      } else {
        let holderId = action.targetInstanceId;
        if (action.targetKind === 'ally') {
          for (const [cid, ch] of characterEntries(opponent)) {
            if (ch.allies.some(a => a.instanceId === action.targetInstanceId)) { holderId = cid; break; }
          }
        }
        const r = companySiteRegion(state, findCharacterCompany(opponent.companies, holderId));
        targetRegions = r ? [r] : [];
      }
      regionPenalty = influenceRegionPenalty(state, influencerRegion, targetRegions);
      logDetail(`Prophet of Doom: region penalty ${regionPenalty} (from ${influencerRegion ?? '?'} to [${targetRegions.join(', ')}])`);
    }
  }

  // Fold in (and consume) one-shot influence `check-modifier` constraints that
  // target the influencer and opt into this opponent-influence attempt via
  // their `when` (e.g. Mine or No One's ba-68: +10 against an item/ally/Orc or
  // Troll faction). Constraints with no `when` belong to the faction-influence
  // roll and are left untouched here. The context exposes the target's kind and
  // race so the booster can gate on the printed target list.
  let boostModifier = 0;
  const consumedBoostIds: string[] = [];
  const oppInfluenceCtx: ResolverContext = {
    reason: 'opponent-influence-check',
    // Effective influencer prowess and character-target stats let conditions
    // compare live values (Whip le-348: target has a mind and lower prowess).
    ...(charDef && isCharacterCard(charDef)
      ? { bearer: { ...buildBearerContext(charDef), prowess: charInPlay.effectiveStats.prowess } }
      : {}),
    target: {
      kind: action.targetKind, race: targetRace, name: targetName,
      ...(targetCtxMind !== undefined ? { mind: targetCtxMind } : {}),
      ...(targetCtxProwess !== undefined ? { prowess: targetCtxProwess } : {}),
    },
  };
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'check-modifier') continue;
    if (constraint.kind.check !== 'influence') continue;
    if (constraint.target.kind !== 'character' || constraint.target.characterId !== charId) continue;
    if (!constraint.kind.when) continue; // no `when` → faction-influence booster, not for this path
    if (!matchesContext(constraint.kind.when, oppInfluenceCtx)) continue;
    boostModifier += constraint.kind.value;
    consumedBoostIds.push(constraint.id as string);
    logDetail(`Opponent influence boost ${formatSignedNumber(constraint.kind.value)} from ${constraint.sourceDefinitionId as string} (consumed)`);
  }

  // Fold in conditional direct-influence stat-modifiers borne by the influencer
  // that gate on the opponent-influence target context — e.g. Trifling Ring
  // (le-346): "+3 to direct influence against characters" applies only when the
  // target is a character, not a faction/ally/item. Only `when`-gated modifiers
  // are considered here: unconditional DI is already baked into effective stats
  // and folded into `influencerContribution` via availableDI above, so including
  // it again would double-count. Conditional modifiers are excluded from
  // effective DI (no target context at effective-stats time) and applied here.
  const conditionalInfluencerEffects = collectCharacterEffects(state, charInPlay, oppInfluenceCtx)
    .filter(e => e.effect.when !== undefined);
  const conditionalInfluencerDI = resolveStatModifiers(conditionalInfluencerEffects, 'direct-influence', 0, oppInfluenceCtx);
  if (conditionalInfluencerDI !== 0) {
    influencerContribution += conditionalInfluencerDI;
    logDetail(`Opponent influence: conditional influencer DI ${formatSignedNumber(conditionalInfluencerDI)} (target ${action.targetKind}) → contribution ${influencerContribution}`);
  }

  logDetail(`Opponent influence attempt: ${charName} rolls ${roll.die1} + ${roll.die2} = ${attackerRoll} (contribution: ${influencerContribution}, opponent GI: ${opponentGI}, target mind: ${effectiveTargetMind}${revealedCard ? ' [revealed]' : ''}, controller DI: ${controllerDI}, cross-alignment penalty: ${crossAlignmentPenalty}, region penalty: ${regionPenalty}, boost: ${formatSignedNumber(boostModifier)})`);

  // Enqueue a pending opponent-influence-defend resolution for the
  // hazard player. The unified pending system replaces the old
  // `pendingOpponentInfluence` field.
  const stateAfterAttempt: GameState = {
    ...stateAfterTap,
    rng, cheatRollTotal,
    activeConstraints: stateAfterTap.activeConstraints.filter(c => !consumedBoostIds.includes(c.id as string)),
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
          influencerDI: influencerContribution,
          opponentGI,
          targetMind: effectiveTargetMind,
          controllerDI,
          crossAlignmentPenalty,
          regionPenalty,
          boostModifier,
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
  //   - region penalty (Prophet of Doom wh-106; 0 for normal same-site attempts)
  const regionPenalty = attempt.regionPenalty ?? 0;
  const boostModifier = attempt.boostModifier ?? 0;
  const finalResult = attempt.attackerRoll + attempt.influencerDI - attempt.opponentGI - defenderRoll - attempt.controllerDI + attempt.crossAlignmentPenalty - regionPenalty + boostModifier;

  logDetail(`Opponent influence resolution: ${attempt.attackerRoll} + ${attempt.influencerDI} - ${attempt.opponentGI} - ${defenderRoll} - ${attempt.controllerDI} + ${attempt.crossAlignmentPenalty} (cross-alignment) - ${regionPenalty} (region) + ${boostModifier} (boost) = ${finalResult} vs mind ${attempt.targetMind}`);

  const newPlayers = clonePlayers(state);

  if (finalResult > attempt.targetMind) {
    // Success — discard target and controlled non-follower cards
    logDetail(`Opponent influence succeeded (${finalResult} > ${attempt.targetMind})`);
    // Find the company of the influenced target (for membership-change sweep)
    const opponent2 = state.players[opponentIndex];
    let influencedCompanyId: import('../index.js').CompanyId | undefined;
    if (attempt.targetKind === 'ally' || attempt.targetKind === 'item') {
      // Allies and items sit on a controlling character — locate that character's company.
      for (const [charId, ch] of characterEntries(opponent2)) {
        const holds = attempt.targetKind === 'ally'
          ? ch.allies.some(a => a.instanceId === attempt.targetInstanceId)
          : ch.items.some(i => i.instanceId === attempt.targetInstanceId);
        if (holds) {
          influencedCompanyId = findCharacterCompany(opponent2.companies, charId)?.id;
          break;
        }
      }
    } else {
      influencedCompanyId = findCharacterCompany(opponent2.companies, attempt.targetInstanceId)?.id;
    }

    // Check if the influenced target is a leader (for leader-leaves-company sweep)
    let influencedIsLeader = false;
    if (attempt.targetKind === 'character') {
      const targetChar = opponent2.characters[attempt.targetInstanceId];
      if (targetChar) {
        const targetDef = defById(state, targetChar.definitionId);
        influencedIsLeader = !!(targetDef && isCharacterCard(targetDef) && (targetDef.keywords ?? []).includes('leader'));
      }
    }

    discardInfluencedCard(newPlayers, opponentIndex, attempt, state);

    // The revealed identical card was removed from the attacker's hand when the
    // attempt was declared. On success the attacker MAY immediately play it
    // (CoE rule 8.4) — that optional play is not automated, so the un-played
    // card simply returns to hand rather than vanishing (preserving the
    // no-card-disappears invariant). For an item attempt the reveal is
    // mandatory, so this always runs when influencing an item.
    if (attempt.revealedCard) {
      const attackerIndex = playerIndex;
      const attacker = newPlayers[attackerIndex];
      newPlayers[attackerIndex] = {
        ...attacker,
        hand: [...attacker.hand, { instanceId: attempt.revealedCard.instanceId, definitionId: attempt.revealedCard.definitionId }],
      };
      logDetail(`Revealed card ${attempt.revealedCard.instanceId as string} returns to hand after successful influence (rule 8.4 play not automated)`);
    }

    const afterInfluence = cleanupEmptyCompanies({ ...state, players: newPlayers, rng, cheatRollTotal });
    let afterSweep = influencedCompanyId
      ? sweepCompanyMembershipChangedEvents(afterInfluence, [influencedCompanyId])
      : afterInfluence;
    if (influencedIsLeader && influencedCompanyId) {
      logDetail(`Opponent influence: influenced character is a Leader — sweeping leader-leaves-company events on ${influencedCompanyId as string}`);
      afterSweep = sweepLeaderLeavesCompanyEvents(afterSweep, [influencedCompanyId]);
    }
    // Lure of Power (tw-59): a successful opponent-influence attempt is a
    // "successful influence attempt" — fire the in-play triggers on the
    // influencing character (corruption check, then self-discard).
    afterSweep = fireSuccessfulInfluenceTriggers(afterSweep, attempt.influencerId, state.activePlayer!);
    return {
      state: afterSweep,
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

  if (pending.targetKind === 'item') {
    // Find and remove the item from its bearing character, discarding it to the
    // opponent's discard pile (CoE 8.3: the influenced card is discarded).
    for (const [charId, charInPlay] of characterEntries(opponent)) {
      const itemIdx = charInPlay.items.findIndex(i => i.instanceId === pending.targetInstanceId);
      if (itemIdx !== -1) {
        const item = charInPlay.items[itemIdx];
        const newItems = [...charInPlay.items];
        newItems.splice(itemIdx, 1);
        const updatedChar = { ...charInPlay, items: newItems };
        const newChars = { ...opponent.characters, [charId]: updatedChar };
        const newDiscard = [...opponent.discardPile, toCardInstance(item)];
        players[opponentIndex] = { ...opponent, characters: newChars, discardPile: newDiscard };
        logDetail(`Discarded item ${item.instanceId as string}`);
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

  // Character target — discard character + items + allies + hazards, handle followers
  const targetChar = opponent.characters[pending.targetInstanceId];
  if (!targetChar) return;

  const newDiscard = [...opponent.discardPile];
  // Hazards belong to the opposing (hazard) player — route to their discard
  const hazardPlayerIndex = 1 - opponentIndex;
  const newHazardDiscard = [...players[hazardPlayerIndex].discardPile];

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

  // Discard the character itself
  newDiscard.push(toCardInstance(targetChar));
  logDetail(`Discarded influenced character ${targetChar.instanceId}`);

  // Discard hazards to their owner's discard pile
  for (const hazard of targetChar.hazards) {
    logDetail(`Discarding hazard ${hazard.instanceId as string} from influenced character`);
    const hazOwner = ownerOf(hazard.instanceId);
    let hazOwnerIdx = players.findIndex(p => p.id === hazOwner);
    if (hazOwnerIdx === -1) hazOwnerIdx = opponentIndex === 0 ? 1 : 0;
    if (hazOwnerIdx === opponentIndex) {
      newDiscard.push(toCardInstance(hazard));
    } else {
      newHazardDiscard.push(toCardInstance(hazard));
    }
  }

  // Handle followers — try to place under GI, otherwise discard
  const newCharacters = { ...opponent.characters };
  for (const followerId of targetChar.followers) {
    const follower = newCharacters[followerId];
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

    if (currentGIUsed + followerMind <= generalInfluenceControlLimit(state, opponent.id)) {
      // Move to GI
      newCharacters[followerId] = { ...follower, controlledBy: 'general' };
      logDetail(`Follower ${followerId} falls to GI (mind ${followerMind}, GI used ${currentGIUsed})`);
    } else {
      // Discard follower and their items/allies/hazards
      for (const item of follower.items) {
        newDiscard.push(toCardInstance(item));
      }
      for (const ally of follower.allies) {
        newDiscard.push(toCardInstance(ally));
      }
      // Dispatch follower hazards to their owner's discard pile
      for (const haz of follower.hazards) {
        const hazOwner = ownerOf(haz.instanceId);
        let hazOwnerIdx = players.findIndex(p => (p.id as string) === (hazOwner as string));
        if (hazOwnerIdx === -1) hazOwnerIdx = opponentIndex === 0 ? 1 : 0;
        if (hazOwnerIdx === opponentIndex) newDiscard.push(toCardInstance(haz));
        else newHazardDiscard.push(toCardInstance(haz));
        logDetail(`discardInfluencedCard: follower hazard ${haz.instanceId as string} dispatched`);
      }
      newDiscard.push(toCardInstance(follower));
      delete newCharacters[followerId];
      logDetail(`Follower ${followerId} discarded (no GI room)`);
    }
  }

  // Remove the target character
  delete newCharacters[pending.targetInstanceId];

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
  players[hazardPlayerIndex] = { ...players[hazardPlayerIndex], discardPile: newHazardDiscard };
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
      const def = defById(newState, card.definitionId);
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
          // cancel-deck-search (as-13): a minion player's own discard-pile
          // retrieval is automatically canceled — skip that player's fetch.
          const gatedPayload = gateDeckSearchFetch(newState, targetPlayer.id, payload);
          if (!gatedPayload) continue;
          const pendingEffect: PendingEffect = {
            type: 'card-effect',
            cardInstanceId: card.instanceId,
            effect: gatedPayload,
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
      const bearer = resourcePlayer.characters[charId];
      if (!bearer) continue;
      for (const hazard of bearer.hazards) {
        const hDef = defById(newState, hazard.definitionId);
        for (const effect of getOnEventEffects(hDef, 'end-of-turn')) {
          if (effect.apply.type !== 'force-check' || !effect.apply.perOthersItem) continue;
          if (effect.apply.check !== 'corruption') continue;

          const otherItems = company.characters
            .filter(oid => oid !== charId)
            .flatMap(oid => resourcePlayer.characters[oid]?.items ?? []);

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
    // Determine the base modifier for this company. The default is -2; a
    // site may override it by declaring a `site-phase-ring-auto-test`
    // site-rule with a `rollModifier` (e.g. Barad-Dûr at -3). Reading the
    // value from card data keeps the site-specific number out of the engine.
    let baseModifier = -2;
    if (company.currentSite) {
      const siteDefId = resolveInstanceId(newState, company.currentSite.instanceId);
      const siteDef = siteDefId ? defById(newState, siteDefId) : undefined;
      const rule = siteDef && isSiteCard(siteDef)
        ? siteDef.effects?.find(
            (e): e is SitePhaseRingAutoTestSiteRule =>
              e.type === 'site-rule' && e.rule === 'site-phase-ring-auto-test',
          )
        : undefined;
      // A site may exempt whole alignments from its auto-test — MEBA: "Rings
      // are not automatically tested for a Balrog player at Barad-dûr"
      // (`skipForAlignments: ["balrog"]` on le-352). Skip the whole company's
      // auto-test there; the -2 company modifier from rule 9.23 still applies
      // to ring tests triggered by other means.
      if (rule?.skipForAlignments?.includes(resourcePlayer.alignment)) {
        logDetail(`end-of-turn: skipping gold-ring auto-test for ${resourcePlayer.alignment} company at ${siteDef && isSiteCard(siteDef) ? siteDef.name : siteDefId as string} (site-rule skipForAlignments)`);
        continue;
      }
      if (rule) baseModifier = rule.rollModifier;
    }

    for (const charId of company.characters) {
      const bearer = resourcePlayer.characters[charId];
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
    const attackerCovert = isCovertCompany(attackingCompany, attackingPlayer, state);
    const defenderCovert = isCovertCompany(opponentCompany, opponent, state);
    if (!canAttackAlignment(attackingPlayer.alignment, opponent.alignment, attackerCovert, defenderCovert)
      && !cvccAttackPermitted(state, attackingPlayer, attackingCompany, opponent, opponentCompany)) continue;
    // A deny-company-attack site-rule (Rivendell as-160) bars attacks here.
    if (siteDeniesCompanyAttack(state, attackingPlayer, attackingCompany, opponent, opponentCompany)) continue;
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

  const attackerCovert = isCovertCompany(company, player, state);
  const defenderCovert = isCovertCompany(targetCompany, hazardPlayerState, state);
  if (!canAttackAlignment(player.alignment, hazardPlayerState.alignment, attackerCovert, defenderCovert)
    && !cvccAttackPermitted(state, player, company, hazardPlayerState, targetCompany)) {
    return { state, error: 'Alignment restrictions prevent this CvCC attack' };
  }

  // A deny-company-attack site-rule (Rivendell as-160) bars attacks here.
  if (siteDeniesCompanyAttack(state, player, company, hazardPlayerState, targetCompany)) {
    return { state, error: 'A site rule forbids company-vs-company attacks at this site' };
  }

  // Count attackers: characters in attacking company
  const attackerCount = company.characters.length;
  if (attackerCount === 0) {
    return { state, error: 'Attacking company has no characters' };
  }

  logDetail(`Site: CvCC attack declared — ${company.id} (${player.alignment}) attacks ${targetCompany.id} (${hazardPlayerState.alignment}), ${attackerCount} strike(s)`);

  const combat: CombatState = makeCombatState({
    isCvCC: true,
    attackSource: { type: 'company-attack', attackingCompanyId: action.attackingCompanyId },
    companyId: action.targetCompanyId,
    defendingPlayerId: hazardPlayerState.id,
    attackingPlayerId: player.id,
    strikesTotal: attackerCount,
    strikeProwess: 0,
    creatureBody: null,
    assignmentPhase: 'defender',
    detainment: false,
  });

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
 * allies from the defending company and enqueue one `dice-check` (cvcc ally-discard)
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
    const char = defendingPlayer.characters[charInstId];
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
    const char = attackingPlayer.characters[charInstId];
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

        const threshold = effect.apply.threshold ?? 5;
        const itemName = (itemDef as { name?: string }).name ?? (item.definitionId as string);
        logDetail(`CvCC pre-strike: ${itemName} fires — enqueuing ${defMinionAllies.length} ally-discard roll(s)`);

        for (const { allyInstanceId, allyMind } of defMinionAllies) {
          newState = enqueueResolution(newState, {
            source: item.instanceId,
            actor: attackingPlayer.id,
            scope: { kind: 'phase', phase: Phase.Site },
            kind: {
              type: 'dice-check',
              label: `${itemName}: discard ally (roll > mind ${allyMind} + ${threshold})`,
              // The ally's owner (defending player) rolls, though the attacker
              // is the resolution actor.
              roller: newState.players[defPlayerIndex].id,
              modifiers: [],
              threshold: allyMind + threshold,
              comparison: 'gt',
              // Skip the roll (and chain) if the ally is already gone.
              requireTargetPresent: true,
              // total > mind+threshold → ally discarded to its owner's discard.
              onPass: { type: 'move', select: 'target', from: 'attached-to-character', to: 'discard', toOwner: 'source-owner' },
              continuation: { kind: 'dequeue-only' },
              targetInstanceId: allyInstanceId,
            },
          });
        }
      }
    }
  }

  return newState;
}

/**
 * Finish the site-phase slot of a company that dissolved mid-phase (all
 * of its characters left play, so the company no longer exists at
 * `activeCompanyIndex`): return to select-company for any remaining
 * unhandled companies, or end the site phase when none remain. Shared by
 * every per-company site step that can encounter a dangling index.
 */
function finishDissolvedCompanySlot(state: GameState, siteState: SitePhaseState): ReducerResult {
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const handledSet = new Set(siteState.handledCompanyIds);
  const unhandled = state.players[activePlayerIndex].companies.filter(c => !handledSet.has(c.id));
  if (unhandled.length === 0) {
    return endSitePhase(state);
  }
  return {
    state: {
      ...state,
      phaseState: {
        ...siteState,
        step: 'select-company' as const,
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
 * Close the site phase: return unused on-guard cards, fire end-of-turn
 * fetch/corruption/ring-test effects, clean up empty companies, and advance
 * to the End-of-Turn discard step. Shared by the normal all-companies-handled
 * path and the pass fallback for when every company dissolved mid-phase.
 */
function endSitePhase(state: GameState): ReducerResult {
  // Return remaining on-guard cards to hazard player's hand
  const cleanedState = returnOnGuardCardsToHand(state);
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
    return endSitePhase(sweptState);
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

