/**
 * @module legal-actions/site-transform
 *
 * Legal-action emitter for resource short-events whose modes act on a site's
 * type or its automatic-attacks rather than on a character: the
 * {@link SiteTransformEffect} ("treat one Shadow-hold as a Ruins & Lairs")
 * and the {@link AutoAttackStrikeHalvingEffect} ("the number of strikes for one
 * automatic-attack … is reduced by half"), optionally alongside an ordinary
 * {@link RegionTransformEffect} ("treat one Shadow-land as a Wilderness").
 *
 * Each mode is an *alternative* — one `play-short-event` action per concrete
 * choice, discriminated by the field it carries:
 *
 *  - `targetAutoAttackIndex` — strike-halving mode,
 *  - `targetSiteInstanceId` + `newSiteType` — site-transform mode,
 *  - `targetRegionName` + `newRegionType` — region-transform mode.
 *
 * Used by Quiet Lands (tw-309). Shared by both resource short-event emitters
 * (`playResourceShortEventActions` for the organization/site phases and
 * `heroResourceShortEventActions` for the remaining phases) so every phase of
 * the player's turn offers the same choices.
 */

import type { GameState, PlayerId, PlayerState, EvaluatedAction, CardInstance, CardDefinition, CardInstanceId } from '../../index.js';
import type { AutoAttackStrikeHalvingEffect, RegionTransformEffect, SiteTransformEffect } from '../../types/effects.js';
import type { SiteType } from '../../types/common.js';
import { isSiteCard } from '../../types/cards.js';
import { Phase } from '../../types/state-phases.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { getEffectiveSiteType } from '../effective.js';
import { getActiveAutoAttacks } from '../manifestations.js';
import { countConstraintsFromDefinition } from '../pending.js';
import { defById, getCardEffects, findDuplicationLimitEffect, isCovertCompany } from '../reducer-utils.js';
import { buildInPlayNames } from '../recompute-derived.js';
import { collectRegionTransformTargets } from './organization.js';
import { notPlayable } from './action-builders.js';
import { logDetail } from './log.js';

/** True when the card carries a mode this module emits. */
export function hasSiteTransformModes(def: CardDefinition): boolean {
  return getCardEffects(def).some(e => e.type === 'site-transform' || e.type === 'auto-attack-strike-halving');
}

/**
 * Every site in play a {@link SiteTransformEffect} can currently retype: the
 * current and declared destination sites of every company (either player's)
 * whose effective type matches an option's `from`. Under-deeps sites are never
 * offered (MEAS §6(d): an environment cannot change their type). Deduplicated
 * by site definition, since the resulting override is bound to the definition.
 */
export function collectSiteTransformTargets(
  state: GameState,
  effect: SiteTransformEffect,
): { siteInstanceId: CardInstanceId; siteName: string; newSiteType: SiteType }[] {
  const out: { siteInstanceId: CardInstanceId; siteName: string; newSiteType: SiteType }[] = [];
  const seen = new Set<string>();
  for (const p of state.players) {
    for (const company of p.companies) {
      for (const site of [company.currentSite, company.destinationSite]) {
        if (!site?.instanceId || seen.has(site.definitionId as string)) continue;
        seen.add(site.definitionId as string);
        const siteDef = defById(state, site.definitionId);
        if (!siteDef || !isSiteCard(siteDef)) continue;
        if (siteDef.keywords?.includes('under-deeps')) continue;
        const effectiveType = getEffectiveSiteType(state, site.definitionId, siteDef.siteType, site.instanceId);
        for (const option of effect.options) {
          if (option.from === effectiveType) {
            out.push({ siteInstanceId: site.instanceId, siteName: siteDef.name, newSiteType: option.to });
          }
        }
      }
    }
  }
  return out;
}

/**
 * The automatic-attack indices an {@link AutoAttackStrikeHalvingEffect} can
 * target right now: only during the site phase, while the player's active
 * company is deciding whether to enter its site (`enter-or-skip` — before any
 * automatic-attack is faced), at a site whose effective type is listed. Each
 * applicable automatic-attack (covert/overt `appliesTo` honoured) is a separate
 * choice; "each character faces one strike" attacks have no strike count to
 * halve and are skipped.
 */
function collectStrikeHalvingTargets(
  state: GameState,
  player: PlayerState,
  effect: AutoAttackStrikeHalvingEffect,
): number[] {
  const ps = state.phaseState;
  if (ps.phase !== Phase.Site || ps.step !== 'enter-or-skip') return [];
  const company = player.companies[ps.activeCompanyIndex];
  if (!company?.currentSite) return [];
  const siteDef = defById(state, company.currentSite.definitionId);
  if (!siteDef || !isSiteCard(siteDef)) return [];
  const effectiveType = getEffectiveSiteType(state, siteDef.id, siteDef.siteType, company.currentSite.instanceId);
  if (!effectiveType || !effect.siteTypes.includes(effectiveType)) return [];
  const covert = isCovertCompany(company, player, state);
  const out: number[] = [];
  getActiveAutoAttacks(state, siteDef, company.currentSite.instanceId).forEach((aa, i) => {
    if (aa.appliesTo === 'covert' && !covert) return;
    if (aa.appliesTo === 'overt' && covert) return;
    if (aa.combatRules?.includes('each-character')) return;
    out.push(i);
  });
  return out;
}

/**
 * Emit every alternative-mode play of a site-transform / strike-halving short
 * event, or a single not-playable entry when no mode currently has a target.
 */
export function siteTransformShortEventActions(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
  handCard: CardInstance,
  def: CardDefinition,
): EvaluatedAction[] {
  const cardInstanceId = handCard.instanceId;

  const turnDupLimit = findDuplicationLimitEffect(def, 'turn');
  if (turnDupLimit && countConstraintsFromDefinition(state, def.id) >= turnDupLimit.max) {
    logDetail(`${def.name}: cannot be duplicated this turn`);
    return [notPlayable(playerId, cardInstanceId, `${def.name} cannot be duplicated on a given turn`)];
  }

  const inPlay = buildInPlayNames(state);
  const gateMet = (when: unknown) => !when || matchesCondition(when as Parameters<typeof matchesCondition>[0], { inPlay });
  const effects = getCardEffects(def);
  const actions: EvaluatedAction[] = [];

  const halving = effects.find((e): e is AutoAttackStrikeHalvingEffect => e.type === 'auto-attack-strike-halving');
  if (halving && gateMet(halving.when)) {
    for (const attackIndex of collectStrikeHalvingTargets(state, player, halving)) {
      logDetail(`${def.name}: playable — halve strikes of automatic-attack #${attackIndex + 1}`);
      actions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId, targetAutoAttackIndex: attackIndex },
        viable: true,
      });
    }
  }

  const regionTransform = effects.find((e): e is RegionTransformEffect => e.type === 'region-transform');
  if (regionTransform && gateMet(regionTransform.when)) {
    for (const { regionName, newRegionType } of collectRegionTransformTargets(state, regionTransform)) {
      actions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId, targetRegionName: regionName, newRegionType },
        viable: true,
      });
    }
  }

  const siteTransform = effects.find((e): e is SiteTransformEffect => e.type === 'site-transform');
  if (siteTransform && gateMet(siteTransform.when)) {
    for (const { siteInstanceId, siteName, newSiteType } of collectSiteTransformTargets(state, siteTransform)) {
      logDetail(`${def.name}: playable — treat ${siteName} as ${newSiteType}`);
      actions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId, targetSiteInstanceId: siteInstanceId, newSiteType },
        viable: true,
      });
    }
  }

  if (actions.length === 0) {
    logDetail(`${def.name}: no automatic-attack, region or site to affect — not playable`);
    return [notPlayable(playerId, cardInstanceId, `${def.name} has nothing to affect right now`)];
  }
  return actions;
}
