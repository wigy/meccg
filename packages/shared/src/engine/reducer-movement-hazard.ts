/**
 * @module reducer-movement-hazard
 *
 * Movement/Hazard phase handlers for the game reducer. Covers company selection,
 * site revelation, hazard play, creature keying, on-guard placement, draw cards,
 * and hand reset sub-steps.
 */

import type { GameState, MovementHazardPhaseState, Company, GameAction, CombatState } from '../index.js';
import type { AhuntAttackEffect } from '../types/effects.js';
import type { CardInstanceId } from '../types/common.js';
import { BASE_MAX_REGION_DISTANCE } from '../rules/definitions/movement.js';
import { getPlayerIndex, requirePhaseState } from '../state-utils.js';
import { isCharacterCard, isSiteCard } from '../types/cards.js';
import { RegionType, Race, Skill } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { resolveHandSize, collectCharacterEffects, resolveDrawModifier } from './effects/index.js';
import { resolveAttackProwess, resolveAttackStrikes } from './effects/resolver.js';
import type { ResolverContext } from './effects/index.js';
import { matchesCondition, matchesContext } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { makeCombatState, cardName, companyEffectiveSize, clonePlayers, completeDeckExhaust, defById, findById, getCardEffects, handleExchangeSideboard, hazardPlayer, playerById, removeById, startDeckExhaust, toCardInstance, updatePlayer, wrongActionType, roll2d6, diceRollEffect } from './reducer-utils.js';
import { resolveAdjacency } from './legal-actions/organization-companies.js';
import { buildInPlayNames, applyRegionMovementReduction } from './recompute-derived.js';
import { isDetainmentAttack } from './detainment.js';
import { handlePlayHazards, advanceAfterCompanyMH } from './mh-hazard-play.js';


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
    const char = player.characters[charId];
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

  const combat: CombatState = makeCombatState({
    attackSource: { type: 'ahunt', longEventInstanceId: instanceId },
    companyId: company.id,
    defendingPlayerId: state.activePlayer!,
    attackingPlayerId: hazardPlayerId,
    strikesTotal: effectiveStrikes,
    strikeProwess: effectiveProwess,
    creatureBody: effect.body,
    creatureRace: effect.race,
    assignmentPhase: attackerChooses ? 'cancel-window' : 'defender',
    detainment: isDetainmentAttack({
      attackRace: effect.race as Race,
      defendingAlignment: state.players[activePlayerIndex].alignment,
    }),
  });

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
    const char = player.characters[charInstId];
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
