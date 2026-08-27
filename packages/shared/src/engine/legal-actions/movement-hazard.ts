/**
 * @module legal-actions/movement-hazard
 *
 * Legal actions during the movement/hazard phase. Companies move to
 * their destinations while the opponent plays hazard cards. Combat
 * sub-states further constrain available actions.
 */

import type { GameState, PlayerId, PlayerState, GameAction, EvaluatedAction, MovementHazardPhaseState, SiteCard, CardDefinition, CardDefinitionId, CardInstanceId, CompanyId, Company, CharacterCard, AgentInPlay, CreatureCard, CreatureKeyingMatch, PlayHazardAction, PlaceOnGuardAction, PlayConditionEffect, CreatureRaceChoiceEffect, PlayAgentHazardAction, RevealAgentAction, AgentMoveAction, AgentMoveBackAction, AgentReturnHomeAction, AgentHealAction, AgentUntapAction, AgentTurnFaceDownAction, AgentKeyCreaturesAction, AgentInfluenceAttemptAction, AgentTapAttackAction, AgentDiscardReturnToOriginAction } from '../../index.js';
import type { TapDiscardAttachedHazardEffect, TapAgentEffect, AgentTapAttackEffect, AgentDiscardReturnToOriginEffect, HazardLimitSwapEffect, DiscardForHazardLimitEffect, ForceDiscardTargetItemEffect, TargetCharacterStatModifierEffect, GrantCreatureKeyingEffect, AllyTapExtraMHPhaseEffect, CharacterTapExtraMHPhaseEffect } from '../../types/effects.js';
import { GENERAL_INFLUENCE } from '../../constants.js';
import { matchesCondition, matchesContext } from '../../effects/condition-matcher.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { buildMovementMap, findRegionPaths, getReachableSites, withExtraRegionAdjacency, withVirtualAdjacency } from '../../movement-map.js';
import { AGENT_MAX_REGION_DISTANCE } from '../../rules/definitions/movement.js';
import { getPlayerIndex, canCallEndgameNow, isWizard, isMinionOrBalrog, companyContainsBalrogAvatar, companyContainsRingwraithAvatar, requirePhaseState } from '../../state-utils.js';
import { evilHourRegionBonus } from '../evil-hour.js';
import { isSiteCard, isCharacterCard, isAllyCard, isFactionCard, isAvatarCharacter, isItemCard } from '../../types/cards.js';
import { RegionType, Race, Skill, CardStatus, Alignment, MovementType, SiteType } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { defenderAlignmentLabel } from '../detainment.js';
import { getEffectiveSiteType, buildSiteFilterContext, resolveCreatureKeyingSiteType } from '../effective.js';
import { isUnderDeepsAdjacent, isDeepMinesSite, isDeepMinesDescentLegal, isDeepMinesAscentLegal, balrogOutHeSprangRegionAllowance } from './organization-companies.js';
import type { TapHazardCardForLimitAction, PayHazardLimitToUntapCardAction, DiscardCardForHazardLimitAction } from '../../types/actions-movement-hazard.js';
import { resolveInstanceId } from '../../types/state.js';
import { getActiveAutoAttacks, manifestationOfEntityInPlay } from '../manifestations.js';
import { normalizeCreatureRace } from '../effects/resolver.js';
import { resolveHandSize, isWardedAgainst, resolveDef } from '../effects/index.js';
import { cardName, matchesDefinition, playerById, isNazgulPermanentEvent, getCardEffects, defById, countCopiesInPlay, countCompanyBoundCopies, countPermanentEventCopiesAtSite, companyEffectiveSize, defNamesOf, itemKeywordsOf, itemSubtypesOf, isCardNameInPlayOrCharacters, findDuplicationLimitEffect, findPlayConditionEffect, activePlayerDeckSize, cardPlayerDeckSize, selectCompanyActions, parseHomesiteNames, filterSideboardByDef, buildTargetCompanyConditionContext, agentHomeSiteMatchesTypes, isAgentCharacter, siteRuleAllowsCreatureByRace, countSpawnCardsInPlay, stageCardsHeld, agentCurrentSiteName, agentMatchesFilter, regionTypeCounts, satisfiedRegionTypes, deriveFacedRaces, raceForCardTextFilter, wouldViolateRingwraithComposition, countUnresolvedChainHazards, hazardPlayer } from '../reducer-utils.js';
import { isCardPlayProhibited } from '../card-play-prohibition.js';
import { constraintFromCard, countConstraintsFromDefinition, hasCancelReturnAndSiteTap, hasNazgulBoostBeenUsed } from '../pending.js';
import { buildInPlayNames, sitePlayTargetContext } from '../recompute-derived.js';
import { companyMovementRestrictions } from '../effects/company-restrictions.js';
import { logDetail, logHeading } from './log.js';
import { sideboardFetchSubflowActions } from './sideboard-subflow.js';
import { playPermanentEventActions, playShortEventActions } from './organization-events.js';
import { grantedActionActivations, buildPlayOptionContext, playerStateGateMet } from './organization.js';
import { heroResourceShortEventActions } from './long-event.js';
import { recruitViaEventActions } from './recruit-via-event.js';
import { manifestationSwapActions } from './manifestation-swap.js';
import { discardToRecruitActions } from './discard-to-recruit.js';
import { emitGrantedActionConstraintActions } from './granted-action-constraints.js';
import { countExtraAgentActions } from '../mh-agents.js';
import { extraMHMoveDestinations, extraMHUnderDeepsDestinations, gangwaysExtraDestinations } from '../mh-hazard-play.js';
import { buildCompanyCompositionContext } from '../company-composition.js';
import { currentHazardLimit } from '../hazard-limit.js';
import { computeCandidateRegionPaths } from '../region-keying.js';
import { asViable as viable } from './evaluated.js';
import { notPlayable } from './action-builders.js';
import { findEnvironmentTargets } from '../environment-targets.js';
import { cardTargetsSetAside } from '../set-aside.js';

/**
 * Compute legal actions for the movement/hazard phase.
 *
 * The first step ('select-company') requires the resource player to choose
 * which of their unhandled companies will resolve next. No pass is allowed —
 * a company must be selected.
 */
export function movementHazardActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  const mhState = requirePhaseState(state, Phase.MovementHazard);

  logHeading(`Movement/hazard phase (step: ${mhState.step}): player is ${isActive ? 'active (mover)' : 'non-active (hazard player)'}`);

  // Wound corruption checks (Barrow-wight et al.) are now produced and
  // consumed via the unified pending-resolution system; the
  // resolution short-circuit in `legal-actions/index.ts` handles them
  // before this function is reached.

  if (mhState.step === 'select-company') {
    const base = viable(selectCompanyActions(state, playerId, mhState.handledCompanyIds));
    // Every remaining company may have dissolved after the phase began — the
    // resource player's last character can fail a corruption check at this very
    // step, and rule 2.IV.1 has a player with no companies skip the phase. The
    // entry check in reducer-events only sees the company count at the
    // long-event → M/H transition, so without a pass here the phase has no exit
    // and neither player has a viable action. Mirror of the site phase's own
    // select-company step (legal-actions/site.ts).
    if (isActive && base.length === 0) {
      logDetail('M/H select-company: no companies left to select — offering pass to end the phase');
      base.push({ action: { type: 'pass', player: playerId }, viable: true });
    }
    // Rule 2.1.1: resource player may play resource short-events and
    // resource permanent-events during any phase of their turn, including
    // before selecting which company moves next — e.g. Bade to Rule
    // (le-167)'s untargeted alternative mode ("playable if your Ringwraith
    // is not in play"), which has no site/company target and so was
    // wrongly gated behind company selection. Mirrors the equivalent
    // allowance already offered at the site phase's own select-company step
    // (legal-actions/site.ts).
    if (isActive) {
      base.push(...heroResourceShortEventActions(state, playerId, 'movement-hazard'));
      base.push(...playPermanentEventActions(state, playerId));
    }
    return base;
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

  // region-shortcut-attack step (Ash Mountains tw-194 family): once the
  // forced attack resolves (state.combat clears, handled generically before
  // this dispatcher runs), only pass to advance to set-hazard-limit.
  if (mhState.step === 'region-shortcut-attack') {
    if (!isActive) {
      logDetail(`Not active player — no actions during region-shortcut-attack step`);
      return [];
    }
    logDetail(`Region shortcut attack resolved — pass to advance to set-hazard-limit`);
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

  // gangways-offer step (Gangways over the Fire, ba-60): the active player may
  // send the company that just finished its M/H phase on another Under-deeps
  // movement, or pass to finish it.
  if (mhState.step === 'gangways-offer') {
    if (!isActive) {
      logDetail(`Not active player — no actions during gangways-offer step`);
      return [];
    }
    return viable(gangwaysOfferActions(state, playerId, mhState));
  }

  // extra-mh-move-offer step (grant-extra-mh-phase resources — Forced March
  // le-185, Bridge tw-202, Leg It Double Quick le-202): the active player may
  // send the company that just finished its M/H phase on another movement to an
  // additional site, or pass to finish it.
  if (mhState.step === 'extra-mh-move-offer') {
    if (!isActive) {
      logDetail(`Not active player — no actions during extra-mh-move-offer step`);
      return [];
    }
    return viable(extraMHMoveOfferActions(state, playerId, mhState));
  }

  // ally-tap-mh-offer step (ally-tap-extra-mh-phase — Shadowfax tw-326): the
  // active player may tap the qualifying ally to advance to the shared
  // extra-mh-move-offer step, or pass to finish the company.
  if (mhState.step === 'ally-tap-mh-offer') {
    if (!isActive) {
      logDetail(`Not active player — no actions during ally-tap-mh-offer step`);
      return [];
    }
    return viable(allyTapExtraMHOfferActions(state, playerId, mhState));
  }

  // character-tap-mh-offer step (character-tap-extra-mh-phase — Carambor
  // le-5): the active player may tap the qualifying bearer character to
  // advance to the shared extra-mh-move-offer step, or pass to finish the
  // company.
  if (mhState.step === 'character-tap-mh-offer') {
    if (!isActive) {
      logDetail(`Not active player — no actions during character-tap-mh-offer step`);
      return [];
    }
    return viable(characterTapExtraMHOfferActions(state, playerId, mhState));
  }

  // TODO: assign-strike, resolve-strike, support-strike
  if (!isActive) {
    logDetail(`Not active player, no movement/hazard actions`);
    return [];
  }

  return viable([{ type: 'pass', player: playerId }]);
}

/**
 * Generate actions for the gangways-offer step (Gangways over the Fire, ba-60).
 *
 * The active player may send the company that just finished its movement/hazard
 * phase on another Under-deeps movement to a site it has not used this turn
 * (each offered as a `gangways-extra-move`), or pass to finish the company.
 * Candidate destinations are Under-deeps-adjacent sites still in the site deck,
 * excluding any site the company has already occupied this turn.
 */
function gangwaysOfferActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  const activeIndex = getPlayerIndex(state, playerId);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  const actions: GameAction[] = [];
  if (company?.moved) {
    const used = mhState.gangwaysSitesUsed?.[company.id as string] ?? [];
    for (const siteInst of gangwaysExtraDestinations(state, activeIndex, company, used)) {
      actions.push({ type: 'gangways-extra-move', player: playerId, companyId: company.id, destinationSite: siteInst.instanceId });
      logDetail(`Gangways over the Fire: offering extra Under-deeps move to ${defById(state, siteInst.definitionId)?.name ?? '?'}`);
    }
  }
  // Always allow passing to finish the company.
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Generate actions for the `extra-mh-move-offer` step (`grant-extra-mh-phase`
 * resources — Forced March le-185, Bridge tw-202, Leg It Double Quick le-202).
 *
 * The active player may send the company that just finished its movement/hazard
 * phase on another movement to any site normally reachable from its current site
 * (each offered as an `extra-mh-move`), or pass to finish the company.
 */
function extraMHMoveOfferActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  const activeIndex = getPlayerIndex(state, playerId);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  const actions: GameAction[] = [];
  if (company) {
    // Under-deeps variant (World Gnawed by the Nameless as-110): offer only
    // Under-deeps sites adjacent to the current site that the company has not
    // attempted to move to yet this turn.
    const destinations = mhState.extraMHMoveUnderDeeps
      ? extraMHUnderDeepsDestinations(state, activeIndex, company, mhState.underDeepsAttempts?.[company.id as string] ?? [])
      : extraMHMoveDestinations(state, activeIndex, company, mhState.extraMHMoveRequiresSitePathIncludes);
    for (const siteInst of destinations) {
      const destDef = defById(state, siteInst.definitionId);
      actions.push({ type: 'extra-mh-move', player: playerId, companyId: company.id, destinationSite: siteInst.instanceId });
      logDetail(`Extra M/H phase: offering extra ${mhState.extraMHMoveUnderDeeps ? 'Under-deeps ' : ''}move to ${destDef?.name ?? (siteInst.definitionId as string)}`);
    }
  }
  // Always allow passing to finish the company.
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Generate actions for the `ally-tap-mh-offer` step (`ally-tap-extra-mh-phase`
 * — Shadowfax tw-326): the active player either taps the qualifying untapped
 * ally to advance to the shared `extra-mh-move-offer` step, or passes to
 * finish the company. Re-derives the same match `advanceAfterCompanyMH` used
 * to enter this step, so the offered ally is always the one that qualified.
 */
function allyTapExtraMHOfferActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  const activeIndex = getPlayerIndex(state, playerId);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  const actions: GameAction[] = [];
  if (company) {
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
        actions.push({ type: 'ally-tap-extra-mh-phase', player: playerId, companyId: company.id, allyInstanceId: ally.instanceId });
        logDetail(`Ally-tap extra M/H phase: offering to tap ${def && 'name' in def ? (def as { name: string }).name : (ally.definitionId as string)}`);
      }
    }
  }
  // Always allow passing to finish the company.
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Generate actions for the `character-tap-mh-offer` step
 * (`character-tap-extra-mh-phase` — Carambor le-5): the active player either
 * taps the qualifying untapped bearer character to advance to the shared
 * `extra-mh-move-offer` step, or passes to finish the company. Re-derives the
 * same match `advanceAfterCompanyMH` used to enter this step, so the offered
 * character is always the one that qualified.
 */
function characterTapExtraMHOfferActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): GameAction[] {
  const activeIndex = getPlayerIndex(state, playerId);
  const player = state.players[activeIndex];
  const company = player.companies[mhState.activeCompanyIndex];
  const actions: GameAction[] = [];
  if (company) {
    for (const charId of company.characters) {
      const char = player.characters[charId];
      if (!char || char.status !== CardStatus.Untapped) continue;
      const def = defById(state, char.definitionId);
      const effect = def && getCardEffects(def).find(
        (e): e is CharacterTapExtraMHPhaseEffect => e.type === 'character-tap-extra-mh-phase',
      );
      if (!effect) continue;
      actions.push({ type: 'character-tap-extra-mh-phase', player: playerId, companyId: company.id, characterInstanceId: char.instanceId });
      logDetail(`Character-tap extra M/H phase: offering to tap ${def && 'name' in def ? (def as { name: string }).name : (char.definitionId as string)}`);
    }
  }
  // Always allow passing to finish the company.
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Generate play actions for `grant-extra-mh-phase` resource short-events
 * (Forced March le-185, Bridge tw-202, Leg It Double Quick le-202) during the
 * play-hazards step. The card is playable at the end of the M/H phase on the
 * active company only when that company is moving and its destination meets the
 * effect's requirement (site type / alignment — e.g. a Darkhaven for Forced
 * March). Resolving the event flags the company for an extra movement/hazard
 * phase (see `handlePlayResourceShortEvent` / `advanceAfterCompanyMH`).
 */
function extraMHPhaseResourceActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;
  const company = player.companies[mhState.activeCompanyIndex];
  if (!company) return actions;

  const destDef = company.destinationSite ? defById(state, company.destinationSite.definitionId) : undefined;
  const destSite = destDef && isSiteCard(destDef) ? destDef : undefined;

  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    const effect = def && getCardEffects(def).find(
      (e): e is import('../../types/effects.js').GrantExtraMHPhaseEffect => e.type === 'grant-extra-mh-phase',
    );
    if (!def || !effect) continue;
    const cardInstanceId = handCard.instanceId;

    // Must be a moving company (there is no "additional" site to move to otherwise).
    if (!destSite) {
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: the company is not moving`));
      continue;
    }
    if (effect.requiresDestinationSiteType && destSite.siteType !== effect.requiresDestinationSiteType) {
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: the company is not moving to a ${effect.requiresDestinationSiteType}`));
      continue;
    }
    // Under-deeps variant (World Gnawed by the Nameless as-110): "Playable
    // during the movement/hazard phase on a company moving to an Under-deeps
    // site."
    if (effect.movement === 'under-deeps' && !(destSite.keywords?.includes('under-deeps') ?? false)) {
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: the company is not moving to an Under-deeps site`));
      continue;
    }
    if (effect.requiresDestinationAlignment && destSite.alignment !== effect.requiresDestinationAlignment) {
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: destination is not a ${effect.requiresDestinationAlignment} site`));
      continue;
    }
    logDetail(`Resource short-event "${def.name}" playable — company ${company.id as string} moving to ${destSite.name} qualifies for an extra M/H phase`);
    actions.push({ action: { type: 'play-short-event', player: playerId, cardInstanceId }, viable: true });
  }
  return actions;
}

/**
 * Region-name pairs an active `region-shortcut` constraint (Ash Mountains
 * tw-194 and its "movement enhancer" family) bound to `company` grants for
 * path-finding purposes, or null when no such constraint is bound or the
 * company has no untapped character with the required skill left to pay the
 * tap cost.
 */
function companyRegionShortcutPairs(
  state: GameState,
  player: PlayerState,
  company: Company,
): readonly (readonly [string, string])[] | null {
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'region-shortcut') continue;
    if (constraint.target.kind !== 'company' || constraint.target.companyId !== company.id) continue;
    const { pairs, requiredSkill } = constraint.kind;
    const hasEligibleCharacter = company.characters.some(charId => {
      const char = player.characters[charId];
      if (!char || char.status !== CardStatus.Untapped) return false;
      const def = defById(state, char.definitionId);
      return !!def && isCharacterCard(def) && (def.skills?.includes(requiredSkill) ?? false);
    });
    if (!hasEligibleCharacter) continue;
    return pairs;
  }
  return null;
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

  // CoE 2.II.2.1.R3 (rule 3.07): "Characters in a Ringwraith's company can only
  // be other Ringwraiths, unless at a Darkhaven." The restriction is
  // unconditional on the company's composition, not scoped to any particular
  // action — a company mixing a Ringwraith with non-Ringwraith characters is
  // legal only while it sits at a Darkhaven. Any movement takes it away from
  // that Darkhaven for the duration of the trip (it is not "at" the
  // destination until the M/H phase ends), so no movement path — starter,
  // region, under-deeps, or special — is ever legal for such a company. Rule
  // 5.04 already negates a movement with no legal path (destination returns to
  // the location deck, company stays put); reusing that here keeps the
  // company's already-legal composition at its current Darkhaven intact.
  if (wouldViolateRingwraithComposition(state, company.characters)) {
    logDetail(`Company ${company.id as string} mixes a Ringwraith with non-Ringwraith characters — rule 3.07 forbids it from moving away from a Darkhaven at all; movement to ${destDef.name} is illegal (rule 5.04), offering pass to negate it`);
    return [{ type: 'pass', player: playerId }];
  }

  const actions: GameAction[] = [];

  // --- Special movement (e.g. Gwaihir, Eagle-mounts, Paths of the Dead, Belegaer) ---
  if (company.specialMovement === 'gwaihir' || company.specialMovement === 'eagle-mounts' || company.specialMovement === 'paths-of-the-dead' || company.specialMovement === 'belegaer') {
    logDetail(`Special movement (${company.specialMovement}): ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.Special });
    return actions;
  }

  // --- Deep Mines descent / ascent (wh-55) ---
  // Descent (surface → Deep Mines) is reachable only from a protected
  // Wizardhaven with >6 stage points; ascent (Deep Mines → protected
  // Wizardhaven) runs back the same roll-0 adjacency. If the descent's
  // stage-point requirement is no longer met at reveal time, no path is offered
  // and the company stays put (rule 5.04) — matching the CRF ruling that the
  // company then "does not move at all".
  if (isDeepMinesSite(destDef) || isDeepMinesSite(originDef)) {
    const descentLegal = isDeepMinesSite(destDef)
      && isDeepMinesDescentLegal(state, originDef, company.currentSite?.definitionId, destDef, player);
    const ascentLegal = isDeepMinesSite(originDef)
      && isDeepMinesAscentLegal(state, originDef, destDef, company.destinationSite.definitionId, player);
    if (descentLegal || ascentLegal) {
      logDetail(`Deep Mines ${descentLegal ? 'descent' : 'ascent'} available: ${originDef.name} → ${destDef.name} (roll 0)`);
      actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.UnderDeeps });
    } else {
      // Rule 5.04: the planned move is no longer legal (e.g. the descent's
      // >6-stage-point requirement lapsed between plan-movement and reveal).
      // The player must still get an action — `pass` negates the movement
      // (handleRevealNewSite returns the destination to the location deck and
      // the company conducts its M/H phase at its current site), exactly like
      // the Ringwraith-composition branch above. Returning no action here
      // deadlocked the game (r/1 bench seed 10600011: FW company planned
      // Rhosgobel → Deep Mines at ≥7 stage points, dropped to 6 by reveal).
      logDetail(`Deep Mines move ${originDef.name} → ${destDef.name} no longer legal (stage points ${player.stagePoints} or origin/dest not a protected Wizardhaven) — offering pass to negate the movement (rule 5.04)`);
      actions.push({ type: 'pass', player: playerId });
    }
    return actions;
  }

  const movementMap = buildMovementMap(state.cardPool, player.alignment);

  // Under-deeps sites cannot be reached by starter or region movement — only under-deeps movement applies.
  const originIsUD = originDef.keywords?.includes('under-deeps') ?? false;
  const destIsUD = destDef.keywords?.includes('under-deeps') ?? false;
  const isUnderDeepsMovement = originIsUD || destIsUD;

  // MEBA: a company containing The Balrog avatar may not use starter or region
  // movement ("as stated on his card") — only Under-deeps movement. (Going Ever
  // Under Dark ba-37 is a restriction, not a movement grant — it never lifts
  // this lock; it only *removes* starter movement and caps region distance for
  // whatever company it is bound to.)
  const balrogMovementLocked = companyContainsBalrogAvatar(state, player, company);
  // CoE 2.II.7.R1: a company containing a Ringwraith avatar can only use
  // Starter Movement or Under-deeps Movement, mode or no mode — Region
  // Movement is never available to it.
  const ringwraithRegionLocked = companyContainsRingwraithAvatar(state, player, company);
  if (ringwraithRegionLocked) {
    logDetail(`Company ${company.id as string} contains a Ringwraith avatar — region movement suppressed (2.II.7.R1)`);
  }
  // Out He Sprang (ba-71): lifts the region-movement half of the Balrog lock for
  // movement to/from an Under-deeps surface site (Great Shadow must not be in
  // play). The returned allowance is a fixed region cap not modifiable by any
  // other effect. Starter movement stays blocked; this grant is region-only.
  const outHeSprangAllowance = balrogMovementLocked
    ? balrogOutHeSprangRegionAllowance(state, player, company)
    : null;
  const balrogRegionAllowed = outHeSprangAllowance !== null;
  if (balrogMovementLocked && !balrogRegionAllowed) {
    logDetail(`Company ${company.id as string} contains The Balrog — starter/region movement suppressed (Under-deeps only)`);
  } else if (balrogRegionAllowed) {
    logDetail(`Company ${company.id as string} contains The Balrog — region movement granted by Out He Sprang (up to ${outHeSprangAllowance} region(s)); starter movement still suppressed`);
  }

  // A company-bound movement restriction (Going Ever Under Dark ba-37) forbids
  // starter movement for the bound company ("The company cannot use starter
  // movement"). The region cap is enforced separately via mhState.maxRegionDistance.
  const moveRestriction = companyMovementRestrictions(player, company, state);
  const noStarterRestriction = moveRestriction?.noStarterMovement === true;
  if (noStarterRestriction) {
    logDetail(`Company ${company.id as string}: a movement-restriction card forbids starter movement`);
  }
  // Crept Along Carefully (ba-29): "or move to an Under-deeps site" — the
  // company's destination was never offered as an Under-deeps candidate during
  // org-phase plan-movement (see organization-companies.ts), but this guards
  // the declare-path step too in case the restriction was bound after the
  // destination was already planned.
  const noUnderDeepsRestriction = moveRestriction?.noUnderDeepsMovement === true;
  if (noUnderDeepsRestriction) {
    logDetail(`Company ${company.id as string}: a movement-restriction card forbids Under-deeps movement`);
  }

  // --- Starter movement ---
  if (!isUnderDeepsMovement && !balrogMovementLocked && !noStarterRestriction && isStarterMovementPossible(movementMap, originDef, destDef)) {
    logDetail(`Starter movement available: ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.Starter });
  }

  // --- Region movement ---
  const originRegion = movementMap.siteRegion.get(originDef.name);
  const destRegion = movementMap.siteRegion.get(destDef.name);
  if (!isUnderDeepsMovement && (!balrogMovementLocked || balrogRegionAllowed) && !ringwraithRegionLocked && originRegion && destRegion) {
    // Build region name → definition ID map for converting path names to IDs
    const regionNameToId = buildRegionNameMap(state);
    // Out He Sprang fixes the Balrog's region distance at its MP-derived
    // allowance, overriding mhState.maxRegionDistance ("may not be modified by
    // any other effects").
    let regionCap = outHeSprangAllowance ?? mhState.maxRegionDistance;
    // A More Evil Hour (ba-48): +2 region distance when moving to — or away
    // from — a site where an opponent's company is present. Never applies when
    // Out He Sprang has fixed the allowance.
    if (outHeSprangAllowance === null) {
      regionCap += evilHourRegionBonus(state, player, company, originDef, destDef);
    }
    // Anduin River (tw-191) and the "mountain-crossing" family: "tap the
    // ranger to move as if the following pairs of regions were adjacent" —
    // a region-adjacency-shortcut constraint on this company widens the
    // graph pathfinding walks for its declared move ("if the company uses
    // region cards for its site path"; a no-op if it ends up using starter
    // or Under-deeps movement instead, since this branch is region-only).
    const adjacencyShortcutPairs = state.activeConstraints
      .filter(c => c.kind.type === 'region-adjacency-shortcut'
        && c.target.kind === 'company' && c.target.companyId === company.id)
      .flatMap(c => (c.kind as { pairs: readonly (readonly [string, string])[] }).pairs);
    let pathMovementMap = adjacencyShortcutPairs.length > 0
      ? withExtraRegionAdjacency(movementMap, adjacencyShortcutPairs)
      : movementMap;
    // Ash Mountains (tw-194) and its "movement enhancer" family: a bound
    // region-shortcut constraint treats its named region pairs as extra
    // adjacency edges for path-finding, but only while the company still has
    // an untapped character carrying the required skill to pay the tap cost
    // — a superset of the plain graph, so this only ever adds paths.
    const regionShortcutPairs = companyRegionShortcutPairs(state, player, company);
    if (regionShortcutPairs) pathMovementMap = withVirtualAdjacency(pathMovementMap, regionShortcutPairs);
    const paths = findRegionPaths(pathMovementMap, originRegion, destRegion, regionCap);
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
  if (!noUnderDeepsRestriction && isUnderDeepsAdjacent(state, originDef, destDef, playerId)) {
    logDetail(`Under-deeps movement available: ${originDef.name} → ${destDef.name}`);
    actions.push({ type: 'declare-path', player: playerId, movementType: MovementType.UnderDeeps });
  }

  logDetail(`${actions.length} possible movement path(s) for company ${company.id as string}`);

  // Rule 5.04: if the company was moving but no legal path reaches its
  // declared destination (e.g. an environment effect played after the
  // organization-phase declaration reduced `mhState.maxRegionDistance` below
  // the declared path's length), the movement is illegal.
  // Offer 'pass' so `handleRevealNewSite` can negate it: the destination
  // returns to the location deck and the company still conducts a full
  // movement/hazard phase at its current site.
  if (actions.length === 0) {
    logDetail(`Company ${company.id as string} was moving to ${destDef.name} but no legal path remains — movement illegal (rule 5.04), offering pass to negate it`);
    return [{ type: 'pass', player: playerId }];
  }
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

    // Rule g.man.1: a manifestation may not be played while another
    // manifestation of the same entity is in play (either player) — e.g. the
    // agent Lobelia (dm-28) while the ally Mistress Lobelia (dm-178) is in play.
    const blockingManifestation = manifestationOfEntityInPlay(state, def);
    if (blockingManifestation) {
      logDetail(`Agent "${def.name}": blocked — manifestation "${blockingManifestation}" already in play`);
      actions.push({ action, viable: false, reason: `A manifestation of this entity (${blockingManifestation}) is already in play` });
    } else if (limitReached) {
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
 * If a face-down agent carries an `agent-reveal-site-override` permanent event
 * (Inner Cunning dm-68 mode 1) *and* its printed home site is a site of one of
 * the override types, returns the override site types (the reveal site may be
 * broadened to any location-deck site of those types). Returns `null`
 * otherwise. The event lives in the owning player's `cardsInPlay` bound to the
 * agent via {@link CardInPlay.attachedToAgentId}.
 */
function agentRevealSiteOverrideTypes(
  state: GameState,
  player: PlayerState,
  agent: AgentInPlay,
  agentDef: CharacterCard,
): readonly SiteType[] | null {
  for (const cip of player.cardsInPlay) {
    if (cip.attachedToAgentId !== agent.id) continue;
    const def = defById(state, cip.definitionId);
    const override = def && getCardEffects(def).find(
      (e): e is import('../../types/effects.js').AgentRevealSiteOverrideEffect => e.type === 'agent-reveal-site-override',
    );
    if (!override) continue;
    if (!agentHomeSiteMatchesTypes(state, agentDef, override.homeSiteTypes)) continue;
    return override.homeSiteTypes;
  }
  return null;
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
export function revealAgentActions(
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

    // Inner Cunning (dm-68) mode 1: if this face-down agent carries an
    // `agent-reveal-site-override` event and its printed home site is one of the
    // override types, the agent may be revealed at ANY location-deck site of
    // those types — not only at a site matching its printed home-site name.
    const overrideTypes = agentRevealSiteOverrideTypes(state, player, agent, agentDef);

    // Emit one action per matching site instance in the location deck
    const seenNames = new Set<string>();
    for (const siteInst of player.siteDeck) {
      const siteDef = defById(state, siteInst.definitionId);
      if (!siteDef || !isSiteCard(siteDef)) continue;
      const nameMatch = homesiteNames.includes(siteDef.name);
      const typeMatch = overrideTypes !== null && overrideTypes.includes(siteDef.siteType);
      if (!nameMatch && !typeMatch) continue;
      if (seenNames.has(siteDef.name)) continue;
      seenNames.add(siteDef.name);

      logDetail(`Agent reveal: ${agentDef.name} can reveal at ${nameMatch ? 'home' : 'override'} site "${siteDef.name}"`);
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
  const def = state.cardPool[defId as CardDefinitionId];
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

    const extraAgentActions = countExtraAgentActions(state, agent.id);
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
      const hazardAlignment = player.alignment;
      // Agents navigate their owner's (minion/balrog) side of the site graph;
      // restrict the map and candidates to that alignment so same-named sites
      // of the hero side don't create phantom destinations.
      const movementMap = buildMovementMap(state.cardPool, hazardAlignment);
      const allSiteDefs = Object.values(state.cardPool).filter(
        (s): s is SiteCard => isSiteCard(s) && s.alignment === hazardAlignment,
      );

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

      // Per-card site-type movement restriction (e.g. Baugúr dm-181: "Agent
      // only: Cannot move to Free-holds and Border-holds"). Collect the
      // forbidden site types from the agent's own `agent-move-restriction`
      // effects.
      const restrictedSiteTypes = new Set<string>();
      const allowedSiteNames = new Set<string>();
      const allowedRegionNames = new Set<string>();
      let hasAllowList = false;
      if (agentDef && isCharacterCard(agentDef)) {
        for (const eff of agentDef.effects ?? []) {
          if (eff.type === 'agent-move-restriction') {
            for (const st of eff.siteTypes ?? []) restrictedSiteTypes.add(st);
            if (eff.allowedSiteNames || eff.allowedRegionNames) {
              hasAllowList = true;
              for (const n of eff.allowedSiteNames ?? []) allowedSiteNames.add(n);
              for (const r of eff.allowedRegionNames ?? []) allowedRegionNames.add(r);
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
        // Exclude haven sites (rule 9.07) — unless the agent's card grants the
        // `agent-may-move-to-haven` exemption (e.g. Elwen dm-8: "Agent only:
        // may move to a Haven").
        if (isHavenSite(state, siteInst.definitionId as string)
          && !(agentDef && isCharacterCard(agentDef) && hasPlayFlag(agentDef, 'agent-may-move-to-haven'))) continue;
        // Per-card restriction: skip forbidden site types (rule on card text).
        if (restrictedSiteTypes.has(destDef.siteType)) {
          logDetail(`Agent ${agentName}: cannot move to "${destDef.name}" (${destDef.siteType} restricted by card text)`);
          continue;
        }
        // Per-card allow-list (e.g. Lobelia dm-28): may move ONLY to named sites
        // or sites in named regions.
        if (hasAllowList && !allowedSiteNames.has(destDef.name) && !(destDef.region && allowedRegionNames.has(destDef.region))) {
          logDetail(`Agent ${agentName}: cannot move to "${destDef.name}" (not in the card's allowed sites/regions)`);
          continue;
        }
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
/**
 * The name of the site a company is (or is moving) to: its pending destination
 * this turn if it has one, otherwise its current site. Returns null when
 * neither resolves. Shared by the agent tap-influence and tap-attack
 * legal-action computers (an agent may act against a company at the site the
 * company will occupy this turn).
 */
function companyTargetSiteName(state: GameState, company: Company, destSiteName: string | null): string | null {
  let currentSiteName: string | null = null;
  if (company.currentSite) {
    const d = defById(state, company.currentSite.definitionId);
    currentSiteName = d && isSiteCard(d) ? d.name : null;
  }
  return destSiteName ?? currentSiteName;
}

/**
 * Resolves the shared context of the M/H agent-ability emitters: the hazard
 * player owning the agents, the resource player, and the resource player's
 * active company. Returns null when the active company no longer resolves.
 */
function mhAgentContext(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): { hazardPlayer: PlayerState; resourcePlayer: PlayerState; company: Company } | null {
  const hazardPlayerIndex = getPlayerIndex(state, playerId);
  const hazardPlayer = state.players[hazardPlayerIndex];
  const resourcePlayer = state.players[1 - hazardPlayerIndex];
  const company = resourcePlayer.companies[mhState.activeCompanyIndex];
  return company ? { hazardPlayer, resourcePlayer, company } : null;
}

/**
 * Iterates the hazard player's agents eligible to use an M/H agent ability
 * declared by an `effectType` card effect: in play since turn start
 * (`inPlayAtTurnStart`), not wounded (Inverted), with a resolvable character
 * definition carrying the effect. Invokes `cb` with the agent, its
 * definition, the matching effect, and the agent's current site name (null
 * when unresolved) — the prologue every agent-ability emitter repeated.
 */
function forEachEligibleAgent<E extends { type: string }>(
  state: GameState,
  hazardPlayer: PlayerState,
  effectType: E['type'],
  cb: (agent: AgentInPlay, agentDef: CharacterCard, effect: E, agentSiteName: string | null) => void,
): void {
  for (const agent of hazardPlayer.agents) {
    if (!agent.inPlayAtTurnStart) continue;
    if (agent.character.status === CardStatus.Inverted) continue; // wounded

    const agentDef = defById(state, agent.character.definitionId);
    if (!agentDef || !isCharacterCard(agentDef)) continue;

    const effect = (agentDef.effects ?? []).find(e => e.type === effectType) as E | undefined;
    if (!effect) continue;

    cb(agent, agentDef, effect, agentCurrentSiteName(state, agent, agentDef));
  }
}

function agentInfluenceActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const ctx = mhAgentContext(state, playerId, mhState);
  if (!ctx) return [];
  const { hazardPlayer, resourcePlayer, company } = ctx;

  // Agent site lookups resolve by name; restrict to the agent owner's
  // (hazard) alignment so a same-named hero site isn't picked by mistake.
  const allSiteDefs = Object.values(state.cardPool).filter(
    (s): s is SiteCard => isSiteCard(s) && s.alignment === hazardPlayer.alignment,
  );

  type TapInfluenceEffect = { type: 'agent-tap-influence'; targetKinds: readonly ('character' | 'ally' | 'faction')[] };
  forEachEligibleAgent<TapInfluenceEffect>(state, hazardPlayer, 'agent-tap-influence', (agent, agentDef, tapInfluenceEff, agentSiteName) => {
    // Tap-cost ability: only an untapped agent can pay the tap (rule 10.14).
    if (agent.character.status !== CardStatus.Untapped) {
      logDetail(`Agent tap-influence ${agentDef.name}: not untapped — cannot pay the tap cost, skipping`);
      return;
    }
    // The target company's site this turn.
    const companySiteName = companyTargetSiteName(state, company, mhState.destinationSiteName);

    const isAgentAtCompanySite = agentSiteName !== null && companySiteName !== null && agentSiteName === companySiteName;

    const opponentGI = GENERAL_INFLUENCE - resourcePlayer.generalInfluenceUsed;

    // --- Character and ally targets (agent must be at company's site) ---
    if (isAgentAtCompanySite) {
      // Use the active company directly — for moving companies currentSite is the origin,
      // but we already verified the agent is at the destination via isAgentAtCompanySite.
      for (const oppCharId of company.characters) {
        const oppChar = resourcePlayer.characters[oppCharId];
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
          // "May not be influenced by an opponent" (Army of the Dead tw-193):
          // rule-10.14 agent influence is a second route to the same CoE 8.3
          // re-influence outcome, so it must honor the same suppression.
          if (factionDef.noOpponentInfluence) continue;

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
  });

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
  const ctx = mhAgentContext(state, playerId, mhState);
  if (!ctx) return [];
  const { hazardPlayer, company } = ctx;

  const companySiteName = companyTargetSiteName(state, company, mhState.destinationSiteName);

  forEachEligibleAgent<AgentTapAttackEffect>(state, hazardPlayer, 'agent-tap-attack', (agent, agentDef, _tapAttackEff, agentSiteName) => {
    // Tap-cost ability: only an untapped agent can pay the tap ("may tap to
    // attack"), so a spent agent cannot attack again this phase.
    if (agent.character.status !== CardStatus.Untapped) {
      logDetail(`Agent tap-attack ${agentDef.name}: not untapped — cannot pay the tap cost, skipping`);
      return;
    }
    const isAgentAtCompanySite =
      agentSiteName !== null && companySiteName !== null && agentSiteName === companySiteName;
    if (!isAgentAtCompanySite) {
      logDetail(`Agent tap-attack ${agentDef.name}: not at company's site (agent: ${agentSiteName ?? 'unknown'}, company: ${companySiteName ?? 'unknown'}) — skipping`);
      return;
    }

    logDetail(`Agent tap-attack ${agentDef.name}: at company site "${companySiteName}" — offering attack`);

    if (!agent.revealed && agent.siteStack.length > 0) {
      // Traveled face-down agent: its current site card is already on top of
      // its own stack — the reveal needs no deck card and carries no rule
      // 4.2.2 / 9.04 penalty. Offer the plain attack; a homeSiteInstanceId
      // variant would (wrongly) pull a home-site card from the deck.
      logDetail(`Agent tap-attack ${agentDef.name}: face-down with traveled site stack — offering without home site`);
      actions.push({
        action: { type: 'agent-tap-attack', player: playerId, agentId: agent.id } as AgentTapAttackAction,
        viable: true,
      });
    } else if (!agent.revealed) {
      // Face-down: offer one action per home site in deck (reveal at attack)
      const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
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
  });

  return actions;
}

/**
 * Generate `agent-discard-return-to-origin` actions for agents with the
 * `agent-discard-return-to-origin` effect (e.g. Baduila dm-2).
 *
 * - Does NOT count as an agent action (actedThisTurn is not set).
 * - Does NOT count against the hazard limit.
 * - Agent must have been in play at start of turn (inPlayAtTurnStart).
 * - Agent must not be wounded (a wounded character may not use special
 *   abilities); tapped agents may still be discarded — no tap is required.
 * - The company must be moving to a NEW site this turn (the card reads
 *   "at target company's new site") and the agent must be at that site.
 * - A face-down agent may be discarded too: its identity is revealed by the
 *   discard itself, so no home-site binding is needed.
 */
function agentDiscardReturnToOriginActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const ctx = mhAgentContext(state, playerId, mhState);
  if (!ctx) return [];
  const { hazardPlayer, company } = ctx;

  // The company must be moving to a new site (revealed) and not already returned.
  if (!company.destinationSite || !mhState.destinationSiteName) return [];
  if (mhState.returnedToOrigin) return [];

  // Promptings of Wisdom (wh-34) / Piercing All Shadows (wh-47) / Govern the
  // Storms (wh-45): a `cancel-return-and-site-tap` constraint on this company
  // negates rule 2.IV.4 force-return-to-origin for the rest of the turn.
  if (hasCancelReturnAndSiteTap(state, company.id)) {
    logDetail(`Agent discard-return-to-origin: company ${company.id as string} is shielded by cancel-return-and-site-tap — not offered`);
    return [];
  }

  forEachEligibleAgent<AgentDiscardReturnToOriginEffect>(state, hazardPlayer, 'agent-discard-return-to-origin', (agent, agentDef, _discardEff, agentSiteName) => {
    if (agentSiteName === null || agentSiteName !== mhState.destinationSiteName) {
      logDetail(`Agent discard-return-to-origin ${agentDef.name}: not at company's new site (agent: ${agentSiteName ?? 'unknown'}, new site: ${mhState.destinationSiteName}) — skipping`);
      return;
    }

    logDetail(`Agent discard-return-to-origin ${agentDef.name}: at company's new site "${mhState.destinationSiteName}" — offering discard`);
    actions.push({
      action: { type: 'agent-discard-return-to-origin', player: playerId, agentId: agent.id } as AgentDiscardReturnToOriginAction,
      viable: true,
    });
  });

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
 * Generate discard-card-for-hazard-limit actions for cardsInPlay permanent
 * events carrying a {@link DiscardForHazardLimitEffect} (the 9 Dragon "At
 * Home" events, METD §4).
 *
 * The hazard player may discard such a card from play during the opponent's
 * M/H phase — not counting against the hazard limit — to increase the hazard
 * limit against the current target company by the effect's `value`. Because
 * the boost is paid by removing the card from play (no tap/status gate), the
 * action is always viable while the card is in play.
 */
function discardForHazardLimitActions(
  state: GameState,
  playerId: PlayerId,
  targetCompanyId: CompanyId,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId)!;

  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const effect = getCardEffects(def).find((e): e is DiscardForHazardLimitEffect => e.type === 'discard-for-hazard-limit');
    if (!effect) continue;

    logDetail(`${def.name}: offering discard-card-for-hazard-limit (+${effect.value} hazard limit against company ${targetCompanyId as string})`);
    const action: DiscardCardForHazardLimitAction = {
      type: 'discard-card-for-hazard-limit',
      player: playerId,
      cardInstanceId: card.instanceId,
      targetCompanyId,
    };
    actions.push({ action, viable: true });
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
        if (race !== Race.Dragon && race !== Race.Drake) continue;
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
          || siteAllowsCreatureByRace(state, targetCompany, creatureDef)
          || siteAllowsCreatureByKeying(state, targetCompany, creatureDef)
          || grantsCreatureKeying(state, mhState, resourcePlayer, targetCompany, creatureDef);

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
        || siteAllowsCreatureByRace(state, targetCompany, creatureDef)
        || siteAllowsCreatureByKeying(state, targetCompany, creatureDef)
        || grantsCreatureKeying(state, mhState, resourcePlayer, targetCompany, creatureDef);

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
 * Generate spawn-replay-creature actions for in-play permanent-events carrying
 * a `grant-replay-attacked-creature` effect (Monstrosity of Diverse Shape,
 * ba-21).
 *
 * For each such permanent-event in the hazard player's `cardsInPlay`, enumerate
 * their discard pile for hazard-creatures matching the effect's `filter` (e.g.
 * Wolf / Animal) whose card name already appears in the current company's
 * `hazardsEncountered` list ("This card must have already attacked the company
 * this turn"). A creature is offered only if it can still be keyed against the
 * target company and the chain is null (creatures initiate a new chain). Unlike
 * Exhalation of Decay, this replay DOES count against the hazard limit and is
 * offered only once per company's M/H phase per source (tracked in
 * `spawnReplayUsedSources`). One action is emitted per (creature, keying-match).
 */
function spawnReplayCreatureFromDiscardActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  targetCompanyId: CompanyId,
  limitReached: boolean,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;

  // The replay counts against the hazard limit — do not offer when reached.
  if (limitReached) return actions;

  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIdx];
  const targetCompany = resourcePlayer.companies[mhState.activeCompanyIndex];
  if (!targetCompany) return actions;

  const usedSources = mhState.spawnReplayUsedSources ?? [];
  const encountered = mhState.hazardsEncountered;

  for (const sourceCard of player.cardsInPlay) {
    const sourceDef = defById(state, sourceCard.definitionId);
    if (!sourceDef) continue;
    const effect = getCardEffects(sourceDef).find(
      (e): e is import('../../types/effects.js').GrantReplayAttackedCreatureEffect =>
        e.type === 'grant-replay-attacked-creature',
    );
    if (!effect) continue;

    const sourceName = (sourceDef as { name?: string })?.name ?? (sourceCard.definitionId as string);

    // Once per company's M/H phase per source.
    if (usedSources.includes(sourceCard.instanceId)) {
      logDetail(`${sourceName}: replay-attacked-creature already used this M/H phase`);
      continue;
    }

    // Creatures must initiate a new chain — not playable in response.
    if (state.chain != null) {
      logDetail(`${sourceName}: replay-attacked-creature not available — chain in progress`);
      continue;
    }

    // Cancel-attacks site rule (e.g. Dol Guldur, Moria): when the target
    // company's effective site forbids creatures, this play is unavailable.
    const cancelSiteName = cancelAttacksSiteName(state, targetCompany);
    if (cancelSiteName) {
      logDetail(`${sourceName}: replay-attacked-creature blocked by site-rule on ${cancelSiteName}`);
      continue;
    }

    for (const discardCard of player.discardPile) {
      const creatureDef = defById(state, discardCard.definitionId);
      if (!creatureDef || creatureDef.cardType !== 'hazard-creature') continue;
      if (!matchesCondition(effect.filter, creatureDef as unknown as Record<string, unknown>)) continue;

      const creatureName = (creatureDef as { name?: string })?.name ?? (discardCard.definitionId as string);

      // "This card must have already attacked the company this turn" — the
      // creature's name must appear in the company's hazardsEncountered list.
      if (!encountered.includes(creatureName)) {
        logDetail(`${sourceName}: discard creature "${creatureName}" has not attacked this company this turn`);
        continue;
      }

      const matches = findCreatureKeyingMatches(creatureDef, mhState, state, targetCompany);
      const keyingBypassed = hasCreatureKeyingBypass(state, targetCompany.id, creatureDef.race)
        || siteAllowsCreatureByRace(state, targetCompany, creatureDef)
        || siteAllowsCreatureByKeying(state, targetCompany, creatureDef);

      if (matches.length === 0 && !keyingBypassed) {
        logDetail(`${sourceName}: replay creature "${creatureName}" not keyable: ${describeKeyingRequirement(creatureDef)}`);
        continue;
      }

      if (matches.length === 0 && keyingBypassed) {
        actions.push({
          action: {
            type: 'spawn-replay-creature' as const,
            player: playerId,
            sourceInstanceId: sourceCard.instanceId,
            creatureInstanceId: discardCard.instanceId,
            targetCompanyId,
            keyedBy: { method: 'keying-bypass', value: creatureDef.race },
          },
          viable: true,
        });
        continue;
      }

      for (const match of matches) {
        logDetail(`${sourceName}: replay creature "${creatureName}" keyable by ${match.method}: ${match.value}`);
        actions.push({
          action: {
            type: 'spawn-replay-creature' as const,
            player: playerId,
            sourceInstanceId: sourceCard.instanceId,
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
/**
 * Emit `tap-ally-discard-hazard` actions: an untapped ally in the active
 * company carrying a `tap-discard-attached-hazard` effect (le-153) may tap to
 * discard a hazard permanent-event attached to the company or to a character
 * in it, when the effect's `when` gate (e.g. the company's destination region)
 * holds. One action per (ally, target) pair.
 */
function tapDiscardAttachedHazardActions(
  state: GameState,
  playerId: PlayerId,
  company: Company,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;

  const destSiteDef = company.destinationSite ? defById(state, company.destinationSite.definitionId) : undefined;
  const destinationRegion = destSiteDef && isSiteCard(destSiteDef) ? destSiteDef.region : undefined;
  const ctx = { bearer: { destinationRegion } };

  const isHazardPermEvent = (defId: CardDefinitionId): boolean => {
    const d = defById(state, defId);
    return !!d && d.cardType === 'hazard-event' && (d as { eventType?: string }).eventType === 'permanent';
  };

  // Targets: hazard permanent-events attached to the company or to any of its
  // characters.
  const targets: CardInstanceId[] = [];
  for (const hz of company.hazards) {
    if (isHazardPermEvent(hz.definitionId)) targets.push(hz.instanceId);
  }
  for (const charId of company.characters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    for (const hz of charData.hazards) {
      if (isHazardPermEvent(hz.definitionId)) targets.push(hz.instanceId);
    }
  }
  if (targets.length === 0) return actions;

  for (const charId of company.characters) {
    const charData = player.characters[charId];
    if (!charData) continue;
    for (const ally of charData.allies) {
      if (ally.status !== CardStatus.Untapped) continue;
      const allyDef = defById(state, ally.definitionId);
      const eff = getCardEffects(allyDef).find(
        (e): e is TapDiscardAttachedHazardEffect => e.type === 'tap-discard-attached-hazard',
      );
      if (!eff || eff.cost?.tap !== 'self') continue;
      if (eff.when && !matchesCondition(eff.when, ctx as unknown as Record<string, unknown>)) {
        logDetail(`tap-discard-attached-hazard (${allyDef?.name ?? '?'}): when gate not met (destinationRegion: ${destinationRegion ?? 'none'})`);
        continue;
      }
      for (const targetId of targets) {
        actions.push({
          action: { type: 'tap-ally-discard-hazard', player: playerId, allyInstanceId: ally.instanceId, targetInstanceId: targetId },
          viable: true,
        });
      }
    }
  }
  return actions;
}

/**
 * Enumerate the card instances an untargeted {@link PlayOptionEffect} mode may
 * act on, per its `candidates` pool, filtered by the apply's own `filter`.
 *
 * Backs Returned Beyond All Hope (as-35), whose three modes each act on one
 * declared card instance: a creature in the player's own discard pile, a Maia
 * permanent-event in the player's own `cardsInPlay`, or an *eliminated* creature
 * — one sitting in either player's marshalling-point pile (a trophy, per the
 * CRF 22 ruling) or out-of-play pile. The source card itself is never a
 * candidate (a hazard short-event is already in its own discard pile when the
 * emitter runs).
 *
 * `opponent-in-play` backs Many Sorrows Befall (td-46): "Forces the discard
 * of one resource long-event" — the candidate pool is the *opponent's*
 * `cardsInPlay` (the resource player's in-play resource long-events), not the
 * playing (hazard) player's own.
 */
function untargetedOptionCandidates(
  state: GameState,
  player: PlayerState,
  opt: import('../../types/effects.js').PlayOptionEffect,
  sourceInstanceId: CardInstanceId,
  opponentPlayer?: PlayerState,
): readonly { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] {
  const apply = opt.apply;
  const filter: import('../../types/effects.js').Condition | undefined =
    apply.type === 'move' ? apply.filter
      : apply.type === 'un-eliminate-creature' ? apply.filter
        : undefined;
  const matches = (c: { instanceId: CardInstanceId; definitionId: CardDefinitionId }): boolean => {
    if (c.instanceId === sourceInstanceId) return false;
    const cDef = defById(state, c.definitionId);
    if (!cDef) return false;
    return filter === undefined || matchesDefinition(cDef, filter);
  };
  switch (opt.candidates) {
    case 'own-discard':
      return player.discardPile.filter(matches);
    case 'own-in-play':
      return player.cardsInPlay.filter(matches)
        .map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
    case 'opponent-in-play':
      return (opponentPlayer?.cardsInPlay ?? []).filter(matches)
        .map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId }));
    case 'eliminated': {
      const found: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] = [];
      for (const p of state.players) {
        found.push(...p.killPile.filter(matches), ...p.outOfPlayPile.filter(matches));
      }
      return found;
    }
    default:
      return [];
  }
}

function playHazardsActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
  isResourcePlayer: boolean,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const targetCompanyRef = state.players[activeIdx].companies[mhState.activeCompanyIndex];
  if (!targetCompanyRef) {
    // The active company dissolved mid-phase (all characters eliminated) —
    // both players can only pass, which finalizes the company's M/H slot.
    const alreadyPassed = isResourcePlayer ? mhState.resourcePlayerPassed : mhState.hazardPlayerPassed;
    if (alreadyPassed) {
      logDetail('Play-hazards: active company no longer exists and player already passed — waiting');
      return actions;
    }
    logDetail('Play-hazards: active company no longer exists — only pass is available');
    return [{ action: { type: 'pass', player: playerId }, viable: true }];
  }
  const targetCompanyId = targetCompanyRef.id;
  const liveLimit = currentHazardLimit(state, mhState, targetCompanyId);
  const limitReached = mhState.hazardsPlayedThisCompany >= liveLimit;

  // Rule 5.24: while the Nazgûl sideboard sub-flow is active, it takes over
  // entirely (mirrors the untap-phase hazard-sideboard sub-flow — the
  // resource player waits, the hazard player only sees fetch/pass actions).
  if (mhState.nazgulSideboardDestination !== null) {
    if (isResourcePlayer) {
      logDetail('Play-hazards: resource player waiting for Nazgûl sideboard sub-flow');
      return actions;
    }
    return nazgulSideboardFetchActions(state, playerId, mhState);
  }

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

      // play-condition: active-player-deck-size (Great Secrets Buried There
      // dm-63: "Playable if opponent has at least ten cards in his play
      // deck"). "Opponent" from the hazard player's perspective is always the
      // active player — the owner of the company being hazarded.
      {
        const deckSizeCond = findPlayConditionEffect(def, 'active-player-deck-size');
        if (deckSizeCond?.minDeckSize !== undefined) {
          const deckSize = activePlayerDeckSize(state);
          if (deckSize < deckSizeCond.minDeckSize) {
            logDetail(`Hazard "${def.name}": requires at least ${deckSizeCond.minDeckSize} cards in ${resourcePlayer.name}'s play deck (has ${deckSize})`);
            actions.push({ action, viable: false, reason: `${def.name}: opponent needs at least ${deckSizeCond.minDeckSize} cards in play deck` });
            continue;
          }
        }
      }

      // play-condition: card-player-deck-size (Long Dark Reach dm-70: "if you
      // have at least 10 cards in your play deck"). "You" is the hazard
      // player actually declaring this play — the opposite of
      // active-player-deck-size above.
      {
        const ownDeckSizeCond = findPlayConditionEffect(def, 'card-player-deck-size');
        if (ownDeckSizeCond?.minDeckSize !== undefined) {
          const ownDeckSize = cardPlayerDeckSize(state, playerId);
          if (ownDeckSize < ownDeckSizeCond.minDeckSize) {
            logDetail(`Hazard "${def.name}": requires at least ${ownDeckSizeCond.minDeckSize} cards in ${player.name}'s own play deck (has ${ownDeckSize})`);
            actions.push({ action, viable: false, reason: `${def.name}: you need at least ${ownDeckSizeCond.minDeckSize} cards in your play deck` });
            continue;
          }
        }
      }

      // prohibit-card-play (The Under-roads, as-106 prohibits The Way is Shut):
      // a card named by any in-play `prohibit-card-play` effect may not be
      // played while that source remains in play.
      if (isCardPlayProhibited(state, def)) {
        logDetail(`Hazard "${def.name}" is prohibited from play by a card in play`);
        actions.push({ action, viable: false, reason: `${def.name} may not be played (prohibited by a card in play)` });
        continue;
      }

      // Hazard limit reached (cards with no-hazard-limit bypass this)
      const bypassesLimit = 'effects' in def && hasPlayFlag(def, 'no-hazard-limit');
      const raceExempt = isCreature && isCreatureRaceExemptFromLimit(state, targetCompany.id, def.race);
      if (limitReached && !bypassesLimit && !raceExempt) {
        actions.push({ action, viable: false, reason: `Hazard limit reached (${liveLimit})` });
        continue;
      }

      // --- Inner Cunning (dm-68): dual permanent-event / short-event ---
      // Mode 1 (permanent-event): played on one of the hazard player's own
      //   face-down agents brought into play this turn; broadens where the
      //   agent may be revealed. One action per eligible face-down agent.
      // Mode 2 (short-event): tutor an agent with a Shadow-hold / Dark-hold home
      //   site from the play deck to hand (reveal + reshuffle).
      // Neither mode is playable if the opponent is a minion player.
      const revealOverrideEff = getCardEffects(def).find(
        (e): e is import('../../types/effects.js').AgentRevealSiteOverrideEffect => e.type === 'agent-reveal-site-override',
      );
      const fetchAgentEff = getCardEffects(def).find(
        (e): e is import('../../types/effects.js').FetchAgentToHandEffect => e.type === 'fetch-agent-to-hand',
      );
      if (revealOverrideEff || fetchAgentEff) {
        if (isMinionOrBalrog(resourcePlayer)) {
          logDetail(`Hazard event "${def.name}" not playable — opponent is a minion player`);
          actions.push({ action, viable: false, reason: 'Cannot be played against a minion player' });
          continue;
        }
        // Mode 1: one permanent-event action per eligible face-down agent
        // (brought into play this turn: not yet in play at turn start).
        if (revealOverrideEff) {
          for (const agent of player.agents) {
            if (agent.revealed || agent.inPlayAtTurnStart) continue;
            logDetail(`Hazard permanent-event "${def.name}": playable on face-down agent ${agent.id as string}`);
            actions.push({
              action: { ...action, altEventMode: 'permanent-event', targetAgentId: agent.id },
              viable: true,
            });
          }
        }
        // Mode 2: short-event tutor. Viable when a matching agent is in the deck.
        if (fetchAgentEff) {
          const hasCandidate = player.playDeck.some(c => {
            const cDef = defById(state, c.definitionId);
            return !!cDef && isAgentCharacter(cDef) && agentHomeSiteMatchesTypes(state, cDef as { homesite?: string }, fetchAgentEff.homeSiteTypes);
          });
          logDetail(`Hazard short-event "${def.name}": tutor mode ${hasCandidate ? 'playable' : 'has no matching agent in deck'}`);
          actions.push({
            action: { ...action, altEventMode: 'short-event' },
            viable: hasCandidate,
            ...(hasCandidate ? {} : { reason: 'No matching agent in play deck' }),
          });
        }
        continue;
      }

      // --- Unique / manifestation gating for creatures ---
      // A unique creature (typically a dual-mode one currently sitting in
      // cardsInPlay as a permanent-event) may not be played again while a copy
      // is in play; and per rule g.man.1 no card may be played while another
      // manifestation of the same entity is in play (e.g. Lady of the Golden
      // Wood as-13 is barred — in both modes — while the character Galadriel
      // tw-153 is in play, and vice versa).
      if (isCreature) {
        if (def.unique && state.players.some(p => p.cardsInPlay.some(c => c.definitionId === def.id))) {
          logDetail(`Creature "${def.name}" is unique and already in play`);
          actions.push({ action, viable: false, reason: `${def.name} is unique and already in play` });
          continue;
        }
        const blockingManifestation = manifestationOfEntityInPlay(state, def);
        if (blockingManifestation) {
          logDetail(`Creature "${def.name}": blocked — manifestation "${blockingManifestation}" already in play`);
          actions.push({ action, viable: false, reason: `A manifestation of this entity (${blockingManifestation}) is already in play` });
          continue;
        }
      }

      // --- Dual-mode creature also playable as an event (creature-alt-event) ---
      // e.g. Mouth of Sauron (tw-65): "may be played as a hazard creature or as
      // a short-event". Offer the alternative event mode as its own action,
      // alongside the keyed-creature actions below. The event mode needs no
      // creature keying and, unlike a race-exempt creature, is not exempt from
      // the hazard limit — so it is offered only while the limit is not reached
      // (or the card carries no-hazard-limit).
      if (isCreature) {
        const altEvent = getCardEffects(def).find(e => e.type === 'creature-alt-event');
        if (altEvent && (!limitReached || bypassesLimit)) {
          // Optional event-mode targeting: a different company than the creature
          // mode may target (e.g. ba-10's short-event vs a *moving hero* company,
          // whereas its creature mode is vs minion companies). Permanent-event
          // mode (tw-2/tw-107) carries no targeting — it just enters play.
          const movingOk = !altEvent.requiresMovingCompany || targetCompany.destinationSite != null;
          let targetOk = movingOk;
          if (targetOk && altEvent.targetCompany) {
            const ctx = buildTargetCompanyConditionContext(state, resourcePlayer, targetCompany, defenderAlignmentLabel(resourcePlayer.alignment));
            targetOk = matchesCondition(altEvent.targetCompany, ctx);
          }
          // Optional game-wide gate on the event mode's availability (Shelob
          // tw-86: permanent-event mode only offered "if Doors of Night is in
          // play"), distinct from the creature mode's own play-condition.
          if (targetOk && altEvent.when) {
            targetOk = matchesCondition(altEvent.when, { inPlay: buildInPlayNames(state) });
          }
          if (targetOk) {
            logDetail(`Creature "${def.name}" also offered as a ${altEvent.mode} (creature-alt-event)`);
            actions.push({
              action: { ...action, altEventMode: altEvent.mode },
              viable: true,
            });
          } else {
            logDetail(`Creature "${def.name}" ${altEvent.mode} mode not offered — target company condition/moving/when not met`);
          }
        }
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
          || siteAllowsCreatureByRace(state, targetCompany, def)
          || siteAllowsCreatureByKeying(state, targetCompany, def)
          || grantsCreatureKeying(state, mhState, resourcePlayer, targetCompany, def);
        if (matches.length === 0 && !keyingBypassed) {
          const keyError = describeKeyingRequirement(def);
          logDetail(`Creature "${def.name}" not keyable: ${keyError}`);
          actions.push({ action, viable: false, reason: keyError });
          continue;
        }
        // Check play-condition: target-company (e.g. Horse-lords — not playable
        // against a company containing a character with Edoras as a home site).
        const targetCompanyCond = findPlayConditionEffect(def, 'target-company');
        if (targetCompanyCond?.condition) {
          const targetCtx = buildTargetCompanyConditionContext(state, resourcePlayer, targetCompany, defenderAlignmentLabel(resourcePlayer.alignment));
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

        // play-condition: card-in-play — some short-events require a named
        // card in play (e.g. Darkness Under Tree le-108 requires Doors of
        // Night before it may tap an Orc/Troll/Man character).
        {
          const cardInPlayCond = findPlayConditionEffect(def, 'card-in-play');
          if (cardInPlayCond?.cardName && !isCardNameInPlayOrCharacters(state, cardInPlayCond.cardName)) {
            logDetail(`Hazard short-event "${def.name}": play-condition card-in-play requires "${cardInPlayCond.cardName}" in play — not playable`);
            actions.push({ action, viable: false, reason: `${def.name} requires ${cardInPlayCond.cardName} in play` });
            continue;
          }
        }

        // play-condition: player-state — a generic DSL condition evaluated
        // against the hazard player's own alignment/avatar context (e.g.
        // Winds of Wrath td-82: "opponent is using the same type of location
        // deck (minion/hero) as yourself" → `player.sameLocationDeckTypeAsOpponent`).
        if (!playerStateGateMet(state, player, playerId, def)) {
          logDetail(`Hazard short-event "${def.name}": play-condition player-state not satisfied`);
          actions.push({ action, viable: false, reason: `${def.name}: play conditions not met` });
          continue;
        }

        // Winds of Wrath (td-82): replace the moving company's destination
        // site card with one from the hazard player's own location deck.
        // One action per eligible replacement site left in the hazard
        // player's siteDeck (both the current destination and the
        // replacement must satisfy the site-path requirement).
        const swapNewSiteEff = getCardEffects(def).find(
          (e): e is import('../../types/effects.js').SwapNewSiteEffect => e.type === 'swap-new-site',
        );
        if (swapNewSiteEff) {
          if (!targetCompany.destinationSite) {
            logDetail(`Hazard short-event "${def.name}": company is not moving — not playable`);
            actions.push({ action, viable: false, reason: `${def.name}: company must be moving to a new site` });
            continue;
          }
          const destDef = resolveSiteDef(state, targetCompany.destinationSite.instanceId);
          const destPath = destDef?.sitePath ?? [];
          const destMatches = swapNewSiteEff.requiresDestinationSitePathIncludes.some(rt => destPath.includes(rt));
          if (!destMatches) {
            logDetail(`Hazard short-event "${def.name}": destination site path [${destPath.join(',')}] doesn't include a required region type`);
            actions.push({ action, viable: false, reason: `${def.name}: destination site's path doesn't match` });
            continue;
          }
          let offeredAny = false;
          for (const siteCard of player.siteDeck) {
            const siteDef = defById(state, siteCard.definitionId);
            if (!siteDef || !isSiteCard(siteDef)) continue;
            if (!swapNewSiteEff.requiresDestinationSitePathIncludes.some(rt => siteDef.sitePath.includes(rt))) continue;
            logDetail(`Hazard short-event "${def.name}": may replace destination with "${siteDef.name}" from own location deck`);
            actions.push({
              action: { ...action, replacementSiteInstanceId: siteCard.instanceId },
              viable: true,
            });
            offeredAny = true;
          }
          if (!offeredAny) {
            logDetail(`Hazard short-event "${def.name}": no eligible replacement site in own location deck`);
            actions.push({ action, viable: false, reason: `${def.name}: no eligible site in your location deck` });
          }
          continue;
        }

        // Duplication-limit: non-viable if max copies already on chain / in play / still in effect
        {
          let blocked = false;
          for (const effect of getCardEffects(def)) {
            if (effect.type !== 'duplication-limit') continue;
            // Greed (le-113 / tw-42): "Cannot be duplicated on a given site."
            // Count resolved copies by their turn-scoped item-play-corruption-check
            // constraint bound to the same target site, plus same-site chain copies.
            if (effect.scope === 'site') {
              const siteInstId = targetCompany.destinationSite?.instanceId
                ?? targetCompany.currentSite?.instanceId ?? null;
              const siteDefId = siteInstId ? resolveInstanceId(state, siteInstId) : null;
              if (!siteDefId) continue;
              // A company is "at" its destination site for hazard purposes,
              // falling back to the current site for a non-moving company —
              // mirrors the siteDefId derivation above for the candidate play.
              const companySiteDefId = (companyId: import('../../index.js').CompanyId): CardDefinitionId | null => {
                for (const p of state.players) {
                  const company = p.companies.find(c => c.id === companyId);
                  if (!company) continue;
                  const inst = company.destinationSite?.instanceId ?? company.currentSite?.instanceId ?? null;
                  return inst ? resolveInstanceId(state, inst) ?? null : null;
                }
                return null;
              };
              const constraintCopies = state.activeConstraints.filter(
                c => constraintFromCard(state, c, def.id)
                  && ((c.kind.type === 'item-play-corruption-check' && c.kind.siteDefinitionId === siteDefId)
                    // Arouse Defenders (le-101): count resolved boosts still
                    // bound to this destination site.
                    || (c.kind.type === 'auto-attack-boost' && c.kind.siteDefinitionId === siteDefId)
                    // Incite Defenders le-115 / Incite Denizens le-116, td-34
                    // ("Cannot be duplicated on a given site"): the resolved
                    // copy lives on as an auto-attack-duplicate constraint
                    // targeting a company — attribute it to that company's
                    // site so a second copy at a *different* site stays legal.
                    || (c.kind.type === 'auto-attack-duplicate'
                      && c.target.kind === 'company'
                      && companySiteDefId(c.target.companyId) === siteDefId)),
              ).length;
              const chainCopies = state.chain?.entries.filter(e => {
                if (e.payload.type !== 'short-event') return false;
                const cDef = e.card ? defById(state, e.card.definitionId) : undefined;
                if (cDef?.name !== def.name) return false;
                if (e.payload.targetSiteDefinitionId) return e.payload.targetSiteDefinitionId === siteDefId;
                // Company-targeted copy (Incite …): attribute the unresolved
                // entry to its target company's site.
                return e.payload.targetCompanyId !== undefined
                  && companySiteDefId(e.payload.targetCompanyId) === siteDefId;
              }).length ?? 0;
              if (constraintCopies + chainCopies >= effect.max) {
                logDetail(`Hazard short-event "${def.name}" cannot be duplicated on this site (${constraintCopies} active, ${chainCopies} on chain)`);
                actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated on a given site` });
                blocked = true;
                break;
              }
              continue;
            }
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

        // --- Untargeted play-option modes acting on a declared card instance ---
        // Returned Beyond All Hope (as-35): three mutually-exclusive modes, none
        // of which targets a character, each acting on one card instance the
        // player names when playing (MECCG declares targets at play time, so the
        // opponent can respond knowing what is at stake). Emit one action per
        // (mode × candidate); a mode with no candidate is reported non-viable so
        // the UI can say why. A mode declared `eventMode: "permanent-event"`
        // carries `altEventMode` so the reducer routes it down the
        // permanent-event chain path instead of the short-event one.
        const instanceOptions = getCardEffects(def).filter(
          (e): e is import('../../types/effects.js').PlayOptionEffect =>
            e.type === 'play-option' && !!e.untargeted && !!e.candidates,
        );
        if (instanceOptions.length > 0 && !getCardEffects(def).some(e => e.type === 'play-target')) {
          for (const opt of instanceOptions) {
            const candidates = untargetedOptionCandidates(state, player, opt, cardInstId, resourcePlayer);
            if (candidates.length === 0) {
              logDetail(`Hazard short-event "${def.name}": option "${opt.id}" has no candidate card (pool ${opt.candidates})`);
              actions.push({
                action: { ...action, optionId: opt.id },
                viable: false,
                reason: `${def.name}: no card available for this mode`,
              });
              continue;
            }
            for (const candidate of candidates) {
              logDetail(`Hazard short-event "${def.name}": option "${opt.id}" can act on ${cardName(state, candidate.definitionId)}`);
              actions.push({
                action: {
                  ...action,
                  optionId: opt.id,
                  optionTargetInstanceId: candidate.instanceId,
                  ...(opt.eventMode === 'permanent-event' ? { altEventMode: 'permanent-event' as const } : {}),
                },
                viable: true,
              });
            }
          }
          continue;
        }

        // Environment-cancelers (e.g. Twilight) need an environment target in
        // play. A `playable-as-resource` hazard that instead has a character
        // target (Tookish Blood tw-104: `call-of-home-check` / character
        // protection) is NOT an environment-canceler — let it fall through to
        // the character-targeting branch below for its hazard mode.
        const isCharacterTargetingResourceHazard = getCardEffects(def).some(
          e => e.type === 'call-of-home-check' || e.type === 'protect-from-removal',
        );
        if (hasPlayFlag(def, 'playable-as-resource') && !isCharacterTargetingResourceHazard) {
          const envTargets = findEnvironmentTargets(state, { mayTargetSetAside: cardTargetsSetAside(def) });
          if (envTargets.length === 0) {
            logDetail(`Hazard short-event "${def.name}": no environment in play to cancel`);
            actions.push({ action, viable: false, reason: 'No environment to cancel' });
            continue;
          }
          for (const target of envTargets) {
            const targetDef = state.cardPool[target.definitionId as CardDefinitionId];
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
          (e): e is import('../../types/effects.js').OnEventEffect & { apply: import('../../types/effects.js').CancelChainEntryAction } =>
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
        //
        // Each `requires` variant is looked up on its own (rather than taking
        // the first `play-condition` effect on the card, regardless of kind)
        // so a card carrying more than one play-condition — e.g. Long Dark
        // Reach dm-70's `site-path` + `card-player-deck-size` pair — has both
        // checked instead of only whichever happens to be listed first.
        {
          const sitePathCondition = findPlayConditionEffect(def, 'site-path');
          const regionThroughCondition = findPlayConditionEffect(def, 'region-through-or-leave');
          const companySiteCondition = findPlayConditionEffect(def, 'company-site');
          if (sitePathCondition) {
            if (!checkSitePathCondition(mhState, sitePathCondition, state, targetCompany)) {
              logDetail(`Hazard short-event "${def.name}": site path condition not met`);
              actions.push({ action, viable: false, reason: 'Site path condition not met' });
              continue;
            }
          } else if (regionThroughCondition) {
            // Cruel Caradhras (td-9): playable on a company using region movement
            // to move through (not stopping at a site) or leave a named region.
            if (!checkRegionThroughOrLeave(mhState, regionThroughCondition.regionNames ?? [])) {
              logDetail(`Hazard short-event "${def.name}": company is not moving through or leaving a required region`);
              actions.push({ action, viable: false, reason: `${def.name} requires region movement through or leaving a named region` });
              continue;
            }
          } else if (companySiteCondition?.condition) {
            const companySiteConditionExpr = companySiteCondition.condition;
            // Glance of Arien (ba-19): gate on the active company's relevant
            // site — its destination when moving, else its current site.
            const relevantSite = targetCompany.destinationSite ?? targetCompany.currentSite;
            const siteDef = relevantSite ? defById(state, relevantSite.definitionId) : undefined;
            const siteCtx = siteDef && isSiteCard(siteDef)
              ? { site: { name: siteDef.name, siteType: siteDef.siteType, cardType: siteDef.cardType, region: siteDef.region, keywords: siteDef.keywords ?? [] } }
              : { site: {} };
            if (!matchesCondition(companySiteConditionExpr, siteCtx as unknown as Record<string, unknown>)) {
              logDetail(`Hazard short-event "${def.name}": company-site condition not met (site ${siteDef && isSiteCard(siteDef) ? siteDef.name : 'none'})`);
              actions.push({ action, viable: false, reason: `${def.name}: company's site does not satisfy play condition` });
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
                action: { ...action, chosenCreatureRace: raceChoice.fixedRace },
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

        // New Moon (tw-68): a plain short hazard-event carrying a `tap-character`
        // effect. Two mutually-exclusive ("Alternatively") modes:
        //   Mode A — tap one filter-matching (Elf) character. One action per
        //     eligible untapped opponent character; the tap rides on
        //     `targetCharacterId` and resolves via `applyTapCharacter`.
        //   Mode B — with Doors of Night in play, reinterpret one Free-domain /
        //     Free-hold as a Border-land / Border-hold for the turn, via the
        //     card's `on-event company-arrives-at-site` override handlers. A
        //     single untargeted action, offered when the company is moving and
        //     an override mode's `when` matches the arrival context.
        // The modes are distinguished by presence/absence of targetCharacterId;
        // the arrival-override resolution is skipped when a character was tapped
        // (see `applyShortEventArrivalTrigger`).
        const tapCharacterEffect = getCardEffects(def).find(
          (e): e is import('../../types/effects.js').TapCharacterEffect => e.type === 'tap-character',
        );
        if (tapCharacterEffect) {
          let offeredAny = false;
          // Mode A — tap one eligible character. A hazard "Tap one Elf character"
          // targets the opponent (resource) player's characters (any company),
          // mirroring Adûnaphel tw-2's "causes any one character to tap".
          for (const [charId, charData] of Object.entries(resourcePlayer.characters)) {
            // Only untapped characters may be tapped — a wounded (Inverted)
            // character is not a legal target, and resolving the tap would
            // overwrite the wound with Tapped.
            if (charData.status !== CardStatus.Untapped) continue;
            const charDef = defById(state, charData.definitionId);
            if (!charDef || !isCharacterCard(charDef)) continue;
            if (tapCharacterEffect.filter && !matchesDefinition(charDef, tapCharacterEffect.filter)) continue;
            logDetail(`Hazard short-event "${def.name}": Mode A — may tap "${charDef.name}" (${charId})`);
            actions.push({
              action: { ...action, targetCharacterId: charId as import('../../index.js').CardInstanceId },
              viable: true,
            });
            offeredAny = true;
          }
          // Mode B — arrival-override modes. Offer a single untargeted action
          // when the active company is moving and at least one on-event
          // company-arrives-at-site mode's `when` condition currently matches.
          const arrivalModes = getCardEffects(def).filter(
            (e): e is import('../../types/effects.js').OnEventEffect =>
              e.type === 'on-event' && e.event === 'company-arrives-at-site',
          );
          if (arrivalModes.length > 0 && targetCompany.destinationSite) {
            const inPlayNames = buildInPlayNames(state);
            const arrivalCompany: Record<string, unknown> = {};
            if (mhState.destinationSiteType) arrivalCompany.destinationSiteType = mhState.destinationSiteType;
            if (mhState.destinationSiteName) arrivalCompany.destinationSiteName = mhState.destinationSiteName;
            if (mhState.resolvedSitePath.length > 0) {
              arrivalCompany.destinationRegionType = mhState.resolvedSitePath[mhState.resolvedSitePath.length - 1];
            }
            const arrivalCtx: Record<string, unknown> = {
              company: arrivalCompany,
              inPlay: inPlayNames,
              environment: { doorsOfNightInPlay: inPlayNames.includes('Doors of Night') },
            };
            if (arrivalModes.some(m => !m.when || matchesCondition(m.when, arrivalCtx))) {
              logDetail(`Hazard short-event "${def.name}": Mode B — arrival-override available`);
              actions.push({ action, viable: true });
              offeredAny = true;
            }
          }
          if (!offeredAny) {
            logDetail(`Hazard short-event "${def.name}": no eligible target (no Elf to tap, no region/site to reinterpret)`);
            actions.push({ action, viable: false, reason: `${def.name}: no character to tap and no region/site to reinterpret` });
          }
          continue;
        }

        // Pilfer Anything Unwatched (as-33): played on one of the hazard
        // player's untapped agents, targeting an opponent character in play
        // whose home site matches the agent's current site. Independent of the
        // active company (the target may be in any of the opponent's companies).
        const pilferEffect = getCardEffects(def).find(
          (e): e is import('../../index.js').AgentTapReturnCharacterEffect => e.type === 'agent-tap-return-character',
        );
        if (pilferEffect) {
          if (isMinionOrBalrog(resourcePlayer)) {
            logDetail(`Hazard short-event "${def.name}" not playable — opponent is a minion player`);
            actions.push({ action, viable: false, reason: 'Cannot be played against a minion player' });
            continue;
          }
          let offeredAny = false;
          for (const agent of player.agents) {
            if (agent.character.status !== CardStatus.Untapped) continue;
            const agentDef = defById(state, agent.character.definitionId);
            if (!agentDef || !isCharacterCard(agentDef)) continue;

            // Agent's current site: top of its site stack, else its first home
            // site (a face-down agent sitting at home).
            const agentSiteName = agentCurrentSiteName(state, agent, agentDef);
            if (agentSiteName === null) continue;

            // Any opponent character in play whose home site == agent's site.
            for (const [charId, charData] of Object.entries(resourcePlayer.characters)) {
              const charDef = defById(state, charData.definitionId);
              if (!charDef || !isCharacterCard(charDef)) continue;
              const charHomesites = parseHomesiteNames(charDef.homesite);
              if (!charHomesites.includes(agentSiteName)) continue;
              logDetail(`Hazard short-event "${def.name}": agent "${agentDef.name}" (at ${agentSiteName}) may target "${charDef.name}"`);
              actions.push({
                action: {
                  ...action,
                  agentInstanceId: agent.character.instanceId,
                  targetCharacterId: charId as import('../../index.js').CardInstanceId,
                },
                viable: true,
              });
              offeredAny = true;
            }
          }
          if (!offeredAny) {
            logDetail(`Hazard short-event "${def.name}" not playable — no untapped agent with a matching-home-site opponent character`);
            actions.push({ action, viable: false, reason: 'No untapped agent with a matching-home-site target character' });
          }
          continue;
        }

        // Twisted Tales (dm-96): played on one of the hazard player's untapped
        // agents matching the card's `agentFilter` (a diplomat), targeting an
        // opponent faction in play that is playable at the agent's current site.
        // Independent of the active company — a faction sits in `cardsInPlay`.
        const agentFactionInfluenceEffect = getCardEffects(def).find(
          (e): e is import('../../index.js').AgentTapFactionInfluenceEffect => e.type === 'agent-tap-faction-influence',
        );
        if (agentFactionInfluenceEffect) {
          if (isMinionOrBalrog(resourcePlayer)) {
            logDetail(`Hazard short-event "${def.name}" not playable — opponent is a minion player`);
            actions.push({ action, viable: false, reason: 'Cannot be played against a minion player' });
            continue;
          }
          let offeredAny = false;
          for (const agent of player.agents) {
            if (agent.character.status !== CardStatus.Untapped) continue;
            const agentDef = defById(state, agent.character.definitionId);
            if (!agentDef || !isCharacterCard(agentDef)) continue;
            if (!agentMatchesFilter(agentDef, agentFactionInfluenceEffect.agentFilter)) {
              logDetail(`Hazard short-event "${def.name}": agent "${agentDef.name}" does not match the card's agent restriction`);
              continue;
            }
            const agentSiteName = agentCurrentSiteName(state, agent, agentDef);
            if (agentSiteName === null) continue;

            for (const cip of resourcePlayer.cardsInPlay) {
              const factionDef = defById(state, cip.definitionId);
              if (!factionDef || !isFactionCard(factionDef)) continue;
              if (!(factionDef.playableAt ?? []).some(e => 'site' in e && e.site === agentSiteName)) continue;
              // "May not be influenced by an opponent" (Army of the Dead
              // tw-193) applies to this agent-tap-faction-influence route too.
              if (factionDef.noOpponentInfluence) continue;
              logDetail(`Hazard short-event "${def.name}": agent "${agentDef.name}" (at ${agentSiteName}) may influence faction "${factionDef.name}"`);
              actions.push({
                action: {
                  ...action,
                  agentInstanceId: agent.character.instanceId,
                  targetFactionInstanceId: cip.instanceId,
                },
                viable: true,
              });
              offeredAny = true;
            }
          }
          if (!offeredAny) {
            logDetail(`Hazard short-event "${def.name}" not playable — no eligible untapped agent with an opponent faction playable at its site`);
            actions.push({ action, viable: false, reason: 'No eligible untapped agent with an opponent faction playable at its site' });
          }
          continue;
        }

        // Faction-targeting short events (e.g. Muster Disperses): a hazard
        // event can only target the resource player's own factions (CoE
        // 2.IV.vii.3 — hazard events target the opponent's entities), never
        // the hazard player's own factions in play.
        if (shortPlayTarget?.target === 'faction') {
          let hasFactionTarget = false;
          for (const cip of resourcePlayer.cardsInPlay) {
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
          if (!hasFactionTarget) {
            logDetail(`Hazard short-event "${def.name}" not playable — no factions in play`);
            actions.push({ action, viable: false, reason: 'No factions in play' });
          }
          continue;
        }

        // Company-targeting short events (e.g. The Reek ba-23): played on the
        // active company as a whole (no per-character/ally/site target). The
        // play-target filter gates on the company's current-or-destination site
        // type/keywords, alignment, and member count. A play-discard-cost is
        // cross-multiplied so the player picks which card to sacrifice.
        if (shortPlayTarget?.target === 'company') {
          const compSiteInst = targetCompany.destinationSite ?? targetCompany.currentSite ?? null;
          const compSiteDef = compSiteInst ? resolveDef(state, compSiteInst.instanceId) : undefined;
          const compSiteType = compSiteDef && isSiteCard(compSiteDef) ? compSiteDef.siteType : null;
          const compSiteKeywords = compSiteDef && isSiteCard(compSiteDef) ? (compSiteDef.keywords ?? []) : [];
          const allyCount = targetCompany.characters.reduce((sum, cId) => {
            const ch = resourcePlayer.characters[cId];
            return sum + (ch ? ch.allies.length : 0);
          }, 0);
          // Spawn-count context (Darkness Made by Malice ba-15): characters only
          // (allies excluded) vs. every Spawn card in play.
          const characterCount = targetCompany.characters.length;
          const spawnInPlayCount = countSpawnCardsInPlay(state);
          // Movement + Ringwraith-membership context (Heedless Revelry le-114:
          // "Playable on a non-Ringwraith company that is not moving").
          const hasRingwraith = targetCompany.characters.some(cId => {
            const ch = resourcePlayer.characters[cId];
            const cDef = ch ? defById(state, ch.definitionId) : undefined;
            return !!cDef && isCharacterCard(cDef) && cDef.race === Race.Ringwraith;
          });
          const companyCtx = {
            target: {
              siteType: compSiteType,
              siteKeywords: compSiteKeywords,
              alignment: resourcePlayer.alignment,
              memberCount: targetCompany.characters.length + allyCount,
              characterCount,
              spawnInPlayCount,
              moreSpawnThanCompany: spawnInPlayCount > characterCount,
              moving: !!targetCompany.destinationSite,
              hasRingwraith,
            },
          };
          if (shortPlayTarget.filter && !matchesContext(shortPlayTarget.filter, companyCtx)) {
            logDetail(`Hazard short-event "${def.name}": company filter not met (siteType=${compSiteType ?? 'none'}, keywords=[${compSiteKeywords.join(',')}], spawn=${spawnInPlayCount}, chars=${characterCount})`);
            actions.push({ action, viable: false, reason: `${def.name} cannot be played on this company at this site` });
            continue;
          }
          // play-option (Drowning Seas tw-30): the hazard player picks one of
          // several mutually-exclusive company-level options at play time.
          // Each option's `when` is evaluated against the same company
          // context used for the play-target filter above, extended with
          // `inPlay` so an alternative gated on a permanent-event (Doors of
          // Night) is only offered while it's actually in play. One action
          // per matching option, carrying `optionId`; a card without
          // play-option effects falls through to the single-action path
          // below.
          const compPlayOptions = getCardEffects(def).filter(
            (e): e is import('../../types/effects.js').PlayOptionEffect => e.type === 'play-option',
          );
          if (compPlayOptions.length > 0) {
            const optionCtx = { ...companyCtx, inPlay: buildInPlayNames(state) };
            let offeredAnyOption = false;
            for (const opt of compPlayOptions) {
              if (opt.when && !matchesCondition(opt.when, optionCtx)) {
                logDetail(`Hazard short-event "${def.name}": company option "${opt.id}" when-condition rejected`);
                continue;
              }
              logDetail(`Hazard short-event "${def.name}": company option "${opt.id}" available`);
              actions.push({ action: { ...action, optionId: opt.id }, viable: true });
              offeredAnyOption = true;
            }
            if (!offeredAnyOption) {
              logDetail(`Hazard short-event "${def.name}": no company option's when-condition matched`);
              actions.push({ action, viable: false, reason: `${def.name}: no available option for this company` });
            }
            continue;
          }
          // play-discard-cost (The Reek ba-23): must discard a matching card from
          // hand as a cost. Gather candidates; if none match, the card is not
          // playable at all. One action per matching cost card.
          const compDiscardCostEffect = getCardEffects(def).find(
            (e): e is import('../../index.js').PlayDiscardCostEffect => e.type === 'play-discard-cost',
          );
          if (compDiscardCostEffect) {
            const compDiscardCostCards = player.hand.filter(c => {
              if (c.instanceId === cardInstId) return false;
              const cDef = defById(state, c.definitionId);
              return cDef ? matchesCondition(compDiscardCostEffect.filter, cDef as unknown as Record<string, unknown>) : false;
            });
            if (compDiscardCostCards.length === 0) {
              logDetail(`Hazard short-event "${def.name}": no card in hand matches the discard cost`);
              actions.push({ action, viable: false, reason: `${def.name}: no matching card in hand to discard as cost` });
              continue;
            }
            for (const costCard of compDiscardCostCards) {
              logDetail(`Hazard short-event "${def.name}" playable on company (discard cost "${defById(state, costCard.definitionId)?.name ?? costCard.definitionId}")`);
              actions.push({
                action: { ...action, costDiscardInstanceId: costCard.instanceId },
                viable: true,
              });
            }
          } else {
            logDetail(`Hazard short-event "${def.name}" playable on company`);
            actions.push({ action, viable: true });
          }
          continue;
        }

        // Character-targeting short events (e.g. Call of Home): one action per eligible character
        if (shortPlayTarget?.target === 'character') {
          // play-option modes (e.g. Weariness of the Heart le-149): the hazard
          // player picks one of several mutually-exclusive options. Emit one
          // action per (character, option). Cards without play-options emit a
          // single action per character.
          const allShortPlayOptions = getCardEffects(def).filter(
            (e): e is import('../../index.js').PlayOptionEffect => e.type === 'play-option',
          );
          // `untargeted` options (Echoes of the Song wh-17 mode A) need no
          // target even though the card declares `play-target: character` for
          // its other modes. They are offered exactly once, gated on a
          // card-level context describing the opponent (the resource player)
          // rather than on a per-character one.
          const shortPlayOptions = allShortPlayOptions.filter(o => !o.untargeted);
          for (const opt of allShortPlayOptions.filter(o => o.untargeted)) {
            const untargetedCtx = {
              opponent: {
                stagePoints: resourcePlayer.stagePoints,
                stageCardCount: stageCardsHeld(state, resourcePlayer).length,
              },
              inPlay: buildInPlayNames(state),
            };
            if (opt.when && !matchesCondition(opt.when, untargetedCtx)) {
              logDetail(`Hazard short-event "${def.name}": untargeted option "${opt.id}" when-condition rejected (opponent stagePoints=${untargetedCtx.opponent.stagePoints}, stageCards=${untargetedCtx.opponent.stageCardCount})`);
              continue;
            }
            logDetail(`Hazard short-event "${def.name}": untargeted option "${opt.id}" available`);
            actions.push({ action: { ...action, optionId: opt.id }, viable: true });
          }
          // CoE rule 7.2.1: a Corruption-keyword short-event counts as a
          // corruption card — only one per character per turn.
          const isShortCorruption = 'keywords' in def
            && (def as { keywords?: readonly string[] }).keywords?.includes('corruption') === true;
          // play-discard-cost (Faces of the Dead dm-57): the short event may only
          // be played if the hazard player discards a matching card from hand as
          // a cost. Gather candidate cost cards up front; the per-character action
          // is cross-multiplied by each candidate so the player picks which card
          // to sacrifice. If none match, the card is not playable at all.
          const discardCostEffect = getCardEffects(def).find(
            (e): e is import('../../index.js').PlayDiscardCostEffect => e.type === 'play-discard-cost',
          );
          const discardCostCards = discardCostEffect
            ? player.hand.filter(c => {
                if (c.instanceId === cardInstId) return false;
                const cDef = defById(state, c.definitionId);
                return cDef ? matchesCondition(discardCostEffect.filter, cDef as unknown as Record<string, unknown>) : false;
              })
            : [];
          if (discardCostEffect && discardCostCards.length === 0) {
            logDetail(`Hazard short-event "${def.name}": no card in hand matches the discard cost`);
            actions.push({ action, viable: false, reason: `${def.name}: no matching card in hand to discard as cost` });
            continue;
          }
          // A card whose play-options are *all* untargeted has no per-character
          // mode at all, so the target loop is skipped rather than emitting a
          // bare (option-less) action per character.
          const targetedCandidates = allShortPlayOptions.length > 0 && shortPlayOptions.length === 0
            ? []
            : targetCompany.characters;
          for (const charId of targetedCandidates) {
            const charData = resourcePlayer.characters[charId];
            const charDef = charData ? defById(state, charData.definitionId) : undefined;
            if (shortPlayTarget.filter && charData && charDef && isCharacterCard(charDef)) {
              const possessionNames = defNamesOf(state, charData.items);
              const itemKeywords = itemKeywordsOf(state, charData.items);
              const itemSubtypes = itemSubtypesOf(state, charData.items);
              const ctx = {
                target: {
                  // g.wiz.F1: a Fallen-wizard avatar matches "Wizard" in card
                  // text (e.g. Seized by Terror dm-88's "non-Wizard character"),
                  // not "fallen-wizard" — mirror the permanent-hazard path.
                  race: raceForCardTextFilter(charDef),
                  skills: charDef.skills,
                  name: charDef.name,
                  status: charData.status,
                  possessions: possessionNames,
                  itemKeywords,
                  itemSubtypes,
                },
                // `company.moving` (Gloom tw-41: "Playable only on a company
                // that is moving this turn") mirrors the `target.moving` field
                // already exposed to `play-target: "company"` filters
                // (Heedless Revelry le-114).
                company: {
                  moving: !!targetCompany.destinationSite,
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
            // CoE 7.2.1: block a second corruption card on a character that
            // already had one this turn (covers "this use cannot be duplicated
            // on a given character" for le-149).
            if (isShortCorruption && mhState.corruptionCardsPlayedPerChar[charId]) {
              const charName = cardName(state, charData?.definitionId, charId as string);
              logDetail(`Hazard short-event "${def.name}" blocked on ${charName}: corruption card already played this turn (CoE 7.2.1)`);
              actions.push({
                action: { ...action, targetCharacterId: charId },
                viable: false,
                reason: `Only one corruption card may be played on ${charName} per turn`,
              });
              continue;
            }
            if (shortPlayOptions.length > 0) {
              const optionCtx = charDef && isCharacterCard(charDef)
                ? { target: { race: raceForCardTextFilter(charDef), skills: charDef.skills, name: charDef.name, status: charData?.status } }
                : { target: {} };
              for (const opt of shortPlayOptions) {
                if (opt.when && !matchesCondition(opt.when, optionCtx)) {
                  logDetail(`Hazard short-event "${def.name}" on ${charId as string}: option "${opt.id}" when-condition rejected`);
                  continue;
                }
                logDetail(`Hazard short-event "${def.name}" playable on character ${charId as string}: option "${opt.id}"`);
                actions.push({
                  action: { ...action, targetCharacterId: charId, optionId: opt.id },
                  viable: true,
                });
              }
              continue;
            }
            logDetail(`Hazard short-event "${def.name}" playable on character ${charId as string}`);
            if (discardCostEffect) {
              for (const costCard of discardCostCards) {
                actions.push({
                  action: { ...action, targetCharacterId: charId, costDiscardInstanceId: costCard.instanceId },
                  viable: true,
                });
              }
            } else {
              actions.push({
                action: { ...action, targetCharacterId: charId },
                viable: true,
              });
            }
          }
          // Gloom (tw-41): a `play-target: "character"` short event may also
          // carry `on-event company-arrives-at-site` Doors-of-Night
          // alternative modes ("Alternatively, if Doors of Night is in play,
          // treat one Border-land as a Wilderness or one Border-hold as a
          // Ruins & Lairs…"). Offer the single untargeted action the
          // tap-character branch offers for the same shape (New Moon tw-68),
          // so the two modes stay mutually exclusive via
          // `applyShortEventArrivalTrigger`'s targetCharacterId check.
          {
            const arrivalModes = getCardEffects(def).filter(
              (e): e is import('../../types/effects.js').OnEventEffect =>
                e.type === 'on-event' && e.event === 'company-arrives-at-site',
            );
            if (arrivalModes.length > 0 && targetCompany.destinationSite) {
              const inPlayNames = buildInPlayNames(state);
              const arrivalCompany: Record<string, unknown> = {};
              if (mhState.destinationSiteType) arrivalCompany.destinationSiteType = mhState.destinationSiteType;
              if (mhState.destinationSiteName) arrivalCompany.destinationSiteName = mhState.destinationSiteName;
              if (mhState.resolvedSitePath.length > 0) {
                arrivalCompany.destinationRegionType = mhState.resolvedSitePath[mhState.resolvedSitePath.length - 1];
              }
              const arrivalCtx: Record<string, unknown> = {
                company: arrivalCompany,
                inPlay: inPlayNames,
                environment: { doorsOfNightInPlay: inPlayNames.includes('Doors of Night') },
              };
              if (arrivalModes.some(m => !m.when || matchesCondition(m.when, arrivalCtx))) {
                logDetail(`Hazard short-event "${def.name}": arrival-override mode available`);
                actions.push({ action, viable: true });
              }
            }
          }
          continue;
        }

        // Ally-targeting short events (e.g. Stay Her Appetite, le-140):
        // one action per ally in any character of the target company.
        if (shortPlayTarget?.target === 'ally') {
          let hasAllyTarget = false;
          for (const charId of targetCompany.characters) {
            const charData = resourcePlayer.characters[charId];
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
            const homesiteNames = parseHomesiteNames(agentDef.homesite ?? '');
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
          if (!destSiteDef || !isSiteCard(destSiteDef) || getActiveAutoAttacks(state, destSiteDef, targetCompany.destinationSite.instanceId).length === 0) {
            logDetail(`Hazard short-event "${def.name}" requires a destination site with automatic-attacks`);
            actions.push({ action, viable: false, reason: 'Destination site has no automatic attacks' });
            continue;
          }
        }

        // create-site-auto-attack (FEAR! FIRE! FOES! as-29 Mode A): "Playable on
        // a Free-hold [{F}] or Border-hold [{B}]." The company must be moving
        // (destinationSite set) to a site whose type is one of the effect's
        // siteTypes. On resolution it installs the extra automatic-attack.
        const createAttackEffect = getCardEffects(def).find(
          (e): e is import('../../index.js').CreateSiteAutoAttackEffect => e.type === 'create-site-auto-attack',
        );
        if (createAttackEffect) {
          if (!targetCompany.destinationSite) {
            logDetail(`Hazard short-event "${def.name}" requires a moving company`);
            actions.push({ action, viable: false, reason: `${def.name} can only be played on a moving company` });
            continue;
          }
          const destSiteDef = resolveDef(state, targetCompany.destinationSite.instanceId);
          if (!destSiteDef || !isSiteCard(destSiteDef) || !createAttackEffect.siteTypes.includes(destSiteDef.siteType)) {
            logDetail(`Hazard short-event "${def.name}" requires the company to be moving to a ${createAttackEffect.siteTypes.join(' or ')}`);
            actions.push({ action, viable: false, reason: `${def.name}: destination is not a ${createAttackEffect.siteTypes.join(' or ')}` });
            continue;
          }
          logDetail(`Hazard short-event "${def.name}" is playable (moving to ${destSiteDef.name}, a ${destSiteDef.siteType})`);
          actions.push({ action, viable: true });
          continue;
        }

        // auto-attack-boost (Arouse Defenders le-101): "Playable on a Free-hold
        // [{F}] or Border-hold [{B}]." Same gate as create-site-auto-attack —
        // the company must be moving to a site whose type is one of the effect's
        // siteTypes. On resolution it installs the single-use auto-attack boost.
        const autoAttackBoostEffect = getCardEffects(def).find(
          (e): e is import('../../index.js').AutoAttackBoostEffect => e.type === 'auto-attack-boost',
        );
        if (autoAttackBoostEffect) {
          if (!targetCompany.destinationSite) {
            logDetail(`Hazard short-event "${def.name}" requires a moving company`);
            actions.push({ action, viable: false, reason: `${def.name} can only be played on a moving company` });
            continue;
          }
          const destSiteDef = resolveDef(state, targetCompany.destinationSite.instanceId);
          if (!destSiteDef || !isSiteCard(destSiteDef) || !autoAttackBoostEffect.siteTypes.includes(destSiteDef.siteType)) {
            logDetail(`Hazard short-event "${def.name}" requires the company to be moving to a ${autoAttackBoostEffect.siteTypes.join(' or ')}`);
            actions.push({ action, viable: false, reason: `${def.name}: destination is not a ${autoAttackBoostEffect.siteTypes.join(' or ')}` });
            continue;
          }
          logDetail(`Hazard short-event "${def.name}" is playable (moving to ${destSiteDef.name}, a ${destSiteDef.siteType})`);
          actions.push({ action, viable: true });
          continue;
        }

        // play-discard-cost on an untargeted short event (Desire All for Thy
        // Belly ba-16): the hazard player must discard a matching card (a Spawn
        // card) from hand as a play cost. Offer one action per candidate cost
        // card so the player picks which to sacrifice; if none match, the card
        // is not playable. The reducer validates and pays the cost generically.
        const untargetedDiscardCost = getCardEffects(def).find(
          (e): e is import('../../index.js').PlayDiscardCostEffect => e.type === 'play-discard-cost',
        );
        if (untargetedDiscardCost) {
          const costCards = player.hand.filter(c => {
            if (c.instanceId === cardInstId) return false;
            const cDef = defById(state, c.definitionId);
            return cDef ? matchesCondition(untargetedDiscardCost.filter, cDef as unknown as Record<string, unknown>) : false;
          });
          if (costCards.length === 0) {
            logDetail(`Hazard short-event "${def.name}": no card in hand matches the discard cost`);
            actions.push({ action, viable: false, reason: `${def.name}: no matching card in hand to discard as cost` });
            continue;
          }
          for (const costCard of costCards) {
            logDetail(`Hazard short-event "${def.name}" playable (discard cost: ${cardName(state, costCard.definitionId)})`);
            actions.push({
              action: { ...action, costDiscardInstanceId: costCard.instanceId },
              viable: true,
            });
          }
          continue;
        }

        // A short event whose only movement/hazard-relevant effect is a
        // from-hand `modify-attack` is a *combat* modifier (e.g. Unabated in
        // Malice ba-26, Black Vapour ba-14). It buffs an attack the company is
        // facing, so it has no open movement/hazard play: during M/H there is
        // no active attack to modify, and resolving it here would silently drop
        // the buff (game mruvf51s-a9ge5j — Unabated in Malice played openly in
        // M/H never affected the site's automatic-attack). Such a card must be
        // played on the attack itself (via the combat modify-attack action) or
        // placed on-guard to be revealed when the company faces the site's
        // automatic-attack (rule 2.V.i). Suppress the open play; the on-guard
        // placement action remains available separately. Cards reaching this
        // point have already been ruled out of every legitimate M/H mode above
        // (create-site-auto-attack, auto-attack-boost, creature-race-choice,
        // etc.), each of which `continue`s before here.
        const fromHandModifyAttack = getCardEffects(def).some(
          (e): boolean => e.type === 'modify-attack' && !!(e as { fromHand?: boolean }).fromHand,
        );
        // Fell Beast (tw-33): a card may carry a from-hand modify-attack mode
        // (played on an existing Nazgûl attack) *alongside* a genuine
        // standalone `on-event self-enters-play → add-constraint` mode
        // (played before any Nazgûl, per CRF: "can be played and resolved
        // before any Nazgûl is played with it"). The modify-attack-only
        // suppression above must not swallow that second, independently
        // legitimate open-play mode.
        const hasSelfEntersPlayAddConstraint = getCardEffects(def).some(
          e => e.type === 'on-event' && e.event === 'self-enters-play' && e.apply.type === 'add-constraint',
        );
        if (fromHandModifyAttack && !hasSelfEntersPlayAddConstraint) {
          logDetail(`Hazard short-event "${def.name}": from-hand modify-attack is a combat modifier — not playable openly in M/H (play it on the attack or place it on-guard)`);
          actions.push({ action, viable: false, reason: `${def.name} must be played on the attack it modifies or placed on-guard` });
          continue;
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

      // play-condition: card-in-play — the event is only playable while a
      // named card is in play (e.g. Snowstorm tw-91 requires Doors of Night).
      {
        const cardInPlayCond = findPlayConditionEffect(def, 'card-in-play');
        if (cardInPlayCond?.cardName && !isCardNameInPlayOrCharacters(state, cardInPlayCond.cardName)) {
          logDetail(`Hazard event "${def.name}": play-condition card-in-play requires "${cardInPlayCond.cardName}" in play — not playable`);
          actions.push({ action, viable: false, reason: `${def.name} requires ${cardInPlayCond.cardName} in play` });
          continue;
        }
      }

      // play-condition: card-not-in-play — the event is only playable while a
      // named card is NOT in play (e.g. Eyes of the Shadow dm-56 requires that
      // Gates of Morning is not in play).
      {
        const cardNotInPlayCond = findPlayConditionEffect(def, 'card-not-in-play');
        if (cardNotInPlayCond?.cardName && isCardNameInPlayOrCharacters(state, cardNotInPlayCond.cardName)) {
          logDetail(`Hazard event "${def.name}": play-condition card-not-in-play requires "${cardNotInPlayCond.cardName}" not in play — not playable`);
          actions.push({ action, viable: false, reason: `${def.name} cannot be played while ${cardNotInPlayCond.cardName} is in play` });
          continue;
        }
      }

      // play-condition: site-path — the permanent/long event is only playable
      // when the active moving company's resolved site path satisfies the
      // condition (e.g. Enchanted Stream as-27: "at least one Wilderness in its
      // site path"). Enforced here in the long/permanent branch; the short-event
      // branch checks site-path separately above.
      {
        const sitePathCond = getCardEffects(def).find(
          (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'site-path',
        );
        if (sitePathCond && !checkSitePathCondition(mhState, sitePathCond, state, targetCompany)) {
          logDetail(`Hazard event "${def.name}": site path condition not met`);
          actions.push({ action, viable: false, reason: `${def.name}: site path condition not met` });
          continue;
        }
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
      // play-target DSL: stored-item-targeting hazards (e.g. Neither so Ancient
      // Nor so Potent dm-73) get one action per stored item in the opponent's
      // marshalling-point pile. The stored item is displaced back to the
      // opponent's hand on resolution and the card takes its place.
      const isStoredItemTargeting = playTarget?.target === 'stored-item';
      // play-target DSL: nazgul-permanent-event-targeting hazards (Helms of
      // Iron dm-64) get one action per Nazgûl permanent-event the hazard
      // player has in their own cardsInPlay. With none, the card is not
      // playable at all — this structurally implements "Playable only if you
      // have a Nazgûl permanent-event in play." The chosen instance rides on
      // targetNazgulInstanceId and is discarded by the card's self-enters-play
      // move.
      const isNazgulTargeting = playTarget?.target === 'nazgul-permanent-event';
      if (isNazgulTargeting) {
        const nazgulCandidates = player.cardsInPlay.filter(c => isNazgulPermanentEvent(defById(state, c.definitionId)));
        if (nazgulCandidates.length === 0) {
          logDetail(`Hazard "${def.name}": no Nazgûl permanent-event in play`);
          actions.push({ action, viable: false, reason: `${def.name} requires a Nazgûl permanent-event in play` });
        }
        for (const candidate of nazgulCandidates) {
          const candidateDef = defById(state, candidate.definitionId);
          logDetail(`Hazard "${def.name}" playable — discards Nazgûl permanent-event ${candidateDef?.name ?? (candidate.definitionId as string)}`);
          actions.push({
            action: { ...action, targetNazgulInstanceId: candidate.instanceId },
            viable: true,
          });
        }
      } else if (isStoredItemTargeting) {
        const storedItems = resourcePlayer.killPile.filter(c => {
          const cDef = defById(state, c.definitionId);
          return !!cDef && isItemCard(cDef);
        });
        if (storedItems.length === 0) {
          logDetail(`Hazard "${def.name}": opponent has no stored items to target`);
          actions.push({ action, viable: false, reason: `${def.name} requires an opponent stored item` });
        }
        for (const stored of storedItems) {
          const storedDef = defById(state, stored.definitionId);
          // Apply optional play-target filter against the stored item's definition.
          if (playTarget.filter && storedDef && !matchesDefinition(storedDef, playTarget.filter)) {
            logDetail(`Hazard "${def.name}" filter excludes stored item ${storedDef.name}`);
            continue;
          }
          logDetail(`Hazard "${def.name}" playable on stored item ${storedDef?.name ?? (stored.definitionId as string)}`);
          actions.push({
            action: { ...action, targetStoredItemInstanceId: stored.instanceId },
            viable: true,
          });
        }
      } else if (isCharTargeting) {
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
        const charDupLimit = findDuplicationLimitEffect(def, 'character');
        // Company-scoped duplication-limit for a *character*-targeting hazard
        // (So You've Come Back le-138: "Cannot be duplicated on a given
        // company"). The card attaches to a character but is limited per
        // company: count existing copies across every company member's hazards.
        const companyDupLimitOnChar = findDuplicationLimitEffect(def, 'company');
        if (companyDupLimitOnChar) {
          const copiesInCompany = targetCompany.characters.reduce((sum, cId) => {
            const ch = resourcePlayer.characters[cId];
            if (!ch) return sum;
            return sum + ch.hazards.filter(h => {
              const hDef = defById(state, h.definitionId);
              return hDef && hDef.name === def.name;
            }).length;
          }, 0);
          if (copiesInCompany >= companyDupLimitOnChar.max) {
            logDetail(`Hazard "${def.name}" already on target company (${copiesInCompany}/${companyDupLimitOnChar.max})`);
            actions.push({ action, viable: false, reason: `${def.name} cannot be duplicated on this company` });
            continue;
          }
        }
        // Company site context for the filter: a moving company is "at" its
        // new site for hazard purposes, so use the destination when set,
        // falling back to the current site for a non-moving company. Exposed
        // as `company.siteType` / `company.atHaven` so location-gated
        // corruption cards (The Burden of Time tw-94: "Playable on an Elf
        // not in a Haven/Darkhaven") can express the gate in their filter.
        const charTargetSiteInst = targetCompany.destinationSite ?? targetCompany.currentSite ?? null;
        const charTargetSiteDef = charTargetSiteInst ? defById(state, charTargetSiteInst.definitionId) : undefined;
        const charTargetSiteType = charTargetSiteDef && isSiteCard(charTargetSiteDef) ? charTargetSiteDef.siteType : null;
        const charTargetCompanyCtx = {
          siteType: charTargetSiteType,
          atHaven: charTargetSiteType === SiteType.Haven,
        };
        for (const charId of targetCompany.characters) {
          // Apply play-target filter condition (e.g. non-wizard, non-ringwraith)
          if (playTarget.filter) {
            const charData = resourcePlayer.characters[charId];
            if (charData) {
              const charDef = defById(state, charData.definitionId);
              if (charDef && isCharacterCard(charDef)) {
                const possessionNames = defNamesOf(state, charData.items);
                const itemKeywords = itemKeywordsOf(state, charData.items);
                const itemSubtypes = itemSubtypesOf(state, charData.items);
                const ctx = {
                  target: {
                    cardType: charDef.cardType,
                    // g.wiz.F1: a Fallen-wizard avatar matches "Wizard" in
                    // card text (e.g. Alone and Unadvised's "non-Wizard,
                    // non-Ringwraith character"), not "fallen-wizard".
                    race: raceForCardTextFilter(charDef),
                    skills: charDef.skills,
                    name: charDef.name,
                    mind: charDef.mind,
                    possessions: possessionNames,
                    itemKeywords,
                    itemSubtypes,
                    // Races of attacks that wounded this character so far
                    // this turn (Pale Dream-maker dm-78, Endless Whispers
                    // dm-54: "Playable on a non-Wizard character wounded by
                    // an Undead attack this turn").
                    woundedByRaceThisTurn: charData.woundedByRaceThisTurn ?? [],
                  },
                  company: charTargetCompanyCtx,
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
            const charData = resourcePlayer.characters[charId];
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
          if (isCorruptionCard && mhState.corruptionCardsPlayedPerChar[charId]) {
            const charName = cardName(state, resourcePlayer.characters[charId]?.definitionId, charId as string);
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
            const charName = cardName(state, resourcePlayer.characters[charId]?.definitionId, charId as string);
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
            // Apply play-target filter (e.g. Incite Defenders: border-hold or
            // free-hold) against the shared site context, so a hazard can also
            // gate on the derived facts the site card does not carry —
            // `regionType`, `effectiveSiteType`, `isWizardhaven`, `isProtected`
            // (Nature's Revenge wh-27: "a site in a Wilderness that normally is
            // a Border-hold or a Shadow-hold, or a non-protected Wizardhaven
            // in a Wilderness"). The `environment` block is layered on top for
            // hazards that gate on it instead — Doubled Vigilance (dm-51):
            // "Shadow-hold, or Ruins & Lairs / Border-hold while Doors of
            // Night is in play". Both builders spread the same site definition,
            // so the overlap is identical and only the derived keys differ.
            if (playTarget.filter && siteDef && isSiteCard(siteDef)) {
              const siteCtx = {
                ...buildSiteFilterContext(state, siteDef, destSiteInstanceId),
                ...sitePlayTargetContext(state, siteDef),
              };
              if (!matchesCondition(playTarget.filter, siteCtx)) {
                logDetail(`Hazard "${def.name}" site filter excludes ${siteDefName}`);
                actions.push({
                  action: { ...action, targetSiteDefinitionId: destSiteDefId },
                  viable: false,
                  reason: `${siteDefName} does not match site filter`,
                });
                continue;
              }
            }
            // site-item-trap (Troll-purse dm-95): "Playable on a site with an
            // Orc or Troll automatic-attack." The candidate site must have at
            // least one Orc/Troll automatic-attack.
            const hasItemTrap = getCardEffects(def).some(e => e.type === 'site-item-trap');
            if (hasItemTrap) {
              const orcTrollAutoAttack = siteDef && isSiteCard(siteDef)
                && getActiveAutoAttacks(state, siteDef, destSiteInstanceId).some(aa => {
                  const race = normalizeCreatureRace(aa.creatureType);
                  return race === Race.Orc || race === Race.Troll;
                });
              if (!orcTrollAutoAttack) {
                logDetail(`Hazard "${def.name}" requires a site with an Orc or Troll automatic-attack — ${siteDefName} has none`);
                actions.push({
                  action: { ...action, targetSiteDefinitionId: destSiteDefId },
                  viable: false,
                  reason: `${siteDefName} has no Orc or Troll automatic-attack`,
                });
                continue;
              }
            }
            // "Cannot be duplicated on a given site" (Siege tw-87): a
            // `duplication-limit` scope `site` caps how many copies of this
            // card may be bound to the target site location at once.
            const siteDupLimit = findDuplicationLimitEffect(def, 'site');
            if (siteDupLimit) {
              const copiesAtSite = countPermanentEventCopiesAtSite(state, def.name, destSiteDefId);
              if (copiesAtSite >= siteDupLimit.max) {
                logDetail(`Hazard "${def.name}" already bound to ${siteDefName} (${copiesAtSite}/${siteDupLimit.max})`);
                actions.push({
                  action: { ...action, targetSiteDefinitionId: destSiteDefId },
                  viable: false,
                  reason: `${def.name} cannot be duplicated on ${siteDefName}`,
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
      } else if (playTarget?.target === 'agent') {
        // Agent-targeting permanent hazard events (Never Seen Him dm-74): one
        // action per one of the hazard player's own agents, any status
        // (face-up or face-down). Cannot be played against a minion/Balrog
        // opponent, matching the other agent-related cards' convention.
        if (isMinionOrBalrog(resourcePlayer)) {
          logDetail(`Hazard event "${def.name}" not playable — opponent is a minion player`);
          actions.push({ action, viable: false, reason: 'Cannot be played against a minion player' });
        } else if (player.agents.length === 0) {
          logDetail(`Hazard event "${def.name}" not playable — no agents in play`);
          actions.push({ action, viable: false, reason: 'No agents in play' });
        } else {
          // "Cannot be duplicated on a given agent": one copy per targeted
          // agent, counted by name across cardsInPlay entries bound to it.
          const agentDupLimit = findDuplicationLimitEffect(def, 'agent');
          for (const agent of player.agents) {
            if (agentDupLimit) {
              const copiesOnAgent = player.cardsInPlay.filter(cip =>
                cip.attachedToAgentId === agent.id
                && defById(state, cip.definitionId)?.name === def.name,
              ).length;
              if (copiesOnAgent >= agentDupLimit.max) {
                logDetail(`Hazard "${def.name}" already bound to agent ${agent.id as string} (${copiesOnAgent}/${agentDupLimit.max})`);
                actions.push({
                  action: { ...action, targetAgentId: agent.id },
                  viable: false,
                  reason: `${def.name} cannot be duplicated on this agent`,
                });
                continue;
              }
            }
            logDetail(`Hazard event "${def.name}" playable on agent ${agent.id as string}`);
            actions.push({
              action: { ...action, targetAgentId: agent.id },
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
          const ch = resourcePlayer.characters[cId];
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
        // play-discard-cost sourced from cards-in-play (Scimitars of Steel
        // dm-86): "Playable only if you have a Nazgûl permanent-event in
        // play. Discard the Nazgûl when this card is brought into play." One
        // action per own cardsInPlay entry matching the filter; having zero
        // candidates makes the card unplayable, which doubles as the
        // "playable only if" gate.
        const cardsInPlayDiscardCost = getCardEffects(def).find(
          (e): e is import('../../types/effects.js').PlayDiscardCostEffect =>
            e.type === 'play-discard-cost' && e.source === 'cards-in-play',
        );
        if (cardsInPlayDiscardCost) {
          const candidates = player.cardsInPlay.filter(cip => {
            const cipDef = defById(state, cip.definitionId);
            return !!cipDef && matchesDefinition(cipDef, cardsInPlayDiscardCost.filter);
          });
          if (candidates.length === 0) {
            logDetail(`Hazard event "${def.name}": play-discard-cost has no matching card in play — not playable`);
            actions.push({ action, viable: false, reason: `${def.name} requires a matching card in play to discard` });
          } else {
            for (const candidate of candidates) {
              const candidateName = defById(state, candidate.definitionId)?.name ?? (candidate.definitionId as string);
              logDetail(`Hazard event "${def.name}" playable — will discard "${candidateName}" as cost`);
              actions.push({
                action: { ...action, costDiscardInstanceId: candidate.instanceId },
                viable: true,
              });
            }
          }
          continue;
        }

        // Company-targeting permanent events (e.g. Nothing to Eat or Drink).

        // Company-scope duplication-limit: one copy per target company.
        const companyDupLimit = findDuplicationLimitEffect(def, 'company');
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

    // --- Agent discard to return company to origin (e.g. Baduila dm-2) ---
    // Agents with the `agent-discard-return-to-origin` effect may be discarded
    // at the moving company's new site (not as an agent action, not against
    // hazard limit) to force the company back to its site of origin.
    actions.push(...agentDiscardReturnToOriginActions(state, playerId, mhState));

    // --- Power Built by Waiting (as-34): tap cardsInPlay card for +hazard limit ---
    // --- Power Built by Waiting (as-34): spend hazard limit to untap cardsInPlay card ---
    actions.push(...tapHazardCardForLimitActions(state, playerId, mhState, targetCompanyId, liveLimit));

    // --- Dragon "At Home" (METD §4): discard the permanent event from play to
    //     increase the hazard limit against this company by two (not counting
    //     against the hazard limit). ---
    actions.push(...discardForHazardLimitActions(state, playerId, targetCompanyId));

    // --- Summons from Long Sleep (as-39): reserve a Dragon/Drake from hand (free) ---
    // --- Summons from Long Sleep (as-39): play a reserved creature (costs hazard limit) ---
    actions.push(...summonsFromLongSleepActions(state, playerId, mhState, targetCompanyId, limitReached, liveLimit));

    // --- Exhalation of Decay (dm-55): play a creature from the discard pile (no hazard limit) ---
    actions.push(...playCreatureFromDiscardActions(state, playerId, mhState, targetCompanyId));

    // --- Monstrosity of Diverse Shape (ba-21): replay a Wolf/Animal creature
    //     that already attacked this company this turn from the discard pile
    //     (counts against the hazard limit, once per company M/H phase) ---
    actions.push(...spawnReplayCreatureFromDiscardActions(state, playerId, mhState, targetCompanyId, limitReached));

    // --- Rule 5.24: Sideboarding with a Nazgûl ---
    actions.push(...sideboardWithNazgulActions(state, playerId, player, limitReached));
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
    // grant-extra-mh-phase resources (Forced March le-185, Bridge tw-202, Leg It
    // Double Quick le-202): playable at the end of the M/H phase on the active
    // company when it is moving to a qualifying site (e.g. a Darkhaven).
    actions.push(...extraMHPhaseResourceActions(state, playerId, mhState));
    // Character-recruitment events (A Chance Meeting tw-188): bring a character
    // into play at a company at a qualifying site during M/H, bypassing the
    // one-character-per-turn limit.
    actions.push(...recruitViaEventActions(state, playerId));
    // Manifestation swaps (Strider ba-1 → Aragorn II): playable whenever a
    // normal resource could be played (CRF 22), so offered here too.
    actions.push(...manifestationSwapActions(state, playerId));
    // Discard-to-recruit (Folco Boffin dm-180): playable whenever a normal
    // resource could be played (CRF 22).
    actions.push(...discardToRecruitActions(state, playerId));
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
      actions.push(...tapDiscardAttachedHazardActions(state, playerId, company));
    }
    actions.push(...grantedActionActivations(state, playerId, 'anyPhase'));
  }

  // Hazard player may tap an in-play dual-mode creature-permanent-event
  // (tw-2 / tw-107) to convert it to a short-event.
  if (!isResourcePlayer) {
    actions.push(...tapAltPermanentEventActions(state, playerId, mhState));
    actions.push(...attackFromAltPermanentEventActions(state, playerId, mhState));
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

/** Maximum hazard cards that can be fetched to the discard pile per Nazgûl sideboard sub-flow (rule 5.24). */
const MAX_NAZGUL_SIDEBOARD_TO_DISCARD = 5;

/** Minimum play deck size required to fetch a hazard to deck via a Nazgûl (rule 5.24). */
const MIN_DECK_SIZE_FOR_NAZGUL_TO_DECK = 5;

/**
 * Rule 5.24: offer to tap and discard each untapped Nazgûl permanent-event
 * the hazard player controls, once per eligible card, for each sub-option
 * whose preconditions are met (discard always available if the sideboard
 * has hazards; deck only when the play deck has at least 5 cards). Counts
 * as one hazard against the limit, so it is not offered once the limit is
 * reached.
 */
/**
 * Offer tapping an in-play dual-mode creature-permanent-event (`creature-alt-event`
 * mode `permanent-event`, e.g. Ûvatha tw-107 / Adûnaphel tw-2) during the
 * opponent's movement/hazard phase. Tapping "becomes a short-event" (counts one
 * against the hazard limit). For a `tap-character` on-tap effect (tw-2), one
 * action is emitted per eligible untapped target character; for a
 * `force-discard-target-item` on-tap effect (tw-46), one per character matching
 * the effect's `targetFilter` that actually bears a discardable item; otherwise
 * a single action (the fetch target, tw-107, is chosen in the follow-up pending
 * flow).
 */
function tapAltPermanentEventActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const player = playerById(state, playerId);
  if (!player) return actions;

  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const activeCompany = state.players[activeIdx].companies[mhState.activeCompanyIndex];
  const limitReached = activeCompany
    ? mhState.hazardsPlayedThisCompany >= currentHazardLimit(state, mhState, activeCompany.id)
    : false;

  for (const card of player.cardsInPlay) {
    if (card.status === CardStatus.Tapped) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const altEvent = getCardEffects(def).find(e => e.type === 'creature-alt-event');
    if (altEvent?.mode !== 'permanent-event') continue;
    // Persistent permanent-events (Lady of the Golden Wood as-13) have no
    // tap-to-short-event conversion — they simply stay in play.
    if (altEvent.persistent) continue;
    // A conversion whose short-event modifies "any one attack" (Hoarmûrath of
    // Dír tw-44) needs a live attack to name, so it is offered in the combat
    // pre-assignment window instead (`modify-attack` / `fromAltPermanentEvent`).
    if (getCardEffects(def).some(e => e.type === 'modify-attack' && e.fromAltPermanentEvent)) continue;
    // A conversion that "attacks as itself" (Shelob tw-86, `attacksAsCreature`)
    // is offered as `attack-alt-permanent-event` instead — see
    // `attackFromAltPermanentEventActions` below.
    if (altEvent.attacksAsCreature) continue;

    const bypassesLimit = 'effects' in def && hasPlayFlag(def, 'no-hazard-limit');
    if (limitReached && !bypassesLimit) {
      actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId }, viable: false, reason: 'Hazard limit reached' });
      continue;
    }

    const tapCharEffect = getCardEffects(def).find(e => e.type === 'tap-character');
    if (tapCharEffect) {
      let offered = false;
      // CoE 2.1.2: as the hazard player, this effect is a hazard directed at the
      // opponent — it may only tap the resource (active) player's characters, never
      // the hazard player's own. Restrict targets to the resource player.
      for (const [charId, ch] of Object.entries(state.players[activeIdx].characters)) {
        // Only untapped characters may be tapped — a wounded (Inverted)
        // character is not a legal target, and resolving the tap would
        // overwrite the wound with Tapped.
        if (ch.status !== CardStatus.Untapped) continue;
        const charDef = defById(state, ch.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (tapCharEffect.filter && !matchesDefinition(charDef, tapCharEffect.filter)) continue;
        actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId, targetCharacterId: charId as CardInstanceId }, viable: true });
        offered = true;
      }
      if (!offered) {
        actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId }, viable: false, reason: 'No eligible character to tap' });
      }
      continue;
    }

    // Indûr Dawndeath (tw-46): the on-tap short-event "makes any wounded
    // character discard an item of his choice (but not a ring)". As a hazard
    // (CoE 2.1.2) it may only aim at the resource (active) player's characters.
    // A character is only a legal target when it matches the effect's
    // `targetFilter` (wounded) AND bears at least one item the `itemFilter`
    // allows — otherwise tapping would be a play without effect (CoE 9.6).
    const discardItemEffect = getCardEffects(def).find(
      (e): e is ForceDiscardTargetItemEffect => e.type === 'force-discard-target-item',
    );
    if (discardItemEffect) {
      const resourcePlayer = state.players[activeIdx];
      let offered = false;
      for (const [charId, ch] of Object.entries(resourcePlayer.characters)) {
        const charDef = defById(state, ch.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (discardItemEffect.targetFilter) {
          const ctx = buildPlayOptionContext(state, ch, resourcePlayer);
          if (!matchesCondition(discardItemEffect.targetFilter, ctx)) continue;
        }
        const hasDiscardableItem = ch.items.some(item => {
          const itemDef = defById(state, item.definitionId);
          if (!itemDef || !isItemCard(itemDef)) return false;
          return !discardItemEffect.itemFilter || matchesDefinition(itemDef, discardItemEffect.itemFilter);
        });
        if (!hasDiscardableItem) {
          logDetail(`${def.name}: ${cardName(state, ch.definitionId)} matches the target filter but bears no discardable item — not offered`);
          continue;
        }
        actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId, targetCharacterId: charId as CardInstanceId }, viable: true });
        offered = true;
      }
      if (!offered) {
        actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId }, viable: false, reason: 'No eligible character with a discardable item' });
      }
      continue;
    }

    // Akhôrahil (tw-4): the on-tap short-event "modifies any one character's
    // body by -1 for the rest of this turn". As a hazard (CoE 2.1.2) it may
    // only aim at the resource (active) player's characters; one action is
    // emitted per character passing the effect's optional `targetFilter`.
    const statModEffect = getCardEffects(def).find(
      (e): e is TargetCharacterStatModifierEffect => e.type === 'target-character-stat-modifier',
    );
    if (statModEffect) {
      const resourcePlayer = state.players[activeIdx];
      let offered = false;
      for (const [charId, ch] of Object.entries(resourcePlayer.characters)) {
        const charDef = defById(state, ch.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (statModEffect.targetFilter) {
          const ctx = buildPlayOptionContext(state, ch, resourcePlayer);
          if (!matchesCondition(statModEffect.targetFilter, ctx)) continue;
        }
        actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId, targetCharacterId: charId as CardInstanceId }, viable: true });
        offered = true;
      }
      if (!offered) {
        logDetail(`${def.name}: no eligible character to modify — tap not offered`);
        actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId }, viable: false, reason: 'No eligible character to modify' });
      }
      continue;
    }

    actions.push({ action: { type: 'tap-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId }, viable: true });
  }
  return actions;
}

/**
 * Offer converting an in-play dual-mode creature-permanent-event that
 * "attacks as itself" (`creature-alt-event` mode `permanent-event`,
 * `attacksAsCreature: true` — Shelob tw-86) into a full creature attack
 * against the active company, instead of a short-event conversion. Like a
 * normal creature play, this must initiate a new chain (not offered in
 * response to one) and needs no creature keying — the card stays in
 * `cardsInPlay` (see `handleAttackFromAltPermanentEvent`) so its own passive
 * effects still boost its own attack.
 */
function attackFromAltPermanentEventActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  if (state.chain != null) return actions;
  const player = playerById(state, playerId);
  if (!player) return actions;

  const activeIdx = getPlayerIndex(state, state.activePlayer!);
  const activeCompany = state.players[activeIdx].companies[mhState.activeCompanyIndex];
  if (!activeCompany) return actions;
  const limitReached = mhState.hazardsPlayedThisCompany >= currentHazardLimit(state, mhState, activeCompany.id);

  for (const card of player.cardsInPlay) {
    if (card.status === CardStatus.Tapped) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    const altEvent = getCardEffects(def).find(e => e.type === 'creature-alt-event');
    if (altEvent?.mode !== 'permanent-event' || !altEvent.attacksAsCreature) continue;

    const bypassesLimit = 'effects' in def && hasPlayFlag(def, 'no-hazard-limit');
    if (limitReached && !bypassesLimit) {
      actions.push({ action: { type: 'attack-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId, targetCompanyId: activeCompany.id }, viable: false, reason: 'Hazard limit reached' });
      continue;
    }
    logDetail(`Creature-permanent-event "${def.name}" may attack from its permanent-event state against company ${activeCompany.id as string}`);
    actions.push({ action: { type: 'attack-alt-permanent-event', player: playerId, cardInstanceId: card.instanceId, targetCompanyId: activeCompany.id }, viable: true });
  }
  return actions;
}

function sideboardWithNazgulActions(
  state: GameState,
  playerId: PlayerId,
  player: PlayerState,
  limitReached: boolean,
): EvaluatedAction[] {
  if (limitReached) return [];

  const nazguls = player.cardsInPlay.filter(card => {
    if (card.status === CardStatus.Tapped) return false;
    return isNazgulPermanentEvent(defById(state, card.definitionId));
  });
  if (nazguls.length === 0) return [];

  const eligible = filterSideboardByDef(state, player.sideboard, def => def.cardType.includes('hazard'));
  if (eligible.length === 0) return [];

  const actions: EvaluatedAction[] = [];
  for (const nazgul of nazguls) {
    const def = defById(state, nazgul.definitionId)!;
    logDetail(`Rule 5.24: "${def.name}" may be tapped and discarded to access sideboard`);
    actions.push({
      action: { type: 'sideboard-with-nazgul', player: playerId, cardInstanceId: nazgul.instanceId, destination: 'discard' },
      viable: true,
    });
    if (player.playDeck.length >= MIN_DECK_SIZE_FOR_NAZGUL_TO_DECK) {
      actions.push({
        action: { type: 'sideboard-with-nazgul', player: playerId, cardInstanceId: nazgul.instanceId, destination: 'deck' },
        viable: true,
      });
    }
  }
  return actions;
}

/**
 * Rule 5.24 follow-up: generate fetch/pass actions during the active Nazgûl
 * sideboard sub-flow. Same flow as `hazardSideboardFetchActions` (untap.ts);
 * both delegate to the shared builder in sideboard-subflow.ts.
 */
function nazgulSideboardFetchActions(
  state: GameState,
  playerId: PlayerId,
  mhState: MovementHazardPhaseState,
): EvaluatedAction[] {
  if (mhState.nazgulSideboardDestination === null) return [];
  return sideboardFetchSubflowActions(state, playerId, {
    destination: mhState.nazgulSideboardDestination,
    fetched: mhState.nazgulSideboardFetched,
    maxToDiscard: MAX_NAZGUL_SIDEBOARD_TO_DISCARD,
    fetchActionType: 'fetch-hazard-from-sideboard',
    isEligible: def => def.cardType.includes('hazard'),
    logPrefix: 'Nazgûl sideboard',
    guardWithPass: false,
  });
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
    // The step can be entered with every player already at hand size (e.g.
    // a hand-size modifier changed after the draw). Nothing auto-advances
    // it, so the active player must be able to pass to move on.
    const everyoneAtHandSize = state.players.every(
      (p, i) => p.hand.length <= resolveHandSize(state, i),
    );
    if (everyoneAtHandSize && state.activePlayer === playerId) {
      logDetail(`Reset-hand: all players at hand size — active player may pass to advance`);
      return [{ action: { type: 'pass', player: playerId }, viable: true }];
    }
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
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
): CreatureKeyingMatch[] {
  const matches: CreatureKeyingMatch[] = [];
  const seen = new Set<string>();

  // The destination belongs to the active (moving) player. When a by-name
  // fallback is used below, restrict it to that player's alignment so a
  // same-named site of another side isn't picked (e.g. the three printings of
  // The Under-gates: hero, minion, balrog — with different types/keywords).
  const moverAlignment = state.players[getPlayerIndex(state, state.activePlayer ?? state.players[0].id)]?.alignment;

  // The effective site type this company's destination presents to creature
  // keying — an active site-type override (Rebuild the Town, Choking
  // Shadows, …) replaces the printed type, it does not add to it. See
  // `resolveCreatureKeyingSiteType`.
  const effectiveSiteTypes = resolveCreatureKeyingSiteType(
    state, targetCompany, mhState.destinationSiteName, mhState.destinationSiteType, moverAlignment,
  );

  const inPlayNames = buildInPlayNames(state);
  const destSiteDefId = targetCompany.destinationSite?.instanceId
    ? resolveInstanceId(state, targetCompany.destinationSite.instanceId)
    : null;
  const destSiteDef = destSiteDefId ? defById(state, destSiteDefId) : undefined;
  const destSiteCard = (destSiteDef && isSiteCard(destSiteDef)) ? destSiteDef : undefined;
  const destSitePath = destSiteCard?.sitePath ?? [];
  const destSitePathCounts = regionTypeCounts(destSitePath);
  const whenContext: Record<string, unknown> = {
    inPlay: inPlayNames,
    destinationSite: { sitePath: destSitePathCounts, region: destSiteCard?.region },
    hazardsEncountered: mhState.hazardsEncountered,
  };
  // Derive the keyable region paths — name-scoped overrides (Choking
  // Shadows, Deeper Shadow), class remaps (Fell Winter), name conversions
  // (Girdle of Radagast), keying boosts (Withered Lands) — via the shared
  // helper so the offer can never disagree with the reducer's validation
  // (`checkCreatureKeying`).
  const candidateRegionPaths = computeCandidateRegionPaths(
    state, mhState.resolvedSitePath, mhState.resolvedSitePathNames, inPlayNames,
  );
  // Fell Beast (tw-33): "target Nazgûl may also be played keyed to a
  // Shadow-land [{s}] or Shadow-hold [{S}]" — a `nazgul-boost-pending`
  // constraint on this company grants one extra synthetic `keyedTo` entry for
  // the matching race, tried alongside the creature's own printed keying.
  const extraKeyedTo: import('../../types/cards-hazards.js').CreatureKeyRestriction[] = [];
  if ('id' in targetCompany) {
    const boost = state.activeConstraints.find(
      (c): c is import('../../types/pending.js').ActiveConstraint & { kind: { type: 'nazgul-boost-pending' } } =>
        c.kind.type === 'nazgul-boost-pending'
        && c.target.kind === 'company'
        && c.target.companyId === (targetCompany as Company).id
        && c.kind.race === def.race,
    );
    if (boost
      && (boost.kind.keyingRegionTypes?.length || boost.kind.keyingSiteTypes?.length)
      && !hasNazgulBoostBeenUsed(state, hazardPlayer(state, state.activePlayer).id, def.id)) {
      extraKeyedTo.push({
        ...(boost.kind.keyingRegionTypes ? { regionTypes: boost.kind.keyingRegionTypes } : {}),
        ...(boost.kind.keyingSiteTypes ? { siteTypes: boost.kind.keyingSiteTypes } : {}),
      });
    }
  }
  for (const key of [...def.keyedTo, ...extraKeyedTo]) {
    if (key.when && !matchesCondition(key.when, whenContext)) continue;
    // Region type matches — try the effective path plus each boosted variant.
    if (key.regionTypes && key.regionTypes.length > 0) {
      for (const candidate of candidateRegionPaths) {
        // Only report the region type(s) whose own count requirement is met
        // by this candidate — a type merely present below its required
        // count (e.g. a single Wilderness when three are required) must not
        // be offered as a keying reason just because another type on the
        // same card separately satisfies its own count.
        for (const rt of satisfiedRegionTypes(key.regionTypes, candidate)) {
          const k = `region-type:${rt}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'region-type', value: rt }); }
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
    // Site-in-region matches — the destination site's own `region` field is
    // one of the listed names (the dragons' "may also be played at sites in
    // these regions" DoN clause). Resolved like the site-keyword branch below.
    if (key.siteInRegionNames && key.siteInRegionNames.length > 0 && mhState.destinationSiteName) {
      const resolvedDest = (destSiteDef && isSiteCard(destSiteDef))
        ? destSiteDef
        : (Object.values(state.cardPool).find(
          c => isSiteCard(c) && c.name === mhState.destinationSiteName
            && (moverAlignment === undefined || c.alignment === moverAlignment),
        ) as SiteCard | undefined);
      if (resolvedDest && key.siteInRegionNames.includes(resolvedDest.region)) {
        const k = `site-in-region:${resolvedDest.region}`;
        if (!seen.has(k)) { seen.add(k); matches.push({ method: 'site-in-region', value: resolvedDest.region }); }
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
          c => isSiteCard(c) && c.name === mhState.destinationSiteName
            && (moverAlignment === undefined || c.alignment === moverAlignment),
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
          c => isSiteCard(c) && c.name === mhState.destinationSiteName
            && (moverAlignment === undefined || c.alignment === moverAlignment),
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
    // Adjacent-to site name matches — destination site must be adjacent
    // (under-deeps sense) to any of the named sites (the name sibling of
    // adjacentToSiteKeywords; e.g. Durin's Bane dm-107: "at The Under-gates
    // and at all of its adjacent sites").
    if (key.adjacentToSiteNames && key.adjacentToSiteNames.length > 0 && mhState.destinationSiteName) {
      const resolvedDest = (destSiteDef && isSiteCard(destSiteDef))
        ? destSiteDef
        : (Object.values(state.cardPool).find(
          c => isSiteCard(c) && c.name === mhState.destinationSiteName
            && (moverAlignment === undefined || c.alignment === moverAlignment),
        ) as SiteCard | undefined);
      if (resolvedDest) {
        for (const sn of key.adjacentToSiteNames) {
          const namedSites = Object.values(state.cardPool).filter(
            c => isSiteCard(c) && c.name === sn,
          ) as SiteCard[];
          for (const namedSite of namedSites) {
            if (isUnderDeepsAdjacent(state, namedSite, resolvedDest)) {
              const k = `adjacent-to-site-name:${sn}`;
              if (!seen.has(k)) { seen.add(k); matches.push({ method: 'adjacent-to-site-name', value: sn }); }
              break;
            }
          }
        }
      }
    }
    // Follows-attack matches — the company must have already faced a
    // creature-sourced (not-site-keyed) hazard attack this M/H sub-phase by
    // one of the listed races. See Wolf-riders (td-86).
    if (key.followsAttackRaces && key.followsAttackRaces.length > 0) {
      const facedRaces = deriveFacedRaces(state, mhState.hazardsEncountered);
      for (const race of key.followsAttackRaces) {
        if (facedRaces.includes(race)) {
          const k = `follows-attack:${race}`;
          if (!seen.has(k)) { seen.add(k); matches.push({ method: 'follows-attack', value: race }); }
        }
      }
    }
    // Moving-between-sites matches — the company's origin (current) site and
    // its destination site must both be named in the entry and differ, so one
    // entry covers both directions of a named site-to-site route (The Great
    // Goblin tw-95: Rivendell ↔ Lórien). A non-moving company's destination
    // name equals its origin name and never matches.
    if (key.movingBetweenSiteNames && key.movingBetweenSiteNames.length > 0 && mhState.destinationSiteName) {
      const originDefId = targetCompany.currentSite?.instanceId
        ? resolveInstanceId(state, targetCompany.currentSite.instanceId)
        : null;
      const originName = originDefId ? defById(state, originDefId)?.name : undefined;
      if (originName
        && originName !== mhState.destinationSiteName
        && key.movingBetweenSiteNames.includes(originName)
        && key.movingBetweenSiteNames.includes(mhState.destinationSiteName)) {
        const route = `${originName} to ${mhState.destinationSiteName}`;
        const k = `moving-between-sites:${route}`;
        if (!seen.has(k)) { seen.add(k); matches.push({ method: 'moving-between-sites', value: route }); }
      }
    }
  }

  return matches;
}

/**
 * True when `def` has at least one keying match against `targetCompany`'s
 * travel path / destination site — i.e. the creature "could normally be
 * played on the company". Used by Long Dark Reach (dm-70) to decide its -4
 * prowess penalty for a creature forced to attack "regardless of its
 * playability requirements": the bypass means the attack always proceeds,
 * but whether it *would* have been legally playable is still evaluated,
 * purely for the penalty. Delegates to {@link findCreatureKeyingMatches}, the
 * same keying-match logic the ordinary M/H hazard-creature-play path uses.
 */
export function creatureIsNormallyPlayableOnCompany(
  def: CreatureCard,
  mhState: MovementHazardPhaseState,
  state: GameState,
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
): boolean {
  return findCreatureKeyingMatches(def, mhState, state, targetCompany).length > 0;
}

/**
 * If the target company is stationary at a site carrying a `cancel-attacks`
 * site-rule, return the site's name so callers can mark creature plays
 * non-viable and surface a reason. Returns null when no such rule applies.
 *
 * Per rule 2.IV.5, a company is considered to be "at" its site card at all
 * times *except* from the moment its new site card is revealed until
 * immediately prior to its site phase — i.e. never while it has a
 * destination this turn. A moving company is therefore "at" neither its
 * origin nor its destination during hazard plays, so only a company with no
 * destination this turn (using its current site) can be protected.
 */
function cancelAttacksSiteName(
  state: GameState,
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
): string | null {
  if (targetCompany.destinationSite) return null;
  const effectiveSiteInstanceId = targetCompany.currentSite?.instanceId ?? null;
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
 * else current) carries an `allow-creature-by-race` site-rule that grants the
 * given creature definition a keying bypass. When it does, the creature's
 * normal keying check is bypassed (e.g. Geann a-Lisch: "Any Man hazard creature
 * can be played at this site."). An optional `except` condition on the rule
 * excludes matching creatures (e.g. The Iron-deeps ba-91: any Drake except Sea
 * Serpent). Delegates the rule test to {@link siteRuleAllowsCreatureByRace}.
 */
function siteAllowsCreatureByRace(
  state: GameState,
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
  creatureDef: CardDefinition,
): boolean {
  const effectiveSiteInstanceId = targetCompany.destinationSite?.instanceId
    ?? targetCompany.currentSite?.instanceId
    ?? null;
  if (!effectiveSiteInstanceId) return false;
  const siteDefId = resolveInstanceId(state, effectiveSiteInstanceId);
  if (!siteDefId) return false;
  return siteRuleAllowsCreatureByRace(defById(state, siteDefId), creatureDef);
}

/**
 * Check whether the target company's effective site (destination if moving,
 * else current) carries an `allow-creature-by-keying` site-rule whose region-
 * or site-type filter matches one of the creature's own `keyedTo` entries.
 * When it does, the creature keys as if the site matched its keying, so its
 * normal path/site keying check is bypassed (e.g. The Drowning-deeps ba-89 and
 * Remains of Thangorodrim ba-95: "Creatures keyed to Coastal Seas may be keyed
 * to this site.").
 */
function siteAllowsCreatureByKeying(
  state: GameState,
  targetCompany: {
    readonly destinationSite?: { readonly instanceId: CardInstanceId } | null;
    readonly currentSite?: { readonly instanceId: CardInstanceId } | null;
  },
  creatureDef: CreatureCard,
): boolean {
  const effectiveSiteInstanceId = targetCompany.destinationSite?.instanceId
    ?? targetCompany.currentSite?.instanceId
    ?? null;
  if (!effectiveSiteInstanceId) return false;
  const siteDefId = resolveInstanceId(state, effectiveSiteInstanceId);
  if (!siteDefId) return false;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return false;
  return siteDef.effects.some(e => {
    if (e.type !== 'site-rule' || e.rule !== 'allow-creature-by-keying') return false;
    const allowedSiteTypes = new Set(e.keying.siteTypes ?? []);
    const allowedRegionTypes = new Set(e.keying.regionTypes ?? []);
    return creatureDef.keyedTo.some(key =>
      (key.siteTypes?.some(st => allowedSiteTypes.has(st)) ?? false)
      || (key.regionTypes?.some(rt => allowedRegionTypes.has(rt)) ?? false),
    );
  });
}

/**
 * Collect every `grant-creature-keying` effect currently in scope against the
 * company being attacked, tagged with the name of the card that carries it (for
 * logging). Two sources feed the list:
 *
 * - `source: 'in-play'` (the default) — cards sitting in either player's
 *   `cardsInPlay`, i.e. environment long-/permanent-events such as Ungoliant's
 *   Foul Issue (ba-28) or A Pack at the Door (tw-497).
 * - `source: 'faced-this-turn'` — hazard creatures whose name appears in the
 *   company's `hazardsEncountered` list. The carrier is no longer in play by
 *   the time the grant is used (it was discarded, or taken as a trophy), so it
 *   is resolved from the card pool by name. Used by Dwarven Travelers (as-9).
 */
function collectCreatureKeyingGrants(
  state: GameState,
  mhState: MovementHazardPhaseState,
): { readonly sourceName: string; readonly effect: GrantCreatureKeyingEffect }[] {
  const grants: { sourceName: string; effect: GrantCreatureKeyingEffect }[] = [];

  for (const player of state.players) {
    for (const cardInPlay of player.cardsInPlay) {
      const def = defById(state, cardInPlay.definitionId);
      if (!def) continue;
      for (const e of getCardEffects(def)) {
        if (e.type !== 'grant-creature-keying') continue;
        if ((e.source ?? 'in-play') !== 'in-play') continue;
        grants.push({ sourceName: (def as { name?: string }).name ?? (cardInPlay.definitionId as string), effect: e });
      }
    }
  }

  // "…against any company that has faced <this card> this turn." The grant
  // outlives the creature that printed it, so scan the card pool for the
  // definitions named in the company's hazardsEncountered list.
  const encountered = mhState.hazardsEncountered;
  if (encountered.length > 0) {
    const encounteredNames = new Set<string>(encountered);
    for (const def of Object.values(state.cardPool)) {
      const name = (def as { name?: string }).name;
      if (name === undefined || !encounteredNames.has(name)) continue;
      for (const e of getCardEffects(def)) {
        if (e.type !== 'grant-creature-keying') continue;
        if (e.source !== 'faced-this-turn') continue;
        grants.push({ sourceName: name, effect: e });
      }
    }
  }

  return grants;
}

/**
 * Check whether any `grant-creature-keying` effect in scope (see
 * {@link collectCreatureKeyingGrants}) lets the given creature be keyed to the
 * target company's effective site (destination if moving, else current). The
 * grant matches when the creature's card definition satisfies `creatureFilter`
 * and the effective site's type is one of `siteFilter.siteTypes` and the site
 * carries every keyword in `siteFilter.siteKeywords`. This is the card-borne
 * analogue of the site-bound keying-bypass rules.
 *
 * Used by Ungoliant's Foul Issue (ba-28): "non-unique Spider creatures can be
 * keyed to Under-deeps Ruins & Lairs [{R}] and Shadow-holds [{S}]."
 *
 * `siteFilter.regionTypes` opens an additional region-type branch: the grant
 * matches when the moving company's resolved site path contains a region of one
 * of those types (OR'd with the site-type branch). `requiresNonCoastalKeying`
 * restricts the grant to creatures whose own `keyedTo` offers a non-Coastal-Sea
 * region — A Pack at the Door (tw-497), "may be played in Border-lands [{b}],
 * Border-holds [{B}] or Ruins & Lairs [{R}] … must be playable in a non-Coastal
 * Sea [{c}] region." `siteFilter.excludeSiteTypes` is the inverse of
 * `siteTypes` — matches any effective site type except those listed — used by
 * The Nazgûl are Abroad (tw-96): "at any site that is not a Free-hold [{F}] or
 * Haven [{H}]."
 *
 * The optional `companyFilter` additionally gates the grant on the target
 * company itself (`{ company: { itemNames, itemKeywords, alignment, … } }`,
 * via {@link buildTargetCompanyConditionContext}) — e.g. "a hero company …
 * possessing any Ring" (tw-96).
 */
function grantsCreatureKeying(
  state: GameState,
  mhState: MovementHazardPhaseState,
  owner: PlayerState,
  targetCompany: Company,
  creatureDef: CardDefinition,
): boolean {
  const grants = collectCreatureKeyingGrants(state, mhState);
  if (grants.length === 0) return false;

  const effectiveSiteInstanceId = targetCompany.destinationSite?.instanceId
    ?? targetCompany.currentSite?.instanceId
    ?? null;
  if (!effectiveSiteInstanceId) return false;
  const siteDefId = resolveInstanceId(state, effectiveSiteInstanceId);
  if (!siteDefId) return false;
  const siteDef = defById(state, siteDefId);
  if (!siteDef || !isSiteCard(siteDef)) return false;
  const effSiteType = getEffectiveSiteType(state, siteDefId, siteDef.siteType, effectiveSiteInstanceId);
  const siteKeywords = new Set<string>(siteDef.keywords ?? []);
  const regionPath = mhState.resolvedSitePath;

  const creatureCtx = creatureDef as unknown as Record<string, unknown>;
  for (const { sourceName, effect: e } of grants) {
    if (!matchesCondition(e.creatureFilter, creatureCtx)) continue;
    // The creature must be playable in a non-Coastal-Sea region (tw-497).
    if (e.requiresNonCoastalKeying && creatureDef.cardType === 'hazard-creature'
      && !creatureHasNonCoastalRegionKeying(creatureDef)) continue;
    // Site-type branch: effective site type in siteTypes (or NOT in excludeSiteTypes) AND all keywords.
    let siteBranch = false;
    if (e.siteFilter.siteTypes) {
      siteBranch = e.siteFilter.siteTypes.includes(effSiteType)
        && (!e.siteFilter.siteKeywords || e.siteFilter.siteKeywords.every(k => siteKeywords.has(k)));
    } else if (e.siteFilter.excludeSiteTypes) {
      siteBranch = !e.siteFilter.excludeSiteTypes.includes(effSiteType)
        && (!e.siteFilter.siteKeywords || e.siteFilter.siteKeywords.every(k => siteKeywords.has(k)));
    }
    // Region-type branch: the company path holds a granted region type.
    const regionBranch = !!e.siteFilter.regionTypes
      && regionPath.some(rt => e.siteFilter.regionTypes!.includes(rt));
    if (!siteBranch && !regionBranch) continue;
    // Target-company gate (e.g. "a hero company bearing The One Ring").
    if (e.companyFilter) {
      const companyCtx = buildTargetCompanyConditionContext(
        state, owner, targetCompany, defenderAlignmentLabel(owner.alignment),
      );
      if (!matchesCondition(e.companyFilter, companyCtx)) continue;
    }
    logDetail(
      `Creature keying granted by "${sourceName}" (${e.source ?? 'in-play'}): `
      + `${siteBranch ? `site type ${effSiteType}` : `region type on path`}`,
    );
    return true;
  }
  return false;
}

/**
 * True if the creature's printed `keyedTo` offers at least one non-Coastal-Sea
 * region keying — a region type other than Coastal, or a named region. Used to
 * evaluate A Pack at the Door's (tw-497) "must be playable in a non-Coastal Sea
 * [{c}] region" clause, which excludes Coastal-Sea-only creatures (e.g. tw-34),
 * and Long Dark Reach's (dm-70) identical "must be playable in a region besides
 * Coastal Sea" eligibility filter (`engine/long-dark-reach.ts`).
 */
export function creatureHasNonCoastalRegionKeying(def: CreatureCard): boolean {
  for (const key of def.keyedTo) {
    if (key.regionNames && key.regionNames.length > 0) return true;
    for (const rt of key.regionTypes ?? []) {
      if (rt !== RegionType.Coastal && (rt as string) !== 'coastal-sea') return true;
    }
  }
  return false;
}

/** Build a human-readable keying requirement string for error messages. */
function describeKeyingRequirement(def: CreatureCard): string {
  const keyDesc = def.keyedTo.map(k => {
    const parts: string[] = [];
    if (k.regionTypes?.length) parts.push(k.regionTypes.join('/'));
    if (k.regionNames?.length) parts.push(k.regionNames.join('/'));
    if (k.siteTypes?.length) parts.push(k.siteTypes.join('/'));
    if (k.siteNames?.length) parts.push(k.siteNames.join('/'));
    if (k.siteInRegionNames?.length) parts.push(`site-in-region:${k.siteInRegionNames.join('/')}`);
    if (k.siteKeywords?.length) parts.push(`site-keyword:${k.siteKeywords.join('/')}`);
    if (k.adjacentToSiteKeywords?.length) parts.push(`adjacent-to:${k.adjacentToSiteKeywords.join('/')}`);
    if (k.adjacentToSiteNames?.length) parts.push(`adjacent-to:${k.adjacentToSiteNames.join('/')}`);
    if (k.followsAttackRaces?.length) parts.push(`follows-attack:${k.followsAttackRaces.join('/')}`);
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
  race: Race,
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
  race: Race,
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
 * - `destinationSiteCardType` — the destination site's printed alignment
 *   (`"hero-site"` / `"minion-site"` / etc.), resolved from `targetCompany`'s
 *   actual `destinationSite` definition. Only ever populated for a company
 *   that is genuinely **moving** (unlike the `company-site` play-condition's
 *   `destinationSite ?? currentSite` fallback, `site-path` never falls back to
 *   the current site — a stationary company exposes no `destinationSiteType`
 *   at all, so a condition referencing it correctly fails). Lets a card
 *   distinguish e.g. a hero Border-hold from a minion Border-hold (the same
 *   `siteType` occurs on both alignments).
 * - `inPlay` — names of all cards currently in play for both players,
 *   matching the shared `inPlay` condition semantics (e.g. Doors of
 *   Night as an alt-keying modifier).
 * - `moving` — `true` when `targetCompany` actually has a declared
 *   destination this turn (`company.destinationSite != null`), `false`
 *   otherwise. Unlike `destinationSiteType` (which falls back to the
 *   current site's type for a stationary company, see rule 2.IV — every
 *   company's M/H phase runs all steps regardless of movement), this lets a
 *   card's playability gate distinguish "moving on any path" from "moving
 *   through/to a specific site type" — e.g. Lost in Dark-domains (tw-52):
 *   "Playable on a company that is moving this turn" is the sole legality
 *   requirement, while the Dark-domain check only decides whether the
 *   card's own effect fires.
 */
function checkSitePathCondition(
  mhState: MovementHazardPhaseState,
  effect: PlayConditionEffect,
  state?: GameState,
  targetCompany?: Company,
): boolean {
  const ctx: Record<string, unknown> = {
    sitePath: regionTypeCounts(mhState.resolvedSitePath),
    moving: targetCompany?.destinationSite != null,
  };
  if (mhState.destinationSiteType) {
    ctx['destinationSiteType'] = mhState.destinationSiteType;
  }
  // Expose the destination region type (the region the destination site sits
  // in) so play conditions can gate on it (e.g. Choking Shadows Mode B2).
  if (mhState.resolvedSitePath.length > 0) {
    ctx['destinationRegionType'] = mhState.resolvedSitePath[mhState.resolvedSitePath.length - 1];
  }
  if (state) {
    ctx['inPlay'] = buildInPlayNames(state);
  }
  if (state && targetCompany?.destinationSite) {
    const destDef = state.cardPool[targetCompany.destinationSite.definitionId] as { cardType?: string } | undefined;
    if (destDef?.cardType) {
      ctx['destinationSiteCardType'] = destDef.cardType;
    }
  }
  return effect.condition ? matchesCondition(effect.condition, ctx) : true;
}

/**
 * Evaluate a `play-condition` with `requires: 'region-through-or-leave'`
 * (Cruel Caradhras td-9).
 *
 * The card is playable on a company **using region movement** that either
 * *leaves* one of the named regions (the origin region of the path) or *moves
 * through* one without stopping at a site therein (an intermediate region of
 * the path). The region where the company stops at a site is the **destination
 * region** — the last entry of the resolved region path — and never qualifies,
 * because the company neither leaves it nor passes through it.
 *
 * Implementation: require `movementType === 'region'`, then check whether any
 * named region appears in `resolvedSitePathNames` excluding its last element
 * (the destination region). The first element is the origin ("leave"); the
 * middle elements are "move through".
 */
function checkRegionThroughOrLeave(
  mhState: MovementHazardPhaseState,
  regionNames: readonly string[],
): boolean {
  if (mhState.movementType !== 'region') {
    logDetail(`region-through-or-leave: movement type is ${mhState.movementType ?? 'none'} (not region) — not playable`);
    return false;
  }
  const pathNames = mhState.resolvedSitePathNames;
  if (pathNames.length < 2) {
    // A single-region path means origin region === destination region: the
    // company stops at a site in that region without leaving or passing through.
    logDetail(`region-through-or-leave: region path has ${pathNames.length} region(s) — no region is left or passed through`);
    return false;
  }
  // Exclude the destination region (last element) — the company stops there.
  const throughOrLeaveRegions = pathNames.slice(0, -1);
  const match = regionNames.find(rn => throughOrLeaveRegions.includes(rn));
  if (match) {
    logDetail(`region-through-or-leave: company leaves/moves through "${match}" (path: ${pathNames.join(' → ')}, destination region excluded)`);
    return true;
  }
  logDetail(`region-through-or-leave: none of [${regionNames.join(', ')}] is left or passed through (through/leave regions: ${throughOrLeaveRegions.join(', ') || 'none'})`);
  return false;
}

// mhWoundCorruptionCheckActions removed: wound corruption checks are
// now produced via the unified pending-resolution system. See
// `legal-actions/pending.ts` (corruptionCheckActions) and
// `engine/pending-reducers.ts` (applyCorruptionCheckResolution).
