/**
 * @module mh-steps
 *
 * The per-company step sequence of the movement/hazard phase: company selection
 * (handleSelectCompany), site reveal (handleRevealNewSite), Under-deeps roll
 * (handleUnderDeepsRoll, getUnderDeepsRequiredRoll), hazard-limit setup
 * (enterSetHazardLimitAndAutoAdvance, buildCompanyHazardContext,
 * snapshotHazardLimit, collectMatchingAhuntAttacks), order-effects
 * (handleOrderEffects), and the hazard draw step (transitionToDrawCards,
 * handleDrawCards, advanceDrawCards). Extracted from reducer-movement-hazard.ts
 * as the provably-closed transitive closure of these step handlers (call-graph
 * fixpoint) — it calls no other reducer-movement-hazard function.
 * reducer-movement-hazard imports the step handlers its dispatcher references
 * one-way from here; this module imports only shared leaves plus mh-hazard-play,
 * so no cycle forms.
 *
 * Pure relocation: the logic is unchanged from its previous home.
 */

import type { GameState, MovementHazardPhaseState, Company, GameAction, CombatState, PlayerState } from '../index.js';
import type { AhuntAttackEffect, UnderDeepsRollModifierEffect } from '../types/effects.js';
import type { CardInstanceId } from '../types/common.js';
import { BASE_MAX_REGION_DISTANCE } from '../rules/definitions/movement.js';
import { getPlayerIndex, companyContainsBalrogAvatar } from '../state-utils.js';
import { isCharacterCard, isSiteCard } from '../types/cards.js';
import { RegionType, Race, Skill, Alignment, MovementType } from '../types/common.js';
import { Phase } from '../types/state-phases.js';
import { collectCharacterEffects, collectPlayerInPlayEffects, resolveDrawModifier } from './effects/index.js';
import { resolveAttackProwess, resolveAttackStrikes } from './effects/resolver.js';
import type { ResolverContext, CollectedEffect } from './effects/index.js';
import { matchesCondition, matchesContext } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { resolveInstanceId } from '../types/state.js';
import type { ReducerResult } from './reducer-utils.js';
import { makeCombatState, cardName, companyEffectiveSize, clonePlayers, completeDeckExhaust, defById, getCardEffects, handleExchangeSideboard, hazardPlayer, isCovertCompany, playerById, playerConvertsDetainmentToNormal, startDeckExhaust, toCardInstance, updatePlayer, roll2d6, diceRollEffect } from './reducer-utils.js';
import { enqueueResolution } from './pending.js';
import { resolveAdjacency, cavernsUnchokedAdjacencyRoll, breachTheHoldSurfaceRoll, balrogOutHeSprangRegionAllowance, dynamicUnderDeepsAdjacencyRoll } from './legal-actions/organization-companies.js';
import { buildInPlayNames, applyRegionMovementReduction } from './recompute-derived.js';
import { companyMovementRestrictions } from './effects/company-restrictions.js';
import { isDetainmentAttack } from './detainment.js';
import { manifestIdOf } from './manifestations.js';
import { advanceAfterCompanyMH } from './mh-hazard-play.js';
import { handleGrantActionApply } from './grant-action-apply.js';

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
export function enterSetHazardLimitAndAutoAdvance(
  state: GameState,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activeIndex].companies[mhState.activeCompanyIndex];
  // `hazard-site-type-override` site-rule (Geann a-Lisch le-374): a Haven that
  // "counts as a Ruins & Lairs for the purposes of playing and interpreting
  // hazards". Reinterpret the effective site's type (and, if declared, its site
  // path) for the keying pass only, before the snapshot/order-effects funnel.
  mhState = applyHazardSiteTypeOverride(state, company, mhState);
  const snapshot = snapshotHazardLimit(state, company);
  // Left Behind (td-41): a company created (or flagged) by Left Behind faces its
  // separate movement/hazard phase with a hazard limit of exactly one.
  const forcedLeftBehind = company.leftBehind === true;
  const limit = forcedLeftBehind ? 1 : snapshot.limit;
  const preRevealConstraintIds = forcedLeftBehind ? [] : snapshot.preRevealConstraintIds;
  if (forcedLeftBehind) {
    logDetail(`Movement/Hazard: Left Behind company ${company.id as string} — hazard limit forced to 1`);
  }
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
 * Apply a `hazard-site-type-override` site-rule carried by a company's effective
 * site (destination if moving, else current) to the movement/hazard state used
 * for the creature-keying pass. The rule reinterprets the site's type — and, if
 * it declares one, its site path — purely for "playing and interpreting
 * hazards" (Geann a-Lisch le-374: "counts as a Ruins & Lairs … its site path
 * for this purpose … is the one from Carn Dûm").
 *
 * A Haven normally blocks hazards emergently (its `haven` type and empty site
 * path match no creature keying); overriding `destinationSiteType` and
 * `resolvedSitePath` re-exposes a company here to hazards keyed to that type /
 * path. No other purpose (movement, draws, healing, storage) sees the override.
 * Returns `mhState` unchanged when no such rule applies.
 */
function applyHazardSiteTypeOverride(
  state: GameState,
  company: Company,
  mhState: MovementHazardPhaseState,
): MovementHazardPhaseState {
  const effectiveSite = company.destinationSite ?? company.currentSite;
  if (!effectiveSite) return mhState;
  const siteDef = defById(state, effectiveSite.definitionId);
  if (!siteDef || !isSiteCard(siteDef) || !siteDef.effects) return mhState;
  const rule = siteDef.effects.find(
    e => e.type === 'site-rule' && e.rule === 'hazard-site-type-override',
  );
  if (!rule || rule.type !== 'site-rule' || rule.rule !== 'hazard-site-type-override') {
    return mhState;
  }
  const overriddenPath = rule.sitePath ? [...rule.sitePath] : mhState.resolvedSitePath;
  logDetail(
    `Hazard-site-type-override: ${siteDef.name} counts as ${rule.siteType} for hazard keying`
    + (rule.sitePath ? ` (site path ${overriddenPath.join(', ')})` : ''),
  );
  return {
    ...mhState,
    destinationSiteType: rule.siteType,
    resolvedSitePath: overriddenPath,
  };
}

/**
 * Handle the 'select-company' action: resource player picks which company
 * resolves its M/H sub-phase next.
 */
export function handleSelectCompany(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  // Granted-action activation (e.g. River: ranger taps to cancel the
  // constraint on an arriving company). The constraint pass-through offers
  // these in every step, so every step handler must route them (engine gap
  // class: an offered action must never be rejected by the reducer).
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
  }

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
  let maxRegionDistance = applyRegionMovementReduction(state, baseMaxRegionDistance);
  // Company-bound movement restriction (Going Ever Under Dark ba-37): hard cap
  // on region distance ("limited in all cases to N regions maximum").
  const selectRestriction = companyMovementRestrictions(player, company, state);
  if (selectRestriction?.regionMovementMax != null && selectRestriction.regionMovementMax < maxRegionDistance) {
    logDetail(`Movement/Hazard: company ${action.companyId} region distance capped at ${selectRestriction.regionMovementMax} by a movement-restriction card (was ${maxRegionDistance})`);
    maxRegionDistance = selectRestriction.regionMovementMax;
  }
  // Out He Sprang (ba-71): when this card grants The Balrog's company region
  // movement to/from an Under-deeps surface site, the region allowance is a
  // fixed MP-derived value that overrides every other region-distance effect
  // ("may not be modified by any other effects except A More Evil Hour").
  if (isMoving) {
    const outHeSprangAllowance = balrogOutHeSprangRegionAllowance(state, player, company);
    if (outHeSprangAllowance !== null) {
      logDetail(`Movement/Hazard: company ${action.companyId} region distance fixed at ${outHeSprangAllowance} by Out He Sprang (was ${maxRegionDistance})`);
      maxRegionDistance = outHeSprangAllowance;
    }
  }
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
 * Fire `site-revealed-as-new-site` on-event effects printed on a company's
 * destination site, at the moment the site is revealed and the movement path
 * declared (CoE step 1).
 *
 * Used by the Himring (as-150) family of minion sites: "An overt company must
 * tap an untapped character (if available) if this site is revealed as its
 * new site." The effect's `when` condition is evaluated against a context
 * exposing `company.covert` ({@link isCovertCompany}) — the overt gate is
 * `{ "company.covert": false }`, the covert-company variant (Isles of the
 * Dead That Live as-154) uses `true`. A matching `tap-one-character` apply
 * enqueues the existing tap-one-character pending resolution (Stench of
 * Mordor le-141) scoped to the company's movement/hazard subphase, so the
 * resource player must choose the character to tap before hazards are drawn.
 */
function fireSiteRevealedAsNewSite(
  state: GameState,
  actor: import('../types/common.js').PlayerId,
  company: Company,
  destDef: import('../index.js').SiteCard,
): GameState {
  const player = playerById(state, actor);
  if (!player) return state;
  let result = state;
  for (const e of getCardEffects(destDef)) {
    if (e.type !== 'on-event' || e.event !== 'site-revealed-as-new-site') continue;
    if (e.when) {
      const covert = isCovertCompany(company, player, state);
      if (!matchesContext(e.when, { company: { covert } })) {
        logDetail(`site-revealed-as-new-site: skipping "${destDef.name}" — condition not met (covert=${covert})`);
        continue;
      }
    }
    if (e.apply?.type !== 'tap-one-character') continue;
    logDetail(`site-revealed-as-new-site: "${destDef.name}" — company ${company.id as string} must tap one untapped character`);
    result = enqueueResolution(result, {
      source: company.destinationSite ? company.destinationSite.instanceId : null,
      actor,
      scope: { kind: 'company-mh-subphase', companyId: company.id },
      kind: {
        type: 'tap-one-character',
        companyId: company.id,
        sourceDefinitionId: destDef.id,
      },
    });
  }
  return result;
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
export function handleRevealNewSite(
  state: GameState,
  action: GameAction,
  mhState: MovementHazardPhaseState,
): ReducerResult {
  // Non-moving company: pass to advance (skip declare-path, go to set-hazard-limit)
  // Set destinationSiteType/Name to current site so creatures can be keyed to it
  if (action.type === 'pass') {
    const playerIdx = getPlayerIndex(state, action.player);
    let stateForAdvance = state;
    let nonMovingCompany = state.players[playerIdx].companies[mhState.activeCompanyIndex];

    // Rule 5.04: a company that WAS moving reaches this 'pass' branch only
    // when `revealNewSiteActions` found no legal path to its declared
    // destination — the movement is illegal and negated. Return the
    // destination site to the location deck and clear it; the company
    // still conducts a full movement/hazard phase at its current site.
    if (nonMovingCompany.destinationSite) {
      const destInst = nonMovingCompany.destinationSite;
      const destName = cardName(state, destInst.definitionId, '?');
      logDetail(`Movement/Hazard: rule 5.04 — movement to ${destName} is illegal (no legal path remains), negating it and returning the site to the location deck`);
      stateForAdvance = updatePlayer(state, playerIdx, p => ({
        ...p,
        companies: p.companies.map((c, idx) => idx !== mhState.activeCompanyIndex ? c : { ...c, destinationSite: null }),
        siteDeck: [...p.siteDeck, toCardInstance(destInst)],
      }));
      nonMovingCompany = stateForAdvance.players[playerIdx].companies[mhState.activeCompanyIndex];
    }

    const currentSiteDef = nonMovingCompany.currentSite ? defById(stateForAdvance, nonMovingCompany.currentSite.definitionId) : undefined;
    const currentSite = currentSiteDef && isSiteCard(currentSiteDef) ? currentSiteDef : undefined;
    logDetail(`Movement/Hazard: non-moving company → auto-advancing through set-hazard-limit`);
    return enterSetHazardLimitAndAutoAdvance(stateForAdvance, {
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

  // The destination site is now revealed as the company's new site — fire any
  // `site-revealed-as-new-site` on-event effects printed on it (Himring
  // as-150 family). Only appends pending resolutions, so the company/player
  // references resolved above remain valid.
  state = fireSiteRevealedAsNewSite(state, action.player, company, destDef);

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
    let required = getUnderDeepsRequiredRoll(state, originDef, destDef, action.player);
    // The Balrog (ba-3): "+3 to the roll for his company to move between
    // adjacent Under-deeps sites" — modeled as -3 to the required roll,
    // mathematically equivalent for a single 2d6 comparison.
    if (required > 0 && companyContainsBalrogAvatar(state, player, company)) {
      const boosted = Math.max(0, required - 3);
      logDetail(`The Balrog: +3 to Under-deeps movement roll — required ${required} → ${boosted}`);
      required = boosted;
    }
    // Items/allies/characters carrying `under-deeps-roll-modifier` (e.g. Iron
    // Shield of Old) add to the roll — modeled as a required-roll reduction,
    // the same equivalence used for the Balrog's built-in bonus above.
    if (required > 0) {
      const underDeepsModContext: ResolverContext = { reason: 'under-deeps-roll-modifier' };
      const underDeepsModValue = company.characters.reduce((sum, charInstId) => {
        const char = player.characters[charInstId];
        if (!char) return sum;
        const effects = collectCharacterEffects(state, char, underDeepsModContext);
        let bonus = effects
          .filter((r): r is CollectedEffect & { effect: UnderDeepsRollModifierEffect } => r.effect.type === 'under-deeps-roll-modifier')
          .reduce((s, r) => s + r.effect.value, 0);
        // Allies travelling with the character are not covered by
        // `collectCharacterEffects`; scan the ally card definitions directly so
        // an ally carrying the modifier (Cave Troll ba-35) contributes too.
        for (const ally of char.allies) {
          const allyDef = defById(state, ally.definitionId);
          if (!allyDef) continue;
          for (const eff of getCardEffects(allyDef)) {
            if (eff.type === 'under-deeps-roll-modifier') bonus += eff.value;
          }
        }
        return sum + bonus;
      }, 0);
      if (underDeepsModValue !== 0) {
        const boosted = Math.max(0, required - underDeepsModValue);
        logDetail(`under-deeps-roll-modifier: +${underDeepsModValue} to roll — required ${required} → ${boosted}`);
        required = boosted;
      }
    }
    // The Under-roads (as-106): a game-wide environment (in-play resource
    // long-event) decreasing the Under-deeps movement roll for every
    // Ringwraith-minion company. Collected from either player's `cardsInPlay`
    // (it is an environment) and applied only when the moving player is a
    // minion — same required-roll-reduction equivalence as above.
    if (required > 0 && player.alignment === Alignment.Ringwraith) {
      let minionEnvBonus = 0;
      for (const p of state.players) {
        for (const cardInPlay of p.cardsInPlay) {
          const cDef = defById(state, cardInPlay.definitionId);
          for (const eff of getCardEffects(cDef)) {
            if (eff.type === 'under-deeps-roll-modifier' && eff.scope === 'minion-companies') {
              minionEnvBonus += eff.value;
            }
          }
        }
      }
      if (minionEnvBonus !== 0) {
        const boosted = Math.max(0, required - minionEnvBonus);
        logDetail(`under-deeps-roll-modifier (minion environment): +${minionEnvBonus} to roll — required ${required} → ${boosted}`);
        required = boosted;
      }
    }
    // Gangways over the Fire (ba-60): "Subtract the number of complete
    // movement/hazard phases the company has taken so far this turn from its
    // Under-deeps movement rolls" — modeled as an equal increase of the
    // required roll. Zero for the company's first (normal) under-deeps move,
    // and only applied where an actual roll is required (required > 0).
    const gangwaysPenalty = mhState.gangwaysPhaseCounts?.[company.id as string] ?? 0;
    if (required > 0 && gangwaysPenalty > 0) {
      const penalised = required + gangwaysPenalty;
      logDetail(`Gangways over the Fire: -${gangwaysPenalty} to under-deeps roll (${gangwaysPenalty} complete M/H phase(s) this turn) — required ${required} → ${penalised}`);
      required = penalised;
    }
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

  // Roam the Waste (ba-73): a turn-scoped, player-targeted site-path-reduction
  // constraint makes each of the player's companies "considered to have one
  // fewer Wilderness / Shadow-land in its site path". Applied here, after the
  // path is resolved, so the reduced path flows to every downstream consumer
  // (creature keying, ahunt matching, force-return-to-origin, corruption counts).
  const reduced = applySitePathReduction(state, player.id, resolvedSitePath, resolvedSitePathNames);

  logDetail(`Movement/Hazard: path declared (${action.movementType}, ${reduced.path.length} region types: ${reduced.path.join(', ')}) → auto-advancing through set-hazard-limit`);
  return enterSetHazardLimitAndAutoAdvance(state, {
    ...mhState,
    movementType: action.movementType,
    declaredRegionPath: action.regionPath ?? [],
    resolvedSitePath: reduced.path,
    resolvedSitePathNames: reduced.names,
    destinationSiteType: destDef.siteType,
    destinationSiteName: destDef.name,
  });
}

/**
 * Apply any active `site-path-reduction` constraints (Roam the Waste ba-73)
 * owned by `playerId` to a freshly-resolved site path, removing up to the
 * constrained number of region-type tokens.
 *
 * Reductions from multiple constraints (e.g. two copies played the same turn)
 * are summed per region type. Tokens are dropped from the end of the path. When
 * the type and name arrays are index-parallel (region movement, where each
 * declared region contributes one type + one name together), the matching name
 * entry is removed too so the arrays stay parallel; for starter movement (types
 * from the site's sitePath, names just origin/destination) only the type array
 * is reduced. A region type never drops below zero tokens.
 */
export function applySitePathReduction(
  state: GameState,
  playerId: import('../types/common.js').PlayerId,
  path: readonly RegionType[],
  names: readonly string[],
): { path: RegionType[]; names: string[] } {
  const merged = new Map<RegionType, number>();
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'site-path-reduction') continue;
    if (constraint.target.kind !== 'player' || constraint.target.playerId !== playerId) continue;
    for (const [rt, count] of Object.entries(constraint.kind.reductions)) {
      merged.set(rt as RegionType, (merged.get(rt as RegionType) ?? 0) + (count ?? 0));
    }
  }
  if (merged.size === 0) return { path: [...path], names: [...names] };

  const parallel = path.length === names.length;
  const newPath = [...path];
  const newNames = [...names];
  for (const [rt, count] of merged) {
    let toRemove = count;
    for (let i = newPath.length - 1; i >= 0 && toRemove > 0; i--) {
      if (newPath[i] === rt) {
        newPath.splice(i, 1);
        if (parallel) newNames.splice(i, 1);
        toRemove--;
      }
    }
    if (count > 0) {
      logDetail(`site-path-reduction: removed up to ${count} "${rt}" token(s) from ${playerId as string}'s company site path`);
    }
  }
  return { path: newPath, names: newNames };
}

/**
 * Look up the required 2d6 roll for Under-deeps movement between two sites.
 *
 * Checks origin's `adjacentSites` for the destination, then (if not found)
 * checks the destination's `adjacentSites` for the origin. When the origin
 * is a surface site (not under-deeps), the roll is always 0. Caverns Unchoked
 * (ba-51) adjacency for `forPlayer` also resolves to a roll of 0.
 */
export function getUnderDeepsRequiredRoll(state: GameState, origin: import('../index.js').SiteCard, dest: import('../index.js').SiteCard, forPlayer?: import('../index.js').PlayerId): number {
  const originIsUD = origin.keywords?.includes('under-deeps') ?? false;
  if (!originIsUD) return 0;

  // Breach the Hold (ba-50): ascent from the bound Under-deeps site to its
  // surface site is reduced to 0 for the card owner. Checked before the printed
  // adjacency so it overrides the surface site's normal (high) roll.
  const breach = breachTheHoldSurfaceRoll(state, origin, dest, forPlayer);
  if (breach !== undefined) return breach;

  const fromOrigin = resolveAdjacency(state, origin, dest.name);
  if (fromOrigin !== undefined) return fromOrigin;

  const fromDest = resolveAdjacency(state, dest, origin.name);
  if (fromDest !== undefined) return fromDest;

  const caverns = cavernsUnchokedAdjacencyRoll(state, origin, dest, forPlayer);
  if (caverns !== undefined) return caverns;

  // Ancient Deep-hold (ba-83): "one Under-deeps Ruins & Lairs chosen when playing
  // this card (8)" — a dynamic adjacency to any Under-deeps site of the required
  // type. Applies whether ba-83 is the origin or the destination.
  const dynamic = dynamicUnderDeepsAdjacencyRoll(state, origin, dest);
  if (dynamic !== undefined) return dynamic;

  return 0;
}

/**
 * Handle the `under-deeps-roll` step: the resource player rolls 2d6.
 *
 * - Roll >= required: company moves; advance to `set-hazard-limit`.
 * - Roll < required: company stays; destination returned to location deck;
 *   advance to next company (does NOT count as "returned to origin").
 */
export function handleUnderDeepsRoll(state: GameState, action: GameAction, mhState: MovementHazardPhaseState): ReducerResult {
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
 * - `company.alignment` — the owning player's {@link Alignment}, so an
 *   environment can single out one side's companies ("against all overt
 *   *minion* companies", Gandalf the White Rider as-11).
 * - `company.covert` — MELE covert/overt status ({@link isCovertCompany});
 *   an *overt* company is `false`.
 *
 * The company belongs to the active (moving) player, so its characters are
 * resolved from `state.players[activeIndex].characters`.
 */
export function buildCompanyHazardContext(
  state: GameState,
  company: Company,
  activeIndex: number,
): {
    company: {
      size: number;
      hasWizard: boolean;
      maxNonRangerMind: number;
      alignment: Alignment;
      covert: boolean;
    };
  } {
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
  return {
    company: {
      size,
      hasWizard,
      maxNonRangerMind,
      alignment: player.alignment,
      covert: isCovertCompany(company, player, state),
    },
  };
}

export function snapshotHazardLimit(
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

  // hazard-limit-environment effects: each in-play card whose `when` matches
  // this company adds its value to the company's hazard limit. The condition
  // is evaluated against a per-company context (size, hasWizard,
  // maxNonRangerMind). By default only moving companies count (Eyes of the
  // Shadow dm-56: "for each moving company"); an effect with
  // `appliesTo: "all"` also reaches stationary companies (The Great Eye
  // as-85: "against all companies"). A negative value with a `floor` never
  // reduces the limit below the floor — and never raises a limit already at
  // or below it ("decreased by one (to a minimum of two)").
  {
    const envContext = buildCompanyHazardContext(state, company, activeIndex);
    for (const player of state.players) {
      for (const card of player.cardsInPlay) {
        const def = defById(state, card.definitionId);
        if (!def) continue;
        for (const eff of getCardEffects(def)) {
          if (eff.type !== 'hazard-limit-environment') continue;
          if ((eff.appliesTo ?? 'moving') === 'moving' && !company.destinationSite) {
            logDetail(`Hazard limit: ${def.name} applies to moving companies only — company is stationary, skipping`);
            continue;
          }
          if (eff.when && !matchesContext(eff.when, envContext)) continue;
          const prev = limit;
          let next = limit + eff.value;
          if (eff.value < 0 && eff.floor !== undefined && next < eff.floor) {
            next = Math.min(prev, eff.floor);
          }
          limit = next;
          logDetail(`Hazard limit modified by ${eff.value} (${def.name}${eff.floor !== undefined ? `, floor ${eff.floor}` : ''}): ${prev} → ${limit}`);
        }
      }
    }
  }

  // Company-bound movement restriction (Going Ever Under Dark ba-37): "if they
  // move with region movement … their hazard limit is reduced by one (to a
  // minimum of two)". CRF 22: the reduction only applies to a region-moving
  // company. Applied last so its floor governs the final value.
  const movementType = state.phaseState.phase === Phase.MovementHazard
    ? state.phaseState.movementType
    : null;
  if (company.destinationSite && movementType === MovementType.Region) {
    const owner = state.players[activeIndex];
    const hazardRestriction = companyMovementRestrictions(owner, company, state);
    if (hazardRestriction && hazardRestriction.hazardLimitModifier !== 0) {
      const prev = limit;
      limit = Math.max(hazardRestriction.hazardLimitFloor, limit + hazardRestriction.hazardLimitModifier);
      logDetail(`Hazard limit modified by ${hazardRestriction.hazardLimitModifier} (movement-restriction, floor ${hazardRestriction.hazardLimitFloor}): ${prev} → ${limit}`);
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
 * True when `player` (the moving/defending player) controls an in-play card
 * whose `cancel-manifestation-attacks` effect names `manifestId`. Backs a
 * Dragons "Roused" faction's "All attacks by manifestations of <Dragon> against
 * any of your companies are canceled" (Smaug Roused le-285): the faction's own —
 * or an opponent's same-chain — Ahunt region attack is skipped for this player.
 */
function playerCancelsManifestationAttacks(
  state: GameState,
  player: PlayerState,
  manifestId: string,
): boolean {
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'cancel-manifestation-attacks' && effect.manifestId === manifestId) return true;
    }
  }
  return false;
}

/**
 * Collect all ahunt-attack effects from both players' cardsInPlay that
 * match the current company's movement path. Returns an array of
 * { instanceId, effect } pairs, one per matching long-event.
 */
export function collectMatchingAhuntAttacks(
  state: GameState,
  mhState: MovementHazardPhaseState,
): { instanceId: CardInstanceId; effect: AhuntAttackEffect }[] {
  const pathNames = mhState.resolvedSitePathNames;
  const pathTypes = mhState.resolvedSitePath as readonly string[];
  if (pathNames.length === 0) return [];

  // The moving (defending) player. A card that "has no effect on a minion
  // player" (noEffectOnMinion) is skipped when this player is a Ringwraith/Sauron.
  const movingPlayer = state.players[getPlayerIndex(state, state.activePlayer!)];
  const movingPlayerIsMinion = movingPlayer.alignment === Alignment.Ringwraith;

  const inPlayNames = buildInPlayNames(state);
  const results: { instanceId: CardInstanceId; effect: AhuntAttackEffect }[] = [];

  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'ahunt-attack') continue;
        // "All attacks by manifestations of <Dragon> against any of your
        // companies are canceled" (Smaug Roused le-285): skip this Ahunt when
        // its source card is a manifestation whose chain the moving player has
        // named in a `cancel-manifestation-attacks` effect they control.
        const srcManifest = manifestIdOf(def);
        if (srcManifest !== undefined && playerCancelsManifestationAttacks(state, movingPlayer, srcManifest)) {
          logDetail(`Ahunt "${def?.name ?? card.definitionId}" is a manifestation of ${srcManifest} — canceled against ${movingPlayer.name}'s companies`);
          continue;
        }
        if (effect.noEffectOnMinion && movingPlayerIsMinion) {
          logDetail(`Ahunt "${def?.name ?? card.definitionId}" has no effect on minion player — skipping`);
          continue;
        }

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
 * Evaluate ahunt group rewards after all of a company's ahunt attacks have
 * resolved. For each source card that declared a `groupReward`, if **every**
 * ahunt attack it contributed to this company's order-effects step was defeated
 * (recorded in `mhState.ahuntGroupOutcomes`), the card is moved from play into
 * the moving (defending) player's kill pile — where a companion `mp-in-pile`
 * effect scores the reward MPs.
 *
 * Used by Mordor in Arms (dm-72): "If all three attacks are defeated by your
 * opponent, he receives this card in his MP pile and 2 kill MPs."
 */
function applyAhuntGroupRewards(
  state: GameState,
  mhState: MovementHazardPhaseState,
  matchingAhunts: { instanceId: CardInstanceId; effect: AhuntAttackEffect }[],
): GameState {
  const outcomes = mhState.ahuntGroupOutcomes ?? [];
  if (outcomes.length === 0) return state;

  // Group source instances that declared a reward, with the count of attacks
  // each contributed to this company's order-effects step.
  const rewardInstances = new Map<string, number>();
  for (const { instanceId, effect } of matchingAhunts) {
    if (!effect.groupReward?.toDefenderKillPile) continue;
    rewardInstances.set(instanceId as string, (rewardInstances.get(instanceId as string) ?? 0) + 1);
  }
  if (rewardInstances.size === 0) return state;

  const movingPlayerIndex = getPlayerIndex(state, state.activePlayer!);
  let nextState = state;

  for (const [instanceId, attackCount] of rewardInstances) {
    const instanceOutcomes = outcomes.filter(o => (o.instanceId as string) === instanceId);
    // Reward only when every contributed attack was faced AND all were defeated.
    if (instanceOutcomes.length < attackCount) continue;
    if (!instanceOutcomes.every(o => o.defeated)) {
      logDetail(`Ahunt group reward: not all attacks from ${instanceId} defeated — no reward`);
      continue;
    }

    // Locate the card in whichever player holds it in play.
    const ownerIndex = nextState.players.findIndex(p => p.cardsInPlay.some(c => (c.instanceId as string) === instanceId));
    if (ownerIndex === -1) continue;
    const card = nextState.players[ownerIndex].cardsInPlay.find(c => (c.instanceId as string) === instanceId)!;
    const cardRef = toCardInstance(card);
    logDetail(`Ahunt group reward: all attacks from "${cardName(nextState, card.definitionId, '?')}" defeated — moving to defending player's kill pile`);

    const players = nextState.players.map((p, idx) => {
      let np = p;
      if (idx === ownerIndex) np = { ...np, cardsInPlay: np.cardsInPlay.filter(c => (c.instanceId as string) !== instanceId) };
      if (idx === movingPlayerIndex) np = { ...np, killPile: [...np.killPile, cardRef] };
      return np;
    }) as unknown as typeof nextState.players;

    nextState = {
      ...nextState,
      players,
      // Drop any active constraints sourced from the removed card.
      activeConstraints: nextState.activeConstraints.filter(c => (c.source as string) !== instanceId),
    };
  }

  return nextState;
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
export function handleOrderEffects(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
  const matchingAhunts = collectMatchingAhuntAttacks(state, mhState);

  if (mhState.ahuntAttacksResolved >= matchingAhunts.length) {
    // All ahunt attacks for this company are resolved. Evaluate any ahunt
    // group rewards (e.g. Mordor in Arms dm-72) before continuing.
    const rewardedState = applyAhuntGroupRewards(state, mhState, matchingAhunts);
    // Spread the fresh `mhState` argument (which carries hazardLimitAtReveal,
    // resolvedSitePath, step, etc.), NOT rewardedState.phaseState — in the
    // auto-advance path state.phaseState is stale (the updated mhState is passed
    // as an argument, never written back into state). applyAhuntGroupRewards
    // touches players/activeConstraints only, so phaseState from mhState is authoritative.
    const clearedMhState = { ...mhState, ahuntGroupOutcomes: [] };
    return transitionToDrawCards({ ...rewardedState, phaseState: clearedMhState }, clearedMhState);
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
    creatureBody: effect.body ?? null,
    creatureRace: effect.race,
    assignmentPhase: attackerChooses ? 'cancel-window' : 'defender',
    detainment: isDetainmentAttack({
      attackRace: effect.race as Race,
      defendingAlignment: state.players[activePlayerIndex].alignment,
      defenderForcesNormalAttacks: playerConvertsDetainmentToNormal(state, state.players[activePlayerIndex]),
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
 * Apply a resolved {@link resolveDrawModifier} result to a printed draw count.
 *
 * A `min` on a *reduction* floors how far the count can be pushed down; it is
 * never a grant. "…draws one less card to a minimum of one" (Smaug at Home
 * td-71) must not hand a draw to a company that had none to begin with — a
 * resource pool of 0 because no character has mind ≥ 3 (CoE 2.IV.v) stays 0 —
 * so a net negative adjustment is also clamped to the unmodified count.
 */
function applyDrawModifier(base: number, mod: { adjustment: number; min: number }): number {
  const adjusted = Math.max(mod.min, base + mod.adjustment);
  return mod.adjustment < 0 ? Math.min(base, adjusted) : adjusted;
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
export function transitionToDrawCards(state: GameState, mhState: MovementHazardPhaseState): ReducerResult {
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
  // MEBA: likewise for a Balrog player — "when one of your Balrog companies
  // moves to a site, you and your opponent draw cards based upon the site being
  // moved to. This applies even if moving to one of your Darkhavens."
  const movingToHaven = player.alignment !== 'fallen-wizard'
    && player.alignment !== 'balrog'
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
    // Total number of regions in the site path (all types). Exposed so
    // effects can gate/scale on path length, e.g. A Short Rest (td-95):
    // "draw an extra card for each region less than four in its site path"
    // via the expression "4 - sitePath.regionCount".
    regionCount: mhState.resolvedSitePath.length,
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
  // Expose the movement type so a draw-modifier can require an actual region
  // site path. A Short Rest only works for companies with a site path — never
  // under-deeps or special movement (CRF 22 ruling) — both of which resolve to
  // an empty path / movementType 'under-deeps' | 'special'.
  const drawContext: ResolverContext = {
    reason: 'draw-modifier',
    sitePath: sitePathCounts,
    movementType: mhState.movementType,
  };
  const allDrawEffects = company.characters.flatMap(charInstId => {
    const char = player.characters[charInstId];
    if (!char) return [];
    return collectCharacterEffects(state, char, drawContext);
  });
  // Draw-modifiers may also come from the moving player's own in-play
  // events/environments (resource long-events like A Short Rest td-95), not
  // just company characters. Collecting from the *active* player's cardsInPlay
  // scopes the bonus to their companies only — the opponent never benefits.
  const activePlayerIndex = state.players.findIndex(p => p.id === state.activePlayer);
  if (activePlayerIndex >= 0) {
    allDrawEffects.push(...collectPlayerInPlayEffects(state, activePlayerIndex, drawContext));
    // A draw-modifier that speaks of "each moving company" (Smaug at Home
    // td-71: "each moving company draws one less card") reaches across the
    // table: the hazard player holds the card, but it shrinks the *moving*
    // player's draws. Only modifiers that opt in with
    // `appliesTo: 'any-company'` are collected from the opponent — everything
    // else (A Short Rest, Radagast, Alatar) stays scoped to its own player's
    // companies.
    const opponentIndex = activePlayerIndex === 0 ? 1 : 0;
    const crossTable = collectPlayerInPlayEffects(state, opponentIndex, drawContext)
      .filter(({ effect }) => effect.type === 'draw-modifier' && effect.appliesTo === 'any-company');
    if (crossTable.length > 0) {
      logDetail(`draw-modifier: ${crossTable.length} opponent-sourced modifier(s) apply to any moving company`);
      allDrawEffects.push(...crossTable);
    }
  }
  const exprContext = drawContext as unknown as Record<string, unknown>;
  const hazardMod = resolveDrawModifier(allDrawEffects, 'hazard', exprContext);
  if (hazardMod.adjustment !== 0) {
    const before = hazardDrawMax;
    hazardDrawMax = applyDrawModifier(hazardDrawMax, hazardMod);
    logDetail(`draw-modifier: hazard draws ${before} → ${hazardDrawMax} (adjustment ${hazardMod.adjustment}, min ${hazardMod.min})`);
  }
  const resourceMod = resolveDrawModifier(allDrawEffects, 'resource', exprContext);
  if (resourceMod.adjustment !== 0) {
    const before = resourceDrawMax;
    resourceDrawMax = applyDrawModifier(resourceDrawMax, resourceMod);
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
export function handleDrawCards(
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

  // Granted-action activation (e.g. River on a company that arrived this
  // M/H phase — the cancel window stays open through the draw-cards step).
  // Offered by the constraint pass-through in every step; must be routed,
  // never rejected.
  if (action.type === 'activate-granted-action') {
    return handleGrantActionApply(state, action);
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
export function advanceDrawCards(
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
