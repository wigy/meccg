/**
 * @module legal-actions/site
 *
 * Legal actions during the site phase. Each company resolves its site
 * phase sequentially: the resource player selects which company goes
 * next, decides whether to enter the site, faces automatic attacks
 * and on-guard/agent attacks, then may play resources.
 *
 * CoE rules section 2.V (lines 340–393).
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction, SitePhaseState, HeroItemCard, HeroResourceEventCard, MinionResourceEventCard, SiteCard, PlayableAtEntry, FactionCard, DenyItemSiteRule, ItemPlaySiteEffect, SiteType, RegionType, CardDefinition, CardDefinitionId, CardEffect } from '../../index.js';
import { getEffectiveSiteType, siteAttacksCanceled, resolveSiteInstanceTransform } from '../effective.js';
import { matchesCondition, matchesContext } from '../../effects/condition-matcher.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { formatSignedNumber } from '../../format-helpers.js';
import { getPlayerIndex, requirePhaseState } from '../../state-utils.js';
import { isSiteCard, isItemCard, isAllyCard, isFactionCard, isCharacterCard, isAvatarCharacter } from '../../types/cards.js';
import { CardStatus } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { resolveInstanceId } from '../../types/state.js';
import { hasSiteFlag, hasSiteFlagForPlayer, isSiteProtectedForPlayer, canAttackAlignment, cvccAttackPermitted, siteDeniesCompanyAttack, matchesDefinition, siteRuleAllowsCreatureByRace, siteRegionTypeOf, playerById, defById, getCardEffects, getLeaderControlEffect, leaderControlEligibility, collectFactionInfluenceRestriction, collectPlayerInPlayInfluenceEffects, collectGlobalCheckModifier, countCopiesInPlay, countPlayerHeldCopies, countAttachedInCompany, countPermanentEventCopiesAtSite, countItemAttachedCopies, defNamesOf, isCardNameInPlayOrCharacters, isCovertCompany, companyBlocksJoins, companyHasNoAllyRestriction, findDuplicationLimitEffect, findAllyPlayGrant, allyPlayGrantAllowsAlly, findWizardhavenAllyPlayGrant, grantedActionUsedThisTurn, isHavenForPlayer, findPlayConditionEffect, siteHasTechnologyItemUnlock, siteEddyLock, siteFactionInfluenceModifier, effectiveGeneralInfluence, rescuablePrisonersAtSite, selectCompanyActions, parseHomesiteNames, matchesCompanyContextCondition, playerWizardName, getOpponentInfluenceOverride, siteFactionLockedByAgentHomeSite } from '../reducer-utils.js';
import { collectCharacterEffects, collectCompanyAllyEffects, resolveCheckModifier, resolveAutoInfluenceFaction, resolveStatModifiers, normalizeCreatureRace, getEffectiveSkills, resolveDef } from '../effects/index.js';
import type { ResolverContext } from '../effects/index.js';
import { logDetail, logHeading } from './log.js';
import { notPlayable } from './action-builders.js';
import { availableDI, grantedActionActivations, inPlayFactionGrantActions, playResourceShortEventActions, buildPlayerStateContext, buildActiveCompanyContext } from './organization.js';
import { heroResourceShortEventActions } from './long-event.js';
import { recruitViaEventActions } from './recruit-via-event.js';
import { manifestationSwapActions } from './manifestation-swap.js';
import { discardToRecruitActions } from './discard-to-recruit.js';
import { wizardSpecificName } from '../fallen-wizard-specific.js';
import { isUnderDeepsSurfaceSite } from './organization-companies.js';
import { crossAlignmentInfluencePenalty } from '../../alignment-rules.js';
import { getActiveAutoAttacks, manifestationOfEntityInPlay, manifestationInCardsInPlay, manifestIdOf } from '../manifestations.js';
import { buildControllerInPlayNames, buildControllerFactionRaces, buildFactionPlayableAt, buildFactionPlayableRegions } from '../recompute-derived.js';
import { asViable as viable } from './evaluated.js';

/**
 * Check whether a site satisfies a {@link PlayableAtEntry}.
 * Matches by exact site name (`site`), site type (`siteType`), or region
 * name (`region`). The `region` variant matches any non-haven site in the
 * named region (haven sites are never valid for region-keyed allies like
 * Noble Steed). An optional `when` condition on `site`/`siteType` entries
 * is evaluated against a context exposing `site.name`, `site.siteType`,
 * and `site.autoAttack.race`.
 */
/**
 * MEWH §10 (site-tap alignment match): a non-Fallen-wizard resource that taps a
 * site (faction, ally, or item) may only be played at a site of the same
 * alignment class — a hero resource at a hero site, a minion resource at a
 * minion site. A Fallen-wizard site (Wizardhaven) counts as **both**, and
 * Fallen-wizard / stage / dual resources are themselves exempt. Returns true
 * when the play is barred by the alignment mismatch.
 *
 * Only relevant for a Fallen-wizard player, who mixes hero and minion resources
 * and visits both site types; for single-alignment players the classes always
 * match. The caller gates this on `player.alignment === 'fallen-wizard'`.
 */
function siteTapCrossAlignmentBlocked(
  def: CardDefinition,
  siteDef: CardDefinition | undefined,
): boolean {
  if (!isItemCard(def) && !isAllyCard(def) && !isFactionCard(def)) return false;
  if (!siteDef || !isSiteCard(siteDef)) return false;
  const resAlign = (def as { alignment?: string }).alignment;
  const siteAlign = (siteDef as { alignment?: string }).alignment;
  // Fallen-wizard / stage / dual resources are exempt; FW sites count as both.
  if (resAlign === 'fallen-wizard' || resAlign === 'stage' || resAlign === 'dual') return false;
  if (siteAlign === 'fallen-wizard') return false;
  if (resAlign === 'wizard' && siteAlign === 'ringwraith') return true;
  if (resAlign === 'ringwraith' && siteAlign === 'wizard') return true;
  return false;
}

/**
 * Guarded Haven (wh-74) / "protected Wizardhaven" family: a `site-protected`
 * constraint (added by a stage permanent-event played on a Wizardhaven) bars
 * the **opponent** of the protecting player from playing marshalling-point
 * cards at that site. "Any version of the site" is matched by definition id, so
 * the opponent's own copy of the same site in their location deck is covered.
 *
 * Returns true when an active `site-protected` constraint binds `siteDefId` and
 * is owned by a player **other than** `playerId` (i.e. `playerId` is "your
 * opponent" from the protector's point of view).
 */
function siteIsProtectedAgainstPlayer(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
  playerId: PlayerId,
): boolean {
  return isSiteProtectedForPlayer(state, siteDefId, playerId, 'opponent');
}

/**
 * Half-orcs (wh-87) / Greater Half-orcs (wh-86) "playable at one of your
 * protected Wizardhavens" family: returns true when an active `site-protected`
 * constraint binds `siteDefId` and is owned by `playerId` itself (i.e. the
 * player has protected this version of the site, e.g. via Guarded Haven). This
 * is the mirror of {@link siteIsProtectedAgainstPlayer}, which tests protection
 * by the *opponent*.
 */
function siteIsProtectedByPlayer(
  state: GameState,
  siteDefId: CardDefinitionId | undefined,
  playerId: PlayerId,
): boolean {
  return isSiteProtectedForPlayer(state, siteDefId, playerId);
}

/**
 * "Cards that give marshalling points": items, allies, and factions whose
 * printed marshalling-point value is at least 1. These are the cards the
 * protected-Wizardhaven restriction bars the opponent from playing at the site.
 */
function givesMarshallingPoints(def: CardDefinition): boolean {
  if (!isItemCard(def) && !isAllyCard(def) && !isFactionCard(def)) return false;
  const mp = (def as { marshallingPoints?: number }).marshallingPoints;
  return typeof mp === 'number' && mp > 0;
}

function siteMatchesEntry(
  siteDef: SiteCard,
  entry: PlayableAtEntry,
  effectiveSiteType: SiteType = siteDef.siteType,
  regionType?: RegionType,
  isUnderDeepsSurface = false,
): boolean {
  if ('region' in entry) {
    // Region entries match any non-haven site in the named region.
    if (effectiveSiteType === 'haven') return false;
    return siteDef.region === entry.region;
  }
  // `any` entries match every site, subject only to the optional `when`
  // condition (A Panoply of Wings wh-37: "any non-Haven, non-Shadow-hold,
  // non-Dark-hold site in a Wilderness"). All other entries key on a fixed
  // site name or site type.
  const baseMatches = 'any' in entry
    ? true
    : 'site' in entry
      ? siteDef.name === entry.site
      : effectiveSiteType === entry.siteType;
  if (!baseMatches) return false;
  if (!entry.when) return true;
  const autoAttackRaces = siteDef.automaticAttacks.map(a => normalizeCreatureRace(a.creatureType));
  const ctx: Record<string, unknown> = {
    site: {
      name: siteDef.name,
      siteType: effectiveSiteType,
      // The region *type* of the site (from the separate region card). Lets a
      // faction gate on "Ruins & Lairs in a Wilderness" (Wild Hounds wh-40) via
      // `when: { "site.regionType": "wilderness" }`. Only supplied by callers
      // that have `state` in scope (the faction paths); undefined elsewhere.
      regionType,
      region: siteDef.region,
      // The site's printed keywords (e.g. `under-deeps`, `hoard`). Lets an
      // ally/faction gate on "an Under-deeps site with a Troll automatic-attack"
      // (Cave Troll ba-35) via `when: { "site.keywords": { "$includes": "under-deeps" } }`.
      keywords: siteDef.keywords ?? [],
      autoAttack: { race: autoAttackRaces },
      // The dragon whose lair this Ruins & Lairs site is (a card id) — absent
      // for ordinary sites. Lets a faction/ally exclude Dragon's lairs via
      // `{ "site.lairOf": { "$exists": false } }` (A Few Recruits ba-80:
      // "non-Dragon's lair").
      lairOf: (siteDef as { lairOf?: unknown }).lairOf,
      // True when this site is the roll-0 surface entrance of an Under-deeps
      // site. Together with the `under-deeps` keyword this lets a faction/ally
      // gate on "not an Under-deeps site or surface site thereof" (ba-80).
      isUnderDeepsSurface,
    },
  };
  return matchesCondition(entry.when, ctx);
}

/**
 * Compute legal actions for the site phase.
 *
 * Dispatches to the appropriate sub-step handler based on the current
 * site phase step.
 */
export function siteActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  const siteState = requirePhaseState(state, Phase.Site);

  logHeading(`Site phase (step: ${siteState.step}): player is ${isActive ? 'active (resource)' : 'non-active (hazard)'}`);

  // Wound corruption checks (Barrow-downs et al.) are now produced and
  // consumed via the unified pending-resolution system; the
  // resolution short-circuit in `legal-actions/index.ts` handles them
  // before this function is reached.

  if (siteState.step === 'select-company') {
    const base = viable(selectCompanyActions(state, playerId, siteState.handledCompanyIds));
    // Every remaining company may have dissolved mid-phase (e.g. its last
    // character died to a corruption check) — offer pass so the active
    // player can close the site phase instead of deadlocking.
    if (isActive && base.length === 0) {
      logDetail('Site select-company: no companies left to select — offering pass to end the phase');
      base.push({ action: { type: 'pass', player: playerId }, viable: true });
    }
    // Rule 2.1.1: resource player may play resource short-events during
    // any phase of their turn, including before selecting a company.
    if (isActive) {
      base.push(...heroResourceShortEventActions(state, playerId, 'site'));
    } else {
      // Non-active player may activate `opposingSitePhase: true`
      // grant-actions (e.g. Magical Harp).
      base.push(...grantedActionActivations(state, playerId, 'opposingSitePhase'));
    }
    return base;
  }

  if (siteState.step === 'enter-or-skip') {
    const base = viable(enterOrSkipActions(state, playerId, siteState));
    // Rule 2.1.1: resource player may play resource short-events before
    // committing to enter or skip the current company's site.
    // Use playResourceShortEventActions (not heroResourceShortEventActions) so
    // that play-condition checks (site-has-resource, company-has-item) are
    // evaluated against the active company's site. The active company has
    // already been selected by this step, so activeCompanyIndex is valid.
    if (isActive) {
      base.push(...playResourceShortEventActions(state, playerId, new Set(), 'site'));
      // Active-player site-phase grant-actions usable at the enter-or-skip
      // decision window (e.g. Blasting Fire discard to cancel automatic-attacks
      // before the company commits to facing them).
      base.push(...grantedActionActivations(state, playerId, 'activeSitePhase'));
    } else {
      base.push(...grantedActionActivations(state, playerId, 'opposingSitePhase'));
    }
    return base;
  }

  if (siteState.step === 'reveal-on-guard-attacks') {
    return viable(revealOnGuardAttacksActions(state, playerId, siteState));
  }

  if (siteState.step === 'forewarned-select-attack') {
    return viable(forewarnedSelectAttackActions(state, playerId, siteState));
  }

  if (siteState.step === 'play-site-auto-attack') {
    return viable(playSiteAutoAttackActions(state, playerId, siteState));
  }

  if (siteState.step === 'automatic-attacks'
    || siteState.step === 'troll-purse-attacks'
    || siteState.step === 'rescue-attacks') {
    // Repeated/sequenced attacks (Troll-purse re-face, prisoner-rescue): the
    // active player passes to initiate the next attack (or to finish).
    return viable(automaticAttacksActions(state, playerId, siteState));
  }

  if (siteState.step === 'declare-agent-attack') {
    return viable(declareAgentAttackActions(state, playerId));
  }

  if (siteState.step === 'resolve-attacks') {
    return viable(resolveAttacksActions(state, playerId));
  }

  if (siteState.step === 'play-resources') {
    // Opponent-influence-defend and on-guard-window are now produced
    // via the unified pending-resolution dispatcher in
    // `legal-actions/index.ts` before this function is reached.
    const base = playResourcesActions(state, playerId, siteState);
    if (isActive) {
      // Active player may activate `activeSitePhase: true` grant-actions on
      // their carried items during the play-resources step (e.g. Vile Fumes'
      // discard-to-transform feature).
      base.push(...grantedActionActivations(state, playerId, 'activeSitePhase'));
      // Discard-to-effect abilities on the player's in-play factions
      // (A Panoply of Wings wh-37: discard to make Information playable at
      // such a site — activated during the site phase).
      base.push(...inPlayFactionGrantActions(state, playerId));
      // Prisoner rescue (CoE rule 8.36): if the active company is at a site
      // holding its own prisoners (e.g. by Troll-purse), offer to face the
      // host's rescue-attack to free them.
      const rescuable = rescuablePrisonersAtSite(state, getPlayerIndex(state, playerId), siteState.activeCompanyIndex);
      if (rescuable) {
        base.push(...viable([{ type: 'rescue-prisoner', player: playerId, hostInstanceId: rescuable.hostInstanceId }]));
      }
    }
    return base;
  }

  // TODO: play-minor-item

  if (siteState.step === 'declare-company-attack') {
    return viable(declareCompanyAttackActions(state, playerId, siteState));
  }

  if (!isActive) {
    logDetail(`Not active player, no site actions`);
    return [];
  }

  return viable([{ type: 'pass', player: playerId }]);
}

/**
 * Generate enter-or-skip actions for the current company.
 *
 * The resource player decides whether to enter the site (facing attacks
 * and potentially playing resources) or do nothing (pass), which ends
 * that company's site phase immediately (CoE lines 341–343).
 */
function enterOrSkipActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during enter-or-skip step`);
    return [];
  }

  const player = playerById(state, playerId)!;
  const company = player.companies[siteState.activeCompanyIndex];
  if (!company) {
    // The selected company dissolved before the enter-or-skip choice —
    // only pass remains, which finishes its site-phase slot.
    logDetail('Enter-or-skip: active company no longer exists — only pass is available');
    return [{ type: 'pass', player: playerId }];
  }

  logDetail(`Company ${company.id}: offering enter-site and pass (do nothing)`);
  return [
    { type: 'enter-site', player: playerId, companyId: company.id },
    { type: 'pass', player: playerId },
  ];
}

/**
 * Reveal-on-guard-attacks step (CoE Step 1, line 345).
 *
 * The hazard player (non-active) may reveal on-guard creatures keyed
 * to the company's current site, or pass. If there are no on-guard
 * cards or no eligible creatures, only pass is offered.
 */
function revealOnGuardAttacksActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;

  // Only the hazard player (non-active) reveals on-guard cards
  if (isActive) {
    logDetail(`Active player waits during reveal-on-guard-attacks step`);
    return [];
  }

  const resourcePlayer = playerById(state, state.activePlayer)!;
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];

  const unrevealedCards = company ? company.onGuardCards.filter(og => !og.revealed) : [];
  if (!company || unrevealedCards.length === 0) {
    logDetail(`No unrevealed on-guard cards — pass to advance`);
    return [{ type: 'pass', player: playerId }];
  }

  // Look up the site definition for keying and auto-attack checks
  const siteDef = company.currentSite
    ? defById(state, company.currentSite.definitionId)
    : undefined;

  // Rule 2.V.i: creature reveals only allowed if the site has automatic-attacks
  const hasAutoAttacks = siteDef && isSiteCard(siteDef)
    && getActiveAutoAttacks(state, siteDef, company.currentSite?.instanceId).length > 0;

  const actions: GameAction[] = [];

  for (const ogCard of company.onGuardCards) {
    if (ogCard.revealed) continue;
    const def = defById(state, ogCard.definitionId);
    if (!def) continue;

    if (def.cardType === 'hazard-creature') {
      if (!hasAutoAttacks) continue;

      // Check creature keying against the site (rule 2.V.i: "keyed to the site").
      // Only site-type and site-name keying apply here; region-type keying is for
      // movement (company moving through regions) and does not apply at the site phase.
      if (siteDef && isSiteCard(siteDef)) {
        let keyable = false;
        for (const key of def.keyedTo) {
          if (key.siteTypes && key.siteTypes.includes(siteDef.siteType)) {
            logDetail(`On-guard creature "${def.name}" keyable by site-type: ${siteDef.siteType}`);
            keyable = true;
            break;
          }
          if (key.siteNames && key.siteNames.includes(siteDef.name)) {
            logDetail(`On-guard creature "${def.name}" keyable by site-name: ${siteDef.name}`);
            keyable = true;
            break;
          }
        }
        if (!keyable) {
          logDetail(`On-guard creature "${def.name}" not keyable to ${siteDef.name}`);
          continue;
        }
      }

      actions.push({
        type: 'reveal-on-guard',
        player: playerId,
        cardInstanceId: ogCard.instanceId,
      });
    } else if (def.cardType === 'hazard-event' && hasAutoAttacks) {
      // Rule 2.V.i: hazard events that affect automatic-attacks can be revealed here
      const affectsAutoAttacks = 'effects' in def && def.effects?.some(
        e => e.type === 'stat-modifier' && (e.target === 'all-automatic-attacks' || e.target === 'all-attacks'),
      );
      if (affectsAutoAttacks) {
        logDetail(`On-guard event "${def.name}" affects automatic-attacks — eligible for reveal`);
        actions.push({
          type: 'reveal-on-guard',
          player: playerId,
          cardInstanceId: ogCard.instanceId,
        });
      }
    }
  }

  if (actions.length > 0) {
    logDetail(`Reveal on-guard: ${actions.length} card(s) eligible for reveal`);
  } else {
    logDetail(`No eligible on-guard cards to reveal`);
  }

  // Always offer pass
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Forewarned Is Forearmed: hazard player selects which automatic attack
 * to retain. The resource player (active) has no actions here.
 */
function forewarnedSelectAttackActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (isActive) {
    logDetail(`Forewarned-select-attack: resource player waits for hazard player's selection`);
    return [];
  }
  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activeIndex].companies[siteState.activeCompanyIndex];
  if (!company?.currentSite) return [];
  const siteDef = defById(state, company.currentSite.definitionId);
  if (!siteDef || !isSiteCard(siteDef)) return [];
  const autoAttacks = getActiveAutoAttacks(state, siteDef, company.currentSite.instanceId);
  if (autoAttacks.length <= 1) return [];
  return autoAttacks.map((_aa, i) => ({
    type: 'select-forewarned-attack' as const,
    player: playerId,
    attackIndex: i,
  }));
}

/**
 * Automatic-attacks step (CoE Step 2, line 350).
 *
 * Each automatic attack listed on the site card triggers combat; the
 * active player passes to initiate the next one. Before that happens, the
 * CRF Site Phase / Automatic-attacks rule ("any character may tap to
 * cancel one automatic-attack at his home site") offers a `cancel-auto-attack`
 * action for every untapped character in the active company whose named
 * home site matches the current site — one attack canceled per tap, still
 * counting as faced.
 */
function automaticAttacksActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during automatic-attacks step`);
    return [];
  }

  const actions: GameAction[] = [{ type: 'pass', player: playerId }];

  // The home-site cancel option only applies to the site's own automatic-attacks
  // (not Forewarned's single fixed selection, nor Troll-purse/rescue re-facings),
  // and only while there's still an attack left to face.
  if (siteState.step === 'automatic-attacks' && siteState.selectedAutoAttackIndex === undefined) {
    const player = playerById(state, playerId)!;
    const company = player.companies[siteState.activeCompanyIndex];
    const siteDef = company?.currentSite ? defById(state, company.currentSite.definitionId) : undefined;
    const siteName = siteDef && isSiteCard(siteDef) ? siteDef.name : undefined;
    const autoAttacks = siteDef && isSiteCard(siteDef) ? getActiveAutoAttacks(state, siteDef, company?.currentSite?.instanceId) : [];

    if (company && siteName && siteState.automaticAttacksResolved < autoAttacks.length) {
      for (const charId of company.characters) {
        const char = player.characters[charId];
        if (!char || char.status !== CardStatus.Untapped) continue;
        const charDef = defById(state, char.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (!parseHomesiteNames(charDef.homesite ?? '').includes(siteName)) continue;
        logDetail(`Automatic attacks: ${charDef.name} may tap to cancel one attack at home site "${siteName}"`);
        actions.push({ type: 'cancel-auto-attack', player: playerId, characterId: charId });
      }
    }
  }

  logDetail(`Automatic attacks — ${actions.length} action(s) offered`);
  return actions;
}

/**
 * Dynamic automatic-attack step (e.g. Framsburg td-175).
 *
 * The hazard player may play one creature from their hand whose keying
 * satisfies the site's `dynamic-auto-attack` filter; that creature
 * initiates combat and is treated as the site's automatic-attack.
 * Passing skips without combat (the site has no static auto-attack to
 * fall through to).
 */
function playSiteAutoAttackActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (isActive) {
    logDetail(`Active player waits during play-site-auto-attack step`);
    return [];
  }

  const resourcePlayer = playerById(state, state.activePlayer)!;
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];
  const siteDef = company?.currentSite
    ? defById(state, company.currentSite.definitionId)
    : undefined;

  const dynamicRule = siteDef && isSiteCard(siteDef)
    ? siteDef.effects?.find(e => e.type === 'site-rule' && e.rule === 'dynamic-auto-attack')
    : undefined;

  const actions: GameAction[] = [];

  if (dynamicRule && dynamicRule.type === 'site-rule' && dynamicRule.rule === 'dynamic-auto-attack') {
    const allowedSiteTypes = new Set(dynamicRule.keying.siteTypes ?? []);
    const allowedRegionTypes = new Set(dynamicRule.keying.regionTypes ?? []);
    const hazardPlayer = playerById(state, playerId)!;

    for (const card of hazardPlayer.hand) {
      const def = defById(state, card.definitionId);
      if (!def || def.cardType !== 'hazard-creature') continue;
      // Only non-unique creatures may be played as a site auto-attack
      if (def.unique) {
        logDetail(`Creature "${def.name}" is unique — not eligible as site's dynamic auto-attack`);
        continue;
      }

      let keyable = false;
      for (const key of def.keyedTo) {
        if (key.siteTypes && key.siteTypes.some(st => allowedSiteTypes.has(st))) {
          keyable = true;
          break;
        }
        if (key.regionTypes && key.regionTypes.some(rt => allowedRegionTypes.has(rt))) {
          keyable = true;
          break;
        }
        // siteKeywords: creature keyed to "any under-deeps site" is eligible at any
        // under-deeps site — match when the site's own keywords include any of the keys
        if (key.siteKeywords && siteDef && isSiteCard(siteDef)) {
          const siteKeywords = siteDef.keywords ?? [];
          if (key.siteKeywords.some(kw => siteKeywords.includes(kw))) {
            keyable = true;
            break;
          }
        }
      }
      // A site `allow-creature-by-race` rule ("any Drake may be keyed to this
      // site", except Sea Serpent) makes the creature keyable to *this site*.
      // That keying-permission extends to the dynamically-played 2nd auto-attack
      // only when the attack keys by SITE-TYPE (e.g. The Iron-deeps ba-91: "…
      // keyed to a Ruins and Lairs") — being keyed to this site is itself a form
      // of site keying, so it satisfies a site-type requirement. When the attack
      // keys by REGION-TYPE (e.g. The Drowning-deeps ba-89: "…keyed to Coastal
      // Seas"), keying to this site grants no region keying, so the race bypass
      // does NOT feed the auto-attack.
      if (!keyable && allowedSiteTypes.size > 0 && siteRuleAllowsCreatureByRace(siteDef, def)) {
        keyable = true;
      }
      if (!keyable) {
        logDetail(`Creature "${def.name}" keying does not match dynamic auto-attack filter — skipping`);
        continue;
      }

      logDetail(`Creature "${def.name}" eligible as site's dynamic auto-attack`);
      actions.push({
        type: 'play-site-auto-attack',
        player: playerId,
        cardInstanceId: card.instanceId,
      });
    }
  }

  actions.push({ type: 'pass', player: playerId });
  return actions;
}

// woundCorruptionCheckActions removed: wound corruption checks are
// now produced via the unified pending-resolution system. See
// `legal-actions/pending.ts` (corruptionCheckActions) and
// `engine/pending-reducers.ts` (applyCorruptionCheckResolution).

/**
 * Generate declare-agent-attack actions for the hazard player (CoE Step 3,
 * line 358). The hazard player may declare that an agent at the company's
 * current site will attack. Face-down agents are revealed at declaration.
 * An agent must not have already attacked this site phase. The active
 * (resource) player waits.
 *
 * Always includes a `pass` so the hazard player can skip the step.
 */
function declareAgentAttackActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (isActive) {
    logDetail(`Active player waits during declare-agent-attack step`);
    return [];
  }

  const siteState = requirePhaseState(state, Phase.Site);
  const activePlayerIndex = getPlayerIndex(state, state.activePlayer!);
  const company = state.players[activePlayerIndex].companies[siteState.activeCompanyIndex];
  const currentSiteDef = company?.currentSite
    ? defById(state, company.currentSite.definitionId)
    : undefined;
  const currentSiteDefId = company?.currentSite?.definitionId;
  const currentSiteName = currentSiteDef && isSiteCard(currentSiteDef) ? currentSiteDef.name : undefined;

  if (!currentSiteDefId || !currentSiteName) {
    logDetail(`declare-agent-attack: no current site for active company — only pass`);
    return [{ type: 'pass', player: playerId }];
  }

  // Hidden Haven (wh-75): "all attacks against it are canceled" — no agent may
  // declare an attack on a company occupying the converted site.
  if (siteAttacksCanceled(state, currentSiteDefId)) {
    logDetail(`declare-agent-attack: attacks canceled at ${currentSiteName} (Hidden Haven) — only pass`);
    return [{ type: 'pass', player: playerId }];
  }

  const hazardPlayer = playerById(state, playerId)!;

  const actions: GameAction[] = [];
  for (const agent of hazardPlayer.agents) {
    if (agent.attackedThisSitePhase) {
      logDetail(`Agent ${agent.id as string}: already attacked this site phase — skipping`);
      continue;
    }

    const agentDef = defById(state, agent.character.definitionId);
    const homesiteNames = agentDef && isCharacterCard(agentDef)
      ? parseHomesiteNames(agentDef.homesite)
      : [];

    if (agent.revealed) {
      // Face-up agent: must be at company's site (top of siteStack)
      if (agent.siteStack.length === 0) continue;
      const topSite = agent.siteStack[agent.siteStack.length - 1];
      if (topSite.definitionId !== currentSiteDefId) {
        logDetail(`Agent ${agent.id as string}: face-up, not at company's site — skipping`);
        continue;
      }
      logDetail(`Agent ${agent.id as string}: face-up at company's site — can declare attack`);
      actions.push({ type: 'declare-agent-attack', player: playerId, agentInstanceId: agent.character.instanceId });
    } else {
      // Face-down agent: check if it is at the company's current site
      // Empty siteStack → agent is at one of its home sites
      // Non-empty siteStack → agent is at top of stack
      const isAtCompanySite = agent.siteStack.length === 0
        ? homesiteNames.includes(currentSiteName)
        : agent.siteStack[agent.siteStack.length - 1].definitionId === currentSiteDefId;

      if (!isAtCompanySite) {
        logDetail(`Agent ${agent.id as string}: face-down, not at company's site — skipping`);
        continue;
      }

      // Offer one action per home site in deck (for the reveal-at-declare)
      const seenHome = new Set<string>();
      let offeredAny = false;
      for (const siteInst of hazardPlayer.siteDeck) {
        const siteDef = defById(state, siteInst.definitionId);
        if (!siteDef || !isSiteCard(siteDef)) continue;
        if (siteDef.name !== currentSiteName) continue;
        if (seenHome.has(siteDef.name)) continue;
        seenHome.add(siteDef.name);
        logDetail(`Agent ${agent.id as string}: face-down at company's site, home site "${siteDef.name}" available — offering attack`);
        actions.push({
          type: 'declare-agent-attack',
          player: playerId,
          agentInstanceId: agent.character.instanceId,
          homeSiteInstanceId: siteInst.instanceId,
        });
        offeredAny = true;
      }
      if (!offeredAny) {
        // No home site in deck — reveal without site, agent discarded at EOT (rule 9.04)
        logDetail(`Agent ${agent.id as string}: face-down at company's site, no home site in deck — offering attack without site (discard at EOT)`);
        actions.push({ type: 'declare-agent-attack', player: playerId, agentInstanceId: agent.character.instanceId });
      }
    }
  }

  // Always offer pass to skip the agent attack step
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Stub: resolve-attacks step (CoE Step 4, line 361).
 *
 * On-guard creature and agent attacks are resolved in resource player's
 * chosen order. For now, only active player can pass.
 */
function resolveAttacksActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during resolve-attacks step`);
    return [];
  }
  logDetail(`Resolve attacks — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

// onGuardRevealAtResourceActions removed: the on-guard reveal window
// is now produced via the unified pending-resolution dispatcher in
// `legal-actions/pending.ts:onGuardWindowActions`.

/**
 * Generate play-resources actions for the current company (CoE lines 362–374).
 *
 * After entering a site, the resource player may play resources. Each hand
 * card is evaluated for playability:
 * - Permanent resource events are playable (same rules as organization phase).
 * - Items (minor, major, greater) are playable if the site allows that subtype
 *   and there is an untapped character in the company to carry the item.
 * - All other cards are marked as not-playable with a reason.
 *
 * Pass is always available to end the company's site phase.
 */
function playResourcesActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    // Non-active player may activate `opposingSitePhase: true`
    // grant-actions (e.g. Magical Harp) while the resource player is
    // playing resources at a site.
    const opposing = grantedActionActivations(state, playerId, 'opposingSitePhase');
    if (opposing.length > 0) {
      logDetail(`Not active player — ${opposing.length} opposing-site-phase grant-action(s) available`);
    } else {
      logDetail(`Not active player — no actions during play-resources step`);
    }
    return opposing;
  }

  const player = playerById(state, playerId)!;
  const company = player.companies[siteState.activeCompanyIndex];
  const actions: EvaluatedAction[] = [];
  if (!company) {
    // The active company dissolved mid-site-phase (e.g. every character died
    // to an automatic-attack or body check after entering) — pass is the one
    // action left, and it finishes the dissolved company's site-phase slot.
    logDetail('Site play-resources: active company no longer exists — only pass is available');
    return viable([{ type: 'pass', player: playerId }]);
  }

  // Look up the site's playable resource types
  const siteInstanceId = company.currentSite?.instanceId ?? null;
  const siteDefId = siteInstanceId ? resolveInstanceId(state, siteInstanceId) : undefined;
  const siteDef = siteDefId ? defById(state, siteDefId) : undefined;
  // Hidden Haven (wh-75): "Nothing is considered playable as written on the
  // site card." This nullifies only the resource categories printed on the site
  // card itself — its `playableResources` list (minor/major/greater items,
  // gold-ring, information). Factions and allies are NOT written on the site
  // card: their playability comes from the faction/ally card naming the site
  // (CoE 2.V.3, 7.x), so they remain playable at the converted site. This is the
  // canonical Hidden Haven combo — neutralise a Ruins & Lairs' automatic-attacks
  // (e.g. Ettenmoors' Trolls/Wolves) and then safely influence the faction that
  // names it (Misty Mountain Wargs, le-272).
  const nothingPlayableAsWritten = hasSiteFlag(state.activeConstraints, 'site-nothing-playable-as-written', siteDefId);
  const playableTypes = nothingPlayableAsWritten
    ? new Set<string>()
    : siteDef && isSiteCard(siteDef) ? new Set(siteDef.playableResources) : new Set<string>();
  const siteName = siteDef?.name ?? 'unknown site';
  if (nothingPlayableAsWritten) {
    logDetail(`Site ${siteName}: nothing playable as written (Hidden Haven) — printed resource categories suppressed (factions/allies that name the site remain playable)`);
  }

  const siteIsTapped = company.currentSite?.status === CardStatus.Tapped;
  logDetail(`Site ${siteName}: playable resource types: ${[...playableTypes].join(', ') || 'none'}, tapped: ${siteIsTapped}`);

  // Check for major-item-unlocked constraint (Hermit's Hill dm-32 special ability)
  const majorItemUnlocked = state.activeConstraints.some(
    c => c.kind.type === 'major-item-unlocked'
      && c.target.kind === 'company'
      && c.target.companyId === company.id,
  );

  // Check for gold-ring-item-unlocked constraint (Hermit's Hill le-382
  // special ability): a covert company discarded two minor items to make one
  // gold ring playable at this untapped site, regardless of the ring's text
  // restrictions.
  const goldRingItemUnlocked = state.activeConstraints.some(
    c => c.kind.type === 'gold-ring-item-unlocked'
      && c.target.kind === 'company'
      && c.target.companyId === company.id,
  );

  // Find untapped characters in this company for item attachment
  const untappedCharacters = company.characters
    .map(cId => player.characters[cId])
    .filter(ch => ch !== undefined && ch.status === CardStatus.Untapped);

  logDetail(`Untapped characters in company: ${untappedCharacters.length}`);

  // Eddy in Fate's Tide (ba-57): while any version of this site definition is
  // bound by an in-play `eddy-lock`, a company must tap `taxTapCharacters`
  // characters this site phase before it may play an ally or item here. Track
  // how many have been paid; gate ally/item plays and offer `pay-site-tax`
  // actions until the tax is met.
  const eddyLock = siteEddyLock(state, siteDefId);
  const eddyTaxTapped = siteState.eddyTaxTapped ?? 0;
  const eddyTaxUnpaid = eddyLock !== undefined && eddyTaxTapped < eddyLock.taxTapCharacters;
  if (eddyLock) {
    logDetail(`Site ${siteName}: Eddy in Fate's Tide tax ${eddyTaxTapped}/${eddyLock.taxTapCharacters} paid this site phase`);
  }

  // Evaluate each hand card
  const evaluatedInstances = new Set<string>();

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = defById(state, handCard.definitionId);
    if (!def) continue;

    // MEWH §10: a Fallen-wizard may not play a hero resource that taps a minion
    // site (or a minion resource at a hero site). Wizardhavens count as both, so
    // FW sites and FW/stage resources pass through `siteTapCrossAlignmentBlocked`.
    // Double-dealing (wh-66) lifts this restriction at the site it is played on:
    // a `cross-alignment-resources-unlocked` constraint for this player + site
    // makes the opposite alignment's resources playable there.
    if (player.alignment === 'fallen-wizard' && siteTapCrossAlignmentBlocked(def, siteDef)) {
      const crossUnlocked = hasSiteFlagForPlayer(
        state.activeConstraints, 'cross-alignment-resources-unlocked', siteDefId, playerId,
      );
      if (!crossUnlocked) {
        logDetail(`Site ${siteName}: ${def.name} barred — cross-alignment site-tap (MEWH §10)`);
        continue;
      }
      logDetail(`Site ${siteName}: ${def.name} cross-alignment play allowed by Double-dealing`);
    }

    // Guarded Haven (wh-74) / protected Wizardhaven: the opponent of the
    // protecting player may not play marshalling-point cards at any version of
    // the protected site "in all cases".
    if (givesMarshallingPoints(def) && siteIsProtectedAgainstPlayer(state, siteDefId, playerId)) {
      logDetail(`Site ${siteName}: ${def.name} barred — site is a protected Wizardhaven (no opponent MP cards)`);
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: ${siteName} is protected — your opponent may not play marshalling-point cards here`));
      continue;
    }

    // Permanent resource events — playable like in organization phase
    // Handles both hero (wizard) and minion (ringwraith) permanent events.
    if (def.cardType === 'hero-resource-event' || def.cardType === 'minion-resource-event') {
      const eventDef: HeroResourceEventCard | MinionResourceEventCard = def;
      if (eventDef.eventType === 'permanent') {
        // Rule 5.F1 [FALLEN-WIZARD]: Stage resource permanent-events can only be
        // played during the organization phase. Site-targeting Stage resources
        // (The Fortress of Isen wh-68, Guarded Haven wh-74, …) are offered there
        // (see legal-actions/organization-events.ts), not in the site phase — so
        // leave them unevaluated here and they fall through to "not playable".
        //
        // Exception: a Stage resource whose text declares its own site-phase
        // timing carries an `active-company` play-condition (Delver's Harvest
        // wh-65: "Playable during the site phase if one of your companies enters
        // the Deep Mines site."). Such a card is evaluated here against the
        // active company and is NOT offered during the organization phase.
        const stageActiveCompanyCond = (eventDef as { alignment?: string }).alignment === 'stage'
          ? findPlayConditionEffect(eventDef, 'active-company')
          : undefined;
        if ((eventDef as { alignment?: string }).alignment === 'stage' && !stageActiveCompanyCond) {
          logDetail(`Permanent event ${eventDef.name}: Stage resource — only playable during the organization phase (rule 5.F1)`);
          continue;
        }
        if (stageActiveCompanyCond?.condition) {
          const ctx = buildActiveCompanyContext(state, player, company);
          if (!matchesCondition(stageActiveCompanyCond.condition, ctx)) {
            logDetail(`Permanent event ${eventDef.name}: active-company play-condition not satisfied at ${siteName}`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: play condition not met`));
            continue;
          }
        }
        evaluatedInstances.add(cardInstanceId as string);

        // Check uniqueness
        if (eventDef.unique) {
          const alreadyInPlay = countCopiesInPlay(state, eventDef.name) > 0;
          if (alreadyInPlay) {
            logDetail(`Permanent event ${eventDef.name}: unique and already in play`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name} is unique and already in play`));
            continue;
          }
        }

        // Check duplication-limit with scope "game": cannot play if a copy is already in play
        const dupLimit = findDuplicationLimitEffect(eventDef, 'game');
        if (dupLimit) {
          const copiesInPlay = countCopiesInPlay(state, eventDef.name);
          if (copiesInPlay >= dupLimit.max) {
            logDetail(`Permanent event ${eventDef.name}: cannot be duplicated (${copiesInPlay}/${dupLimit.max} in play)`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name} cannot be duplicated`));
            continue;
          }
        }

        // duplication-limit: scope "player" — one copy per player across both
        // their cards in play (non-attached permanent events like Great Patron
        // wh-72) and their characters' items.
        const playerDupLimit = findDuplicationLimitEffect(eventDef, 'player');
        if (playerDupLimit) {
          const copiesForPlayer = countPlayerHeldCopies(state, player, eventDef.name);
          if (copiesForPlayer >= playerDupLimit.max) {
            logDetail(`Permanent event ${eventDef.name}: cannot be duplicated by this player (${copiesForPlayer}/${playerDupLimit.max} held)`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: already held by this player`));
            continue;
          }
        }

        // play-flag: "tapped-site-only" — card may only be played at an already-tapped site
        if (hasPlayFlag(eventDef, 'tapped-site-only') && !siteIsTapped) {
          logDetail(`Permanent event ${eventDef.name}: requires already-tapped site, but site is untapped`);
          actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: site must be tapped`));
          continue;
        }

        // play-flag: "untapped-site-required" — card may only be played at an untapped site
        if (hasPlayFlag(eventDef, 'untapped-site-required') && siteIsTapped) {
          logDetail(`Permanent event ${eventDef.name}: requires untapped site, but site is already tapped`);
          actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: site must be untapped`));
          continue;
        }

        // Check play-target site filter
        const sitePlayTarget = eventDef.effects?.find(
          (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
        );
        if (sitePlayTarget?.filter && siteDef) {
          // Augment the matched object with the site's own region type so a
          // filter can gate on it (e.g. Hidden Haven's "in a Wilderness,
          // Border-land, or Shadow-land"). The region type lives on a separate
          // region card, so it is not a field on the site definition itself.
          const regionType = siteRegionTypeOf(state, siteDef);
          // Expose the site's *effective* type (after any wizardhaven-conversion
          // / site-type-override) as `effectiveSiteType` so a filter can gate on
          // "your Wizardhaven [{H}]" and still match a haven the player converted
          // dynamically (Guarded Haven wh-74 on a Hidden Haven site). The raw
          // `siteType` field remains the printed type for filters that need it.
          const effectiveSiteType = siteDefId && isSiteCard(siteDef)
            ? getEffectiveSiteType(state, siteDefId, siteDef.siteType, siteInstanceId ?? undefined)
            : undefined;
          // Expose whether this site is the surface entrance of an Under-deeps
          // site so a filter can exclude it (Tempest of Fire ba-77: "the site
          // cannot be an Under-deeps site or surface site thereof").
          const isUnderDeepsSurface = isUnderDeepsSurfaceSite(state, siteDef);
          const matchTarget = { ...(siteDef as unknown as Record<string, unknown>), regionType, effectiveSiteType, isUnderDeepsSurface };
          if (!matchesCondition(sitePlayTarget.filter, matchTarget)) {
            logDetail(`Permanent event ${eventDef.name}: site filter excludes ${siteName}`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: site ${siteName} does not match play-target filter`));
            continue;
          }
        }

        // duplication-limit: scope "site" — only one copy per site (across all companies at this site)
        const siteDupLimit = findDuplicationLimitEffect(eventDef, 'site');
        if (siteDupLimit && siteDefId) {
          const copiesAtSite = countPermanentEventCopiesAtSite(state, eventDef.name, siteDefId);
          if (copiesAtSite >= siteDupLimit.max) {
            logDetail(`Permanent event ${eventDef.name}: site duplication limit reached at ${siteName}`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name} cannot be duplicated at ${siteName}`));
            continue;
          }
        }

        // play-condition: player-state — avatar/alignment/stage-point gate.
        // The Fortress of Isen/Towers (wh-68/wh-69): "Playable if you are Alatar,
        // Pallando, or Saruman."
        const playerStateCond = findPlayConditionEffect(eventDef, 'player-state');
        if (playerStateCond?.condition) {
          const ctx = buildPlayerStateContext(state, player, playerId);
          if (!matchesCondition(playerStateCond.condition, ctx)) {
            logDetail(`Permanent event ${eventDef.name}: player-state play-condition not satisfied`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: play condition not met`));
            continue;
          }
        }

        // play-condition: site-protected — the site must already be protected
        // for this player (carry an active `site-protected` constraint owned by
        // them, added by The Fortress of Isen/Towers wh-68/wh-69 or Guarded
        // Haven wh-74). Saruman's Machinery (wh-120): "Playable … on your
        // protected Isengard or your protected The White Towers."
        const siteProtectedCond = findPlayConditionEffect(eventDef, 'site-protected');
        if (siteProtectedCond) {
          const protectedForPlayer = isSiteProtectedForPlayer(state, siteDefId, playerId);
          if (!protectedForPlayer) {
            logDetail(`Permanent event ${eventDef.name}: site ${siteName} is not a protected site for ${playerId as string}`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: ${siteName} is not protected`));
            continue;
          }
        }

        // play-condition: card-not-in-play — card is not playable if the named
        // card is currently in play as a character or in any player's cardsInPlay.
        const cardNotInPlayCondition = findPlayConditionEffect(eventDef, 'card-not-in-play');
        if (cardNotInPlayCondition?.cardName) {
          const blockerName = cardNotInPlayCondition.cardName;
          const blockerInPlay = isCardNameInPlayOrCharacters(state, blockerName);
          if (blockerInPlay) {
            logDetail(`Permanent event ${eventDef.name}: blocked because ${blockerName} is in play`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: cannot be played while ${blockerName} is in play`));
            continue;
          }
        }

        // play-condition: card-attached-to-site — the permanent event is only
        // playable when a named card is in play attached to the active
        // company's current site. Lord and Usurper (ba-65): "Playable … on
        // Invade Their Domain" (which must already sit on the Dwarf-hold).
        const cardAtSiteCond = findPlayConditionEffect(eventDef, 'card-attached-to-site');
        if (cardAtSiteCond?.cardName) {
          const requiredName = cardAtSiteCond.cardName;
          const present = state.players.some(pl =>
            pl.cardsInPlay.some(c =>
              !c.pendingTriggerAttack
              && c.attachedToSite === siteDefId
              && defById(state, c.definitionId)?.name === requiredName),
          );
          if (!present) {
            logDetail(`Permanent event ${eventDef.name}: requires "${requiredName}" attached to ${siteName} — not in play there`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: requires ${requiredName} on ${siteName}`));
            continue;
          }
        }

        // play-condition: card-on-adjacent-under-deeps — the permanent event is
        // only playable when a named card is in play attached to an Under-deeps
        // site adjacent to the active company's current site. Invade Their
        // Domain (ba-64): "… if … Breach the Hold is on its adjacent Under-deeps
        // site" (The Drowning-deeps for the Blue Mountain Dwarf-hold, The
        // Rusted-deeps for the Iron Hill Dwarf-hold).
        const cardOnAdjUnderDeepsCond = findPlayConditionEffect(eventDef, 'card-on-adjacent-under-deeps');
        if (cardOnAdjUnderDeepsCond?.cardName) {
          const requiredName = cardOnAdjUnderDeepsCond.cardName;
          const present = state.players.some(pl =>
            pl.cardsInPlay.some(c => {
              if (c.pendingTriggerAttack) return false;
              if (defById(state, c.definitionId)?.name !== requiredName) return false;
              if (!c.attachedToSite) return false;
              const udDef = state.cardPool[c.attachedToSite] as
                { keywords?: readonly string[]; adjacentSites?: Readonly<Record<string, number>> } | undefined;
              if (!udDef || !(udDef.keywords ?? []).includes('under-deeps')) return false;
              return siteName !== undefined && udDef.adjacentSites?.[siteName] !== undefined;
            }),
          );
          if (!present) {
            logDetail(`Permanent event ${eventDef.name}: requires "${requiredName}" on the Under-deeps site adjacent to ${siteName} — not satisfied`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: requires ${requiredName} on the adjacent Under-deeps site`));
            continue;
          }
        }

        // Check play-target character filter.
        // When the card also has trigger-attack-on-play, bearer selection happens
        // post-attack (via a select-card-bearer pending resolution), so no
        // targetCharacterId is embedded in the play action. The character filter
        // is still validated here to ensure at least one eligible character exists,
        // but a single action (no per-character fan-out) is emitted.
        // When the card has no discard-named-card condition and no trigger-attack,
        // this is a direct attachment — emit one action per eligible character.
        // When a discard-named-card condition is also present, the character
        // filter is a gate only; action generation is deferred to the discard block.
        // play-condition: company-context — a generic DSL condition on the
        // active company (To Fealty Sworn ba-33). During the site phase the
        // `playedUniqueHeroFactionAtFreeHold` flag reflects whether this company
        // has already played a unique hero faction at a Free-hold (not Bag End)
        // this site phase, satisfying the "during the same site phase …"
        // alternative; the "in the same company as <named card>" alternative is
        // checked against the company's aggregate item names.
        const companyContextCond = findPlayConditionEffect(eventDef, 'company-context');
        if (companyContextCond?.condition
          && !matchesCompanyContextCondition(state, player, company, companyContextCond.condition, siteState.uniqueHeroFactionPlayedAtFreeHold ?? false, siteState.factionPlayedThisSitePhase ?? false)) {
          logDetail(`Permanent event ${eventDef.name}: company-context play-condition not satisfied at ${siteName}`);
          actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: play condition not met`));
          continue;
        }

        // play-target DSL: item-targeting permanent events (Barrow-blade
        // dm-119, "play this with the Dagger [of Westernesse]"). One action per
        // company-character item matching the filter, gated by an optional
        // `site-type` play-condition (Ruins & Lairs) and limited per item by a
        // `duplication-limit` scope "item". The card attaches to the item; its
        // stat-modifiers flow to the bearer (see collectCharacterEffects).
        const itemPlayTarget = eventDef.effects?.find(
          (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target' && e.target === 'item',
        );
        if (itemPlayTarget) {
          const siteTypeCond = findPlayConditionEffect(eventDef, 'site-type');
          if (siteTypeCond) {
            const companySiteType = siteDef && isSiteCard(siteDef) && siteDefId
              ? getEffectiveSiteType(state, siteDefId, siteDef.siteType, siteInstanceId ?? undefined)
              : undefined;
            if (!companySiteType || !siteTypeCond.siteTypes?.includes(companySiteType)) {
              logDetail(`Permanent event ${eventDef.name}: company not at required site type [${siteTypeCond.siteTypes?.join(', ') ?? '?'}] (actual: ${companySiteType ?? 'none'})`);
              actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: not at a ${siteTypeCond.siteTypes?.join('/') ?? 'valid'} site`));
              continue;
            }
          }
          const itemDupLimit = findDuplicationLimitEffect(eventDef, 'item');
          let anyItemTarget = false;
          // The play taps the bearer as a cost (tap-bearer-on-play), so only an
          // untapped bearer can pay it.
          const requiresUntappedBearer = hasPlayFlag(eventDef, 'tap-bearer-on-play');
          for (const charId of company.characters) {
            const ch = player.characters[charId];
            if (!ch) continue;
            if (requiresUntappedBearer && ch.status !== CardStatus.Untapped) continue;
            for (const item of ch.items) {
              const itemDef = defById(state, item.definitionId);
              if (!itemDef || !isItemCard(itemDef)) continue;
              if (itemPlayTarget.filter) {
                const ctx: Record<string, unknown> = {
                  target: {
                    name: itemDef.name,
                    keywords: (itemDef as { keywords?: readonly string[] }).keywords ?? [],
                    subtype: (itemDef as { subtype?: string }).subtype,
                  },
                };
                if (!matchesCondition(itemPlayTarget.filter, ctx)) continue;
              }
              if (itemDupLimit && countItemAttachedCopies(state, item.instanceId, eventDef.name) >= itemDupLimit.max) {
                logDetail(`Permanent event ${eventDef.name}: item duplication limit reached on ${itemDef.name} (${item.instanceId as string})`);
                continue;
              }
              anyItemTarget = true;
              logDetail(`Permanent event ${eventDef.name}: playable at ${siteName} on item ${itemDef.name} (${item.instanceId as string})`);
              actions.push({
                action: {
                  type: 'play-permanent-event', player: playerId, cardInstanceId,
                  targetItemInstanceId: item.instanceId,
                },
                viable: true,
              });
            }
          }
          if (!anyItemTarget) {
            logDetail(`Permanent event ${eventDef.name}: no eligible item target in company`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: no valid item target`));
          }
          continue;
        }

        const charPlayTarget = eventDef.effects?.find(
          (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
        );
        const hasTriggerAttack = eventDef.effects?.some(
          (e) => e.type === 'trigger-attack-on-play',
        ) ?? false;
        const hasDiscardCondition = eventDef.effects?.some(
          (e) => e.type === 'play-condition' && (e).requires === 'discard-named-card',
        ) ?? false;
        if (charPlayTarget) {
          // duplication-limit: scope "character" — the card may not be attached
          // to a character that already bears a copy (e.g. Swordmaster tw-498's
          // "Cannot be duplicated on a given character"). Enforced here for the
          // site-phase play path, mirroring organization-events.ts.
          const charDupLimit = findDuplicationLimitEffect(eventDef, 'character');
          const eligibleCharIds: import('../../index.js').CardInstanceId[] = [];
          for (const charId of company.characters) {
            const ch = player.characters[charId];
            if (!ch) continue;
            const charDef = defById(state, ch.definitionId);
            if (!charDef || !isCharacterCard(charDef)) continue;
            const itemNames = defNamesOf(state, ch.items);
            const ctx: Record<string, unknown> = {
              target: {
                race: charDef.race,
                skills: getEffectiveSkills(state, ch, charDef),
                status: ch.status,
                name: charDef.name,
                itemNames,
                isAvatar: isAvatarCharacter(charDef),
              },
              company: { covert: isCovertCompany(company, player, state) },
            };
            if (charPlayTarget.filter && !matchesCondition(charPlayTarget.filter, ctx)) continue;
            if (charDupLimit) {
              const copiesOnChar = ch.items.filter(item => {
                const iDef = defById(state, item.definitionId);
                return iDef && iDef.name === eventDef.name;
              }).length;
              if (copiesOnChar >= charDupLimit.max) {
                logDetail(`Permanent event ${eventDef.name}: character duplication limit reached on ${charDef.name}`);
                continue;
              }
            }
            eligibleCharIds.push(charId);
          }
          if (eligibleCharIds.length === 0) {
            logDetail(`Permanent event ${eventDef.name}: no eligible character in company`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: no eligible character in company`));
            continue;
          }
          // trigger-attack-on-play: bearer chosen post-attack — emit a single action
          // with no targetCharacterId; the select-card-bearer pending resolution handles
          // bearer assignment after the attack resolves.
          if (hasTriggerAttack && !hasDiscardCondition) {
            logDetail(`Permanent event ${eventDef.name}: playable at ${siteName} (bearer selected post-attack)`);
            actions.push({
              action: {
                type: 'play-permanent-event', player: playerId, cardInstanceId,
                ...(sitePlayTarget && siteDefId ? { targetSiteDefinitionId: siteDefId } : {}),
              },
              viable: true,
            });
            continue;
          }
          // No discard condition: emit one action per eligible character (attachment target)
          if (!hasDiscardCondition) {
            for (const charId of eligibleCharIds) {
              logDetail(`Permanent event ${eventDef.name}: playable at ${siteName} (character target ${charId as string})`);
              actions.push({
                action: {
                  type: 'play-permanent-event', player: playerId, cardInstanceId,
                  targetCharacterId: charId,
                  ...(sitePlayTarget && siteDefId ? { targetSiteDefinitionId: siteDefId } : {}),
                },
                viable: true,
              });
            }
            continue;
          }
          // Discard condition present: fall through to discard-named-card block below
        }

        // Check play-condition: discard-named-card
        const discardCondition = findPlayConditionEffect(eventDef, 'discard-named-card');
        const discardCandidates: { instanceId: import('../../index.js').CardInstanceId; source: string }[] = [];
        if (discardCondition && discardCondition.cardName) {
          const targetCardName = discardCondition.cardName;
          const sources = discardCondition.sources ?? ['character-items'];
          for (const source of sources) {
            if (source === 'character-items') {
              for (const charId of company.characters) {
                const ch = player.characters[charId];
                if (!ch) continue;
                for (const item of ch.items) {
                  const itemDef = defById(state, item.definitionId);
                  if (itemDef && itemDef.name === targetCardName) {
                    discardCandidates.push({ instanceId: item.instanceId, source: 'character-items' });
                  }
                }
              }
            } else if (source === 'kill-pile') {
              // Successfully stored items live in the marshalling point pile
              // (killPile) per CoE rule 2.II.4.1 — e.g. a Sapling of the White
              // Tree stored at Minas Tirith.
              for (const card of player.killPile) {
                const cardDef = defById(state, card.definitionId);
                if (cardDef && cardDef.name === targetCardName) {
                  discardCandidates.push({ instanceId: card.instanceId, source: 'kill-pile' });
                }
              }
            }
          }
          if (discardCandidates.length === 0) {
            logDetail(`Permanent event ${eventDef.name}: no ${targetCardName} available to discard`);
            actions.push(notPlayable(playerId, cardInstanceId, `${eventDef.name}: no ${targetCardName} available to discard`));
            continue;
          }
        }

        // Generate actions — cross-product of discard candidates (or single if none)
        if (discardCandidates.length > 0) {
          for (const dc of discardCandidates) {
            logDetail(`Permanent event ${eventDef.name}: playable (discard ${dc.instanceId as string} from ${dc.source})`);
            actions.push({
              action: {
                type: 'play-permanent-event', player: playerId, cardInstanceId,
                ...(sitePlayTarget && siteDefId ? { targetSiteDefinitionId: siteDefId } : {}),
                discardCardInstanceId: dc.instanceId,
              },
              viable: true,
            });
          }
        } else {
          logDetail(`Permanent event ${eventDef.name}: playable at ${siteName}`);
          actions.push({
            action: {
              type: 'play-permanent-event', player: playerId, cardInstanceId,
              ...(sitePlayTarget && siteDefId ? { targetSiteDefinitionId: siteDefId } : {}),
            },
            viable: true,
          });
        }
        continue;
      }
    }

    // Items — check site is untapped, allows the subtype, and there's an untapped character
    if (isItemCard(def)) {
      const itemDef = def as HeroItemCard;
      evaluatedInstances.add(cardInstanceId as string);

      // Eddy in Fate's Tide (ba-57): no ally or item may be played at any
      // version of the bound site until this company has tapped its two tax
      // characters this site phase.
      if (eddyTaxUnpaid) {
        logDetail(`Item ${itemDef.name}: Eddy in Fate's Tide — must tap ${eddyLock.taxTapCharacters} characters first (${eddyTaxTapped}/${eddyLock.taxTapCharacters})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name}: must tap two characters first (Eddy in Fate's Tide)`));
        continue;
      }

      // MEAS §6(f): at an Under-deeps site the "one extra minor item" allowance
      // (rule 2.V.5) is widened — the extra character may play any item the site
      // itself allows (minor, major, or gold ring), not only a minor item.
      const siteIsUnderDeeps = siteDef && isSiteCard(siteDef)
        && (siteDef.keywords ?? []).includes('under-deeps');

      // Rule 2.V.5: when a resource that tapped the site has already been
      // successfully played, the resource player may attempt one additional
      // minor item, even though the site is tapped and even if the site
      // does not normally list "minor" in its playable resources. At an
      // Under-deeps site this widens to any subtype the site lists as playable
      // (MEAS §6(f)).
      const minorItemBonus = siteState.minorItemAvailable && (
        siteIsUnderDeeps
          ? playableTypes.has(itemDef.subtype)
          : itemDef.subtype === 'minor'
      );

      // site-rule: allow-items-when-tapped — items remain playable even when the site is tapped
      const allowWhenTapped = siteDef && isSiteCard(siteDef)
        && (siteDef.effects ?? []).some(e => e.type === 'site-rule' && e.rule === 'allow-items-when-tapped');

      // Bounty of the Hoard: event sets hoardBountyAvailable, allowing one minor or major item
      // at a tapped hoard site.
      const siteIsHoard = siteDef && 'keywords' in siteDef
        ? ((siteDef as { keywords?: readonly string[] }).keywords ?? []).includes('hoard')
        : false;
      const hoardBountyBonus = siteState.hoardBountyAvailable && siteIsHoard
        && (itemDef.subtype === 'minor' || itemDef.subtype === 'major');

      // Thorough Search: event sets thoroughSearchAvailable, allowing one minor, major, or
      // gold ring item at the site (tapped or untapped) without tapping the site.
      const thoroughSearchBonus = siteState.thoroughSearchAvailable
        && (itemDef.subtype === 'minor' || itemDef.subtype === 'major' || itemDef.subtype === 'gold-ring');

      // item-play-site allowTapped: the item itself permits play at a
      // tapped site (e.g. Blasting Fire wh-51, Vile Fumes wh-54 — "tapped or
      // untapped Shadow-hold …"). The site-restriction below still gates
      // *which* tapped sites qualify.
      const itemSiteRestriction = itemDef.effects?.find(
        (e): e is ItemPlaySiteEffect => e.type === 'item-play-site',
      );
      const itemAllowsTapped = itemSiteRestriction?.allowTapped === true;

      // Saruman's Machinery (wh-120): while a `technology-item-unlocked`
      // constraint binds the active site for this player, one Technology-keyword
      // item may be played at the site this site phase "whether the site is
      // tapped or untapped". The unlock bypasses both the site-tap precondition
      // (below) and the item's own `item-play-site` restriction (which targets
      // Shadow/Dark-holds and so would never match a Wizardhaven). The
      // one-per-site-phase limit is tracked by `SitePhaseState.technologyItemPlayed`.
      const isTechnologyItem = (itemDef.keywords as readonly string[] | undefined)?.includes('Technology') === true;
      const technologyUnlockActive = isTechnologyItem
        && siteState.technologyItemPlayed !== true
        && siteHasTechnologyItemUnlock(state, siteDefId, playerId);
      if (technologyUnlockActive) {
        logDetail(`Item ${itemDef.name}: Technology item unlocked at ${siteName} (Saruman's Machinery) — tap state and site restriction bypassed`);
      }

      // Hermit's Hill (le-382): while a `gold-ring-item-unlocked` constraint
      // binds this company, a gold ring item is playable at the (untapped)
      // site "regardless of its text restrictions" — both the site's
      // `playableResources` gate and the ring's own `item-play-site`
      // restriction are bypassed. The site tapping on the ring's play limits
      // the unlock to one gold ring.
      const goldRingUnlockActive = goldRingItemUnlocked && itemDef.subtype === 'gold-ring';
      if (goldRingUnlockActive) {
        logDetail(`Item ${itemDef.name}: gold ring unlocked at ${siteName} (Hermit's Hill) — site restriction and playable-resources gate bypassed`);
      }

      if (siteIsTapped && !minorItemBonus && !allowWhenTapped && !hoardBountyBonus && !thoroughSearchBonus && !itemAllowsTapped && !technologyUnlockActive) {
        logDetail(`Item ${itemDef.name}: site is already tapped`);
        actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name}: site is already tapped`));
        continue;
      }

      const siteRestriction = technologyUnlockActive || goldRingUnlockActive ? undefined : itemSiteRestriction;
      if (siteRestriction) {
        const matchesSiteList = siteRestriction.sites
          ? siteRestriction.sites.includes(siteName)
          : false;
        // Augment the filter's site context with the normalized races of
        // the site's automatic-attacks, so a restriction can match e.g.
        // "a site with a Dwarf automatic-attack".
        const autoAttackRaces = siteDef && isSiteCard(siteDef)
          ? siteDef.automaticAttacks.map(a => normalizeCreatureRace(a.creatureType))
          : [];
        const matchesFilter = siteRestriction.filter
          ? matchesContext(siteRestriction.filter, { site: { ...siteDef, autoAttackRaces } })
          : false;
        // Either form satisfies; if both are absent the restriction is
        // empty and trivially fails (a malformed effect).
        const allowed = matchesSiteList || matchesFilter;
        // major-item-unlocked also allows hoard items (items with keyword "hoard"
        // that have an item-play-site restriction requiring a hoard site)
        const isHoardItem = (itemDef.keywords as readonly string[] | undefined)?.includes('hoard') === true;
        if (!allowed && !(majorItemUnlocked && isHoardItem)) {
          const reason = siteRestriction.sites
            ? `only playable at ${siteRestriction.sites.join(', ')}`
            : `${itemDef.name}: site does not satisfy play restriction`;
          logDetail(`Item ${itemDef.name}: site ${siteName} does not satisfy play restriction`);
          actions.push(notPlayable(playerId, cardInstanceId, siteRestriction.sites ? `${itemDef.name}: ${reason}` : reason));
          continue;
        }
      } else if (!playableTypes.has(itemDef.subtype) && !minorItemBonus && !technologyUnlockActive && !goldRingUnlockActive) {
        // major-item-unlocked allows major items (subtype "major") at the site
        if (majorItemUnlocked && itemDef.subtype === 'major') {
          logDetail(`Item ${itemDef.name} (major): allowed via major-item-unlocked constraint`);
        } else {
          logDetail(`Item ${itemDef.name} (${itemDef.subtype}): not playable at ${siteName}`);
          actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name}: ${itemDef.subtype} items cannot be played at ${siteName}`));
          continue;
        }
      }

      const siteEffects = siteDef && isSiteCard(siteDef) ? siteDef.effects : undefined;
      const denyRules = siteEffects?.filter(
        (e): e is DenyItemSiteRule =>
          e.type === 'site-rule' && e.rule === 'deny-item',
      ) ?? [];
      const denied = denyRules.some(rule =>
        matchesDefinition(itemDef, rule.when),
      );
      if (denied) {
        logDetail(`Item ${itemDef.name} (${itemDef.subtype}): denied at ${siteName} by site-rule deny-item`);
        actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name} cannot be played at ${siteName}`));
        continue;
      }

      if (untappedCharacters.length === 0) {
        logDetail(`Item ${itemDef.name}: no untapped character to carry it`);
        actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name}: no untapped character in company`));
        continue;
      }

      // Check uniqueness — only one copy of a unique item can be in play
      if (itemDef.unique) {
        const alreadyInPlay = state.players.some(p =>
          Object.values(p.characters).some(ch =>
            ch.items.some(item => {
              const iDef = defById(state, item.definitionId);
              return iDef && iDef.name === itemDef.name;
            }),
          ),
        );
        if (alreadyInPlay) {
          logDetail(`Item ${itemDef.name}: unique and already in play`);
          actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name} is unique and already in play`));
          continue;
        }
      }

      // Check character-scoped duplication limit
      const charDupLimit = findDuplicationLimitEffect(itemDef, 'character');

      // Bearer filter (play-target with target: 'character'): restricts
      // which characters may bear the item — e.g. Wizard's Staff's
      // "Only a Wizard may bear this item" is expressed as
      // `{ type: "play-target", target: "character", filter: { "target.race": "wizard" } }`.
      const bearerPlayTarget = itemDef.effects?.find(
        (e): e is import('../../index.js').PlayTargetEffect =>
          e.type === 'play-target' && e.target === 'character',
      );

      // Company-scope duplication limit: count copies of this item already
      // borne by any character in the active company. Backs "Cannot be
      // duplicated in a given company" (e.g. Records Unread as-130).
      const itemCompanyDupLimit = findDuplicationLimitEffect(itemDef, 'company');
      if (itemCompanyDupLimit) {
        const copiesInCompany = countAttachedInCompany(state, player, company, itemDef.name, 'items');
        if (copiesInCompany >= itemCompanyDupLimit.max) {
          logDetail(`Item ${itemDef.name}: company duplication limit reached (${copiesInCompany}/${itemCompanyDupLimit.max})`);
          actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name}: cannot be duplicated in a given company`));
          continue;
        }
      }

      // One action per untapped character that could carry the item
      for (const ch of untappedCharacters) {
        const charDef = defById(state, ch.definitionId);
        const charName = charDef?.name ?? ch.instanceId;

        if (bearerPlayTarget?.filter) {
          if (!charDef || !isCharacterCard(charDef)) {
            continue;
          }
          const bearerCtx: Record<string, unknown> = {
            target: {
              race: charDef.race,
              skills: getEffectiveSkills(state, ch, charDef),
              status: ch.status,
              name: charDef.name,
            },
          };
          if (!matchesCondition(bearerPlayTarget.filter, bearerCtx)) {
            logDetail(`Item ${itemDef.name}: ${charName} fails bearer filter`);
            continue;
          }
        }

        // Check character-scoped duplication: count copies of this item already on the character
        if (charDupLimit) {
          const copiesOnChar = ch.items.filter(item => {
            const iDef = defById(state, item.definitionId);
            return iDef && iDef.name === itemDef.name;
          }).length;
          if (copiesOnChar >= charDupLimit.max) {
            logDetail(`Item ${itemDef.name}: cannot be duplicated on ${charName} (${copiesOnChar}/${charDupLimit.max})`);
            actions.push(notPlayable(playerId, cardInstanceId, `${itemDef.name}: cannot be duplicated on ${charName}`));
            continue;
          }
        }

        logDetail(`Item ${itemDef.name}: playable on ${charName}`);
        actions.push({
          action: {
            type: 'play-hero-resource',
            player: playerId,
            cardInstanceId,
            companyId: company.id,
            attachToCharacterId: ch.instanceId,
          },
          viable: true,
        });
      }
      continue;
    }

    // Allies — check site is untapped, ally is playable at this site, and there's an untapped character
    if (isAllyCard(def)) {
      const allyDef = def;
      evaluatedInstances.add(cardInstanceId as string);

      // Eddy in Fate's Tide (ba-57): tax gate — see the item branch above.
      if (eddyTaxUnpaid) {
        logDetail(`Ally ${allyDef.name}: Eddy in Fate's Tide — must tap ${eddyLock.taxTapCharacters} characters first (${eddyTaxTapped}/${eddyLock.taxTapCharacters})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: must tap two characters first (Eddy in Fate's Tide)`));
        continue;
      }

      // A play-target effect with target "site" defines where the ally can be played via a filter
      // (e.g. Noble Hound: "any tapped or untapped Border-hold"). When requireTapped is false,
      // the ally may be played at both tapped and untapped sites, overriding the default
      // untapped-only restriction.
      const sitePlayTarget = allyDef.effects?.find(
        (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
      );

      // Check ally is playable at this site via playableAt entries or a play-target site filter
      const siteDefForAlly = siteDef && isSiteCard(siteDef) ? siteDef : undefined;
      const allyEffSiteType = siteDefForAlly && siteDefId
        ? getEffectiveSiteType(state, siteDefId, siteDefForAlly.siteType, siteInstanceId ?? undefined)
        : siteDefForAlly?.siteType;
      // `nothingPlayableAsWritten` (Hidden Haven) does NOT gate allies: an ally's
      // playability is written on the ally card naming the site, not on the site
      // card's printed resource list — so it survives the conversion.
      const matchesPlayableAt = siteDefForAlly !== undefined && allyDef.playableAt.some(entry => siteMatchesEntry(siteDefForAlly, entry, allyEffSiteType, siteRegionTypeOf(state, siteDefForAlly), isUnderDeepsSurfaceSite(state, siteDefForAlly)));
      const matchesPlayTarget = siteDefForAlly !== undefined && sitePlayTarget !== undefined
        && (!sitePlayTarget.filter || matchesDefinition(siteDefForAlly, sitePlayTarget.filter));
      // Glove of Radagast (wh-111): a `grant-ally-play` permission on a company
      // member makes any matching non-unique 1-mind ally playable at the
      // company's current site, bypassing the ally's printed `playableAt`.
      const grantedByAllyPlay = siteDefForAlly !== undefined
        && allyPlayGrantAllowsAlly(state, player, company, allyDef);
      if (grantedByAllyPlay && !matchesPlayableAt && !matchesPlayTarget) {
        logDetail(`Ally ${allyDef.name}: playability granted at ${siteName} by grant-ally-play (Glove of Radagast)`);
      }

      // An Untimely Brood (wh-62): a player-scoped `grant-ally-play` with
      // `atProtectedWizardhavens` makes any matching non-unique 1-mind ally
      // playable at one of the player's own protected Wizardhavens — tapped or
      // untapped — once per site phase.
      const wizGrant = findWizardhavenAllyPlayGrant(state, player);
      const siteIsProtectedWizardhaven = siteDefForAlly !== undefined
        && siteIsProtectedByPlayer(state, siteDefId, playerId)
        && isHavenForPlayer(siteDefForAlly, player.alignment, { state, siteDefinitionId: siteDefId, playerId });
      const grantedByWizardhaven = wizGrant !== undefined
        && siteIsProtectedWizardhaven
        && (!wizGrant.effect.filter || matchesCondition(wizGrant.effect.filter, { target: allyDef as unknown as Record<string, unknown> }));

      // The tapped-site block: an ally normally requires an untapped site. It is
      // lifted by the ally's own `playable-at-tapped-site` flag / play-target
      // `requireTapped: false`, or by the wh-62 Wizardhaven grant's
      // `allowTappedSite`.
      const allyAllowsTappedSite = hasPlayFlag(allyDef, 'playable-at-tapped-site')
        || sitePlayTarget?.requireTapped === false
        || (grantedByWizardhaven && wizGrant.effect.allowTappedSite === true);
      if (siteIsTapped && !allyAllowsTappedSite) {
        logDetail(`Ally ${allyDef.name}: site is already tapped`);
        actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: site is already tapped`));
        continue;
      }

      // Would the ally be playable here on its own (printed playability, and —
      // when the site is tapped — a tapped-site allowance of its own)? Used to
      // decide whether a play actually *consumes* the wh-62 grant.
      const normallyPlayableHere = (matchesPlayableAt || matchesPlayTarget)
        && (!siteIsTapped || hasPlayFlag(allyDef, 'playable-at-tapped-site') || sitePlayTarget?.requireTapped === false);
      const usesWizardhavenGrant = grantedByWizardhaven && !normallyPlayableHere && !grantedByAllyPlay;
      if (grantedByWizardhaven && !matchesPlayableAt && !matchesPlayTarget && !grantedByAllyPlay) {
        logDetail(`Ally ${allyDef.name}: playability granted at ${siteName} by grant-ally-play (An Untimely Brood, protected Wizardhaven)`);
      }

      if (!siteDefForAlly || (!matchesPlayableAt && !matchesPlayTarget && !grantedByAllyPlay && !grantedByWizardhaven)) {
        const allowedSites = allyDef.playableAt.map(e => 'region' in e ? `region:${e.region}` : 'any' in e ? 'any-qualifying-site' : 'site' in e ? e.site : e.siteType).join(', ');
        logDetail(`Ally ${allyDef.name}: not playable at ${siteName} (requires ${allowedSites})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: not playable at ${siteName}`));
        continue;
      }

      // wh-62 once-per-site-phase: if this ally can only be played through the
      // Wizardhaven grant and that grant has already been used this phase, it is
      // no longer playable.
      if (usesWizardhavenGrant && wizGrant.effect.oncePerSitePhase
          && grantedActionUsedThisTurn(state, wizGrant.sourceId, 'grant-ally-play')) {
        logDetail(`Ally ${allyDef.name}: An Untimely Brood's Wizardhaven ally already played this site phase`);
        actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: only one ally may be played at a Wizardhaven this site phase (An Untimely Brood)`));
        continue;
      }

      // Rule g.man.1: a manifestation may not be played while another
      // manifestation of the same entity is in play (either player) — e.g. the
      // ally Mistress Lobelia (dm-178) while the agent Lobelia (dm-28) is in play.
      const blockingManifestation = manifestationOfEntityInPlay(state, allyDef);
      if (blockingManifestation) {
        logDetail(`Ally ${allyDef.name}: blocked — manifestation "${blockingManifestation}" already in play`);
        actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: a manifestation (${blockingManifestation}) is already in play`));
        continue;
      }

      // Check uniqueness — only one copy of a unique ally can be in play
      if (allyDef.unique) {
        const alreadyInPlay = state.players.some(p =>
          Object.values(p.characters).some(ch =>
            ch.allies.some(a => {
              const aDef = defById(state, a.definitionId);
              return aDef && aDef.name === allyDef.name;
            }),
          ),
        );
        if (alreadyInPlay) {
          logDetail(`Ally ${allyDef.name}: unique and already in play`);
          actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name} is unique and already in play`));
          continue;
        }
      }

      // Company-scope duplication limit: count copies of this ally already in the company.
      const allyCompanyDupLimit = findDuplicationLimitEffect(allyDef, 'company');
      if (allyCompanyDupLimit) {
        const copiesInCompany = countAttachedInCompany(state, player, company, allyDef.name, 'allies');
        if (copiesInCompany >= allyCompanyDupLimit.max) {
          logDetail(`Ally ${allyDef.name}: company duplication limit reached (${copiesInCompany}/${allyCompanyDupLimit.max})`);
          actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: cannot be duplicated in a given company`));
          continue;
        }
      }

      // Fell Rider (block-company-joins): while a mode card with this flag is
      // bound to the company, no ally may join it.
      if (companyBlocksJoins(state, company.id)) {
        logDetail(`Ally ${allyDef.name}: company is closed to new joins (block-company-joins)`);
        actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: no ally may join this company`));
        continue;
      }

      // Flame of Udûn (no-allies-in-company): while a member bears this flag,
      // no ally may be played to the company (its Balrog fights solo).
      if (companyHasNoAllyRestriction(state, player, company)) {
        logDetail(`Ally ${allyDef.name}: no ally may be in this company (no-allies-in-company)`);
        actions.push(notPlayable(playerId, cardInstanceId, `${allyDef.name}: no ally may be in this company`));
        continue;
      }

      // Determine which characters may control this ally.
      //  - A wizard-specific ally (e.g. Radagast's Black Bird wh-114,
      //    `radagast-specific`) may only be controlled by the matching
      //    Fallen-wizard avatar.
      //  - An ally that taps neither controller nor site on play
      //    (`no-tap-on-play`) may be played by a tapped controller too — it
      //    never needs to tap ("need not tap himself"); otherwise the
      //    controlling character must be untapped as usual.
      const allyNoTapOnPlay = hasPlayFlag(allyDef, 'no-tap-on-play');
      const requiredController = wizardSpecificName(allyDef);
      const controllerPool = allyNoTapOnPlay
        ? company.characters
            .map(cId => player.characters[cId])
            .filter((ch): ch is NonNullable<typeof ch> => ch !== undefined)
        : untappedCharacters;
      const controllerCandidates = controllerPool.filter(ch => {
        if (requiredController === null) return true;
        const cd = defById(state, ch.definitionId);
        return isCharacterCard(cd) && cd.name === requiredController;
      });

      if (controllerCandidates.length === 0) {
        const reason = requiredController !== null
          ? `${allyDef.name}: only ${requiredController} may control it`
          : `${allyDef.name}: no untapped character in company`;
        logDetail(`Ally ${allyDef.name}: no eligible controlling character (${reason})`);
        actions.push(notPlayable(playerId, cardInstanceId, reason));
        continue;
      }

      // One action per eligible character that could control the ally
      for (const ch of controllerCandidates) {
        const charDef = defById(state, ch.definitionId);
        const charName = charDef?.name ?? ch.instanceId;
        logDetail(`Ally ${allyDef.name}: playable under ${charName}`);
        actions.push({
          action: {
            type: 'play-hero-resource',
            player: playerId,
            cardInstanceId,
            companyId: company.id,
            attachToCharacterId: ch.instanceId,
            // wh-62: mark the play as consuming the Wizardhaven grant so the
            // reducer records its once-per-site-phase lock.
            ...(usesWizardhavenGrant ? { viaWizardhavenAllyGrant: wizGrant.sourceId } : {}),
          },
          viable: true,
        });
      }
      continue;
    }

    // Factions — check site is untapped, faction is playable at this site, and there's an untapped character
    if (isFactionCard(def)) {
      const factionDef: FactionCard = def;
      evaluatedInstances.add(cardInstanceId as string);

      // Most factions require an untapped site (the influence attempt taps it).
      // Snaga-hai (le-286) is "playable at any tapped or untapped Shadow-hold"
      // and carries the `playable-at-tapped-site` flag to override this rule.
      if (siteIsTapped && !hasPlayFlag(factionDef, 'playable-at-tapped-site')) {
        logDetail(`Faction ${factionDef.name}: site is already tapped`);
        actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: site is already tapped`));
        continue;
      }

      // Check faction is playable at this site. `nothingPlayableAsWritten`
      // (Hidden Haven) does NOT gate factions: a faction's playability is written
      // on the faction card naming the site (CoE 2.V.3), not on the site card's
      // printed resource list — so it survives the conversion to a Wizardhaven.
      const siteDefForFaction = siteDef && isSiteCard(siteDef) ? siteDef : undefined;
      const factionEffSiteType = siteDefForFaction && siteDefId
        ? getEffectiveSiteType(state, siteDefId, siteDefForFaction.siteType, siteInstanceId ?? undefined)
        : siteDefForFaction?.siteType;
      const factionRegionType = siteRegionTypeOf(state, siteDefForFaction);
      const factionSiteIsUnderDeepsSurface = isUnderDeepsSurfaceSite(state, siteDefForFaction);
      if (!siteDefForFaction || !factionDef.playableAt.some(entry => siteMatchesEntry(siteDefForFaction, entry, factionEffSiteType, factionRegionType, factionSiteIsUnderDeepsSurface))) {
        const allowedSites = factionDef.playableAt.map(e => 'region' in e ? `region:${e.region}` : 'any' in e ? 'any-qualifying-site' : 'site' in e ? e.site : e.siteType).join(', ');
        logDetail(`Faction ${factionDef.name}: not playable at ${siteName} (requires ${allowedSites})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: not playable at ${siteName}`));
        continue;
      }

      // site-instance-transform with `noFactions` (Lord and Usurper ba-65): no
      // faction may be played at any version of the transformed site.
      const factionSiteTransform = siteDefId
        ? resolveSiteInstanceTransform(state, siteDefId, siteInstanceId ?? undefined)
        : undefined;
      if (factionSiteTransform?.effect.noFactions) {
        logDetail(`Faction ${factionDef.name}: ${siteName} forbids faction plays (site-instance-transform noFactions)`);
        actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: no factions may be played at ${siteName}`));
        continue;
      }

      // agent-home-site-faction-lock (Faithless Steward as-83): an unwounded
      // agent standing at one of his Border-/Free-hold home sites bars every
      // faction play at any version of that site (matched by printed name).
      if (siteFactionLockedByAgentHomeSite(state, siteName)) {
        logDetail(`Faction ${factionDef.name}: ${siteName} forbids faction plays (Faithless Steward agent lock)`);
        actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: no factions may be played at ${siteName}`));
        continue;
      }

      // play-condition: card-in-play — the faction is only playable while a
      // named card is in YOUR play area. Half-orcs (wh-87) / Greater Half-orcs
      // (wh-86) require "A Strident Spawn" (and Half-orcs) in play. Checked
      // against the controller's own in-play names so an opponent's copy of the
      // named card does not satisfy the gate.
      const factionCardInPlay = findPlayConditionEffect(factionDef, 'card-in-play');
      if (factionCardInPlay?.cardName) {
        const controllerInPlay = buildControllerInPlayNames(state, playerId);
        if (!controllerInPlay.includes(factionCardInPlay.cardName)) {
          logDetail(`Faction ${factionDef.name}: requires "${factionCardInPlay.cardName}" in your play area — not playable`);
          actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: requires ${factionCardInPlay.cardName} in play`));
          continue;
        }
      }

      // play-condition: site-protected — the faction is only playable at a
      // Wizardhaven the controller has protected (Half-orcs wh-87 / Greater
      // Half-orcs wh-86: "Playable at one of your protected Wizardhavens").
      const factionSiteProtected = findPlayConditionEffect(factionDef, 'site-protected');
      if (factionSiteProtected && !siteIsProtectedByPlayer(state, siteDefId, playerId)) {
        logDetail(`Faction ${factionDef.name}: ${siteName} is not a protected Wizardhaven you control — not playable`);
        actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: ${siteName} is not one of your protected Wizardhavens`));
        continue;
      }

      // Check uniqueness — only one copy of a *unique* faction can be in play.
      // Non-unique factions (e.g. Snaga-hai, le-286) may have multiple copies
      // in play, so the duplicate check only applies when the faction is unique.
      const alreadyInPlay = factionDef.unique && countCopiesInPlay(state, factionDef.name) > 0;
      if (alreadyInPlay) {
        logDetail(`Faction ${factionDef.name}: unique and already in play`);
        actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name} is unique and already in play`));
        continue;
      }

      // Manifestation uniqueness (g.man.1): a Dragons "Roused" faction is one
      // form of a unique Dragon; block it while any other manifestation of the
      // same chain (its basic creature/agent, Ahunt long-event, At-Home
      // permanent-event, or another Roused faction) is already in play on
      // either side. Only manifestId-tagged factions are affected.
      if (manifestIdOf(factionDef) !== undefined) {
        const manifestBlock = manifestationOfEntityInPlay(state, factionDef) ?? manifestationInCardsInPlay(state, factionDef);
        if (manifestBlock) {
          logDetail(`Faction ${factionDef.name}: blocked — manifestation "${manifestBlock}" already in play`);
          actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: a manifestation (${manifestBlock}) is already in play`));
          continue;
        }
      }

      // Influencers: untapped characters, plus untapped allies flagged
      // `influences-factions` ("may attempt to influence factions as if he
      // were a character" — Radagast's Black Bird wh-114).
      const influencerAllies = company.characters
        .flatMap(cId => player.characters[cId]?.allies ?? [])
        .filter(a => {
          if (a.status !== CardStatus.Untapped) return false;
          const aDef = defById(state, a.definitionId);
          return isAllyCard(aDef) && hasPlayFlag(aDef, 'influences-factions');
        });
      const factionInfluencers = [
        ...untappedCharacters.map(c => ({ instanceId: c.instanceId, definitionId: c.definitionId, status: c.status })),
        ...influencerAllies.map(a => ({ instanceId: a.instanceId, definitionId: a.definitionId, status: a.status })),
      ];

      if (factionInfluencers.length === 0) {
        logDetail(`Faction ${factionDef.name}: no untapped influencer to attempt influence`);
        actions.push(notPlayable(playerId, cardInstanceId, `${factionDef.name}: no untapped character in company`));
        continue;
      }

      // One action per influencer (character or influencing ally)
      for (const ch of factionInfluencers) {
        const charDef = defById(state, ch.definitionId);
        const charName = charDef?.name ?? ch.instanceId;

        // Compute modifier for this influencer
        let infModifier = 0;
        // Red Arrow (tw-312): auto-influence grant → no check needed for this faction.
        let autoInf = false;
        const infParts: string[] = [`influence # ${factionDef.influenceNumber}`];
        const fullCharacter = player.characters[ch.instanceId];
        if (fullCharacter && charDef && isCharacterCard(charDef)) {
          // Use free DI (total DI minus mind cost of followers), not the raw card stat
          const freeDI = availableDI(state, ch.instanceId, player);
          infModifier += freeDI;
          infParts.push(`DI ${freeDI}`);

          // DSL effects
          const resolverCtx: ResolverContext = {
            reason: 'faction-influence-check',
            bearer: {
              race: charDef.race, skills: getEffectiveSkills(state, fullCharacter, charDef),
              baseProwess: charDef.prowess, baseBody: charDef.body,
              baseDirectInfluence: charDef.directInfluence, name: charDef.name,
              // Character subgrouping keywords (e.g. "leader"), so a faction's
              // printed modification can target the influencing character by
              // keyword — A Few Recruits (ba-80): "leader (+2)".
              keywords: (charDef as { keywords?: readonly string[] }).keywords ?? [],
            },
            faction: {
              name: factionDef.name,
              race: factionDef.race,
              playableAt: buildFactionPlayableAt(factionDef),
              playableRegions: buildFactionPlayableRegions(state, factionDef),
            },
            controller: {
              inPlay: buildControllerInPlayNames(state, playerId),
              factionRaces: buildControllerFactionRaces(state, playerId),
              wizard: playerWizardName(state, player),
            },
          };
          const charEffects = collectCharacterEffects(state, fullCharacter, resolverCtx);
          charEffects.push(...collectCompanyAllyEffects(state, fullCharacter, resolverCtx));
          // Player-scoped ongoing influence bonuses from bare in-play
          // permanent-events (Great Army of the North ba-38).
          charEffects.push(...collectPlayerInPlayInfluenceEffects(state, playerId, resolverCtx));
          if (factionDef.effects) {
            for (const effect of factionDef.effects) {
              if (effect.when && !matchesContext(effect.when, resolverCtx)) continue;
              charEffects.push({ effect, sourceDef: factionDef, sourceInstance: cardInstanceId });
            }
          }
          const dslMod = resolveCheckModifier(charEffects, 'influence');
          if (dslMod !== 0) {
            infModifier += dslMod;
            infParts.push(`check bonus ${formatSignedNumber(dslMod)}`);
          }

          // Resolve stat-modifier effects on direct-influence (e.g. Glorfindel +1 DI vs elf factions)
          const dslDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
          if (dslDI !== 0) {
            infModifier += dslDI;
            infParts.push(`DI bonus ${formatSignedNumber(dslDI)}`);
          }

          // Auto-influence grant (Red Arrow tw-312): no 2d6 check for this faction.
          autoInf = resolveAutoInfluenceFaction(charEffects, factionDef.name);
          if (autoInf) {
            infParts.push('automatic');
          }

          // Faction-influence-restriction environment (e.g. Mordor in Arms
          // dm-72): penalise influence at sites in named regions and suppress
          // specific card boosts ("cannot be done with Muster"). No effect on a
          // minion (Ringwraith) influencer when so flagged.
          const influencerIsMinion = player.alignment === 'ringwraith';
          const { modifier: restrictionMod, blockedCardNames: blockedBoosts } =
            collectFactionInfluenceRestriction(state, siteDefForFaction.region, influencerIsMinion);
          if (restrictionMod !== 0) {
            infModifier += restrictionMod;
            infParts.push(`region restriction ${formatSignedNumber(restrictionMod)}`);
          }

          // One-shot check-modifier constraints for influence (e.g. Muster)
          for (const constraint of state.activeConstraints) {
            if (constraint.kind.type !== 'check-modifier') continue;
            if (constraint.kind.check !== 'influence') continue;
            if (constraint.target.kind !== 'character') continue;
            if (constraint.target.characterId !== ch.instanceId) continue;
            const boostSourceName = (defById(state, constraint.sourceDefinitionId) as { name?: string } | undefined)?.name;
            if (boostSourceName && blockedBoosts.has(boostSourceName)) continue; // suppressed
            infModifier += constraint.kind.value;
            infParts.push(`constraint bonus ${formatSignedNumber(constraint.kind.value)}`);
          }

          // Player-scoped influence check-modifier (Terror Heralds Doom ba-78:
          // "+2 to all influence attempts this turn by any of your characters").
          // Applies to every influence check by any character of the targeted
          // player; not consumed.
          for (const constraint of state.activeConstraints) {
            if (constraint.kind.type !== 'check-modifier') continue;
            if (constraint.kind.check !== 'influence') continue;
            if (constraint.target.kind !== 'player') continue;
            if (constraint.target.playerId !== playerId) continue;
            infModifier += constraint.kind.value;
            infParts.push(`player-wide bonus ${formatSignedNumber(constraint.kind.value)}`);
          }

          // Site-wide influence modifiers (Blasting Fire wh-51): every
          // influence attempt against a faction at the company's current
          // site is modified for the rest of the turn.
          const currentSiteDefId = company.currentSite?.definitionId;
          if (currentSiteDefId) {
            for (const constraint of state.activeConstraints) {
              if (constraint.kind.type !== 'influence-at-site-modifier') continue;
              if (constraint.kind.siteDefinitionId !== currentSiteDefId) continue;
              infModifier += constraint.kind.value;
              infParts.push(`site influence bonus ${formatSignedNumber(constraint.kind.value)}`);
            }
            // People Diminished (ba-72): a bound `site-lock` card applies its
            // `factionInfluenceModifier` (-5) to every faction-influence attempt
            // at any version of this site, for either player.
            const siteLockMod = siteFactionInfluenceModifier(state, currentSiteDefId);
            if (siteLockMod !== 0) {
              infModifier += siteLockMod;
              infParts.push(`site lock ${formatSignedNumber(siteLockMod)}`);
            }
          }
        } else if (charDef && isAllyCard(charDef)) {
          // Ally influencing "as if a character" (Radagast's Black Bird wh-114):
          // its printed direct influence, plus the player-/site-scoped influence
          // modifiers that apply to any influencer (not per-character DSL bonuses,
          // which an ally does not carry).
          const allyDI = charDef.directInfluence ?? 0;
          infModifier += allyDI;
          infParts.push(`DI ${allyDI}`);

          for (const constraint of state.activeConstraints) {
            if (constraint.kind.type !== 'check-modifier') continue;
            if (constraint.kind.check !== 'influence') continue;
            if (constraint.target.kind !== 'player') continue;
            if (constraint.target.playerId !== playerId) continue;
            infModifier += constraint.kind.value;
            infParts.push(`player-wide bonus ${formatSignedNumber(constraint.kind.value)}`);
          }

          const allySiteDefId = company.currentSite?.definitionId;
          if (allySiteDefId) {
            for (const constraint of state.activeConstraints) {
              if (constraint.kind.type !== 'influence-at-site-modifier') continue;
              if (constraint.kind.siteDefinitionId !== allySiteDefId) continue;
              infModifier += constraint.kind.value;
              infParts.push(`site influence bonus ${formatSignedNumber(constraint.kind.value)}`);
            }
            const siteLockMod = siteFactionInfluenceModifier(state, allySiteDefId);
            if (siteLockMod !== 0) {
              infModifier += siteLockMod;
              infParts.push(`site lock ${formatSignedNumber(siteLockMod)}`);
            }
          }
        }

        // Game-wide ongoing influence modifier from a bare in-play event owned
        // by either player (Times Are Evil td-76: "All … influence attempts are
        // modified by -3"). Applies to every influence attempt.
        const globalInfMod = collectGlobalCheckModifier(state, 'influence', { reason: 'faction-influence-check' });
        if (globalInfMod !== 0) {
          infModifier += globalInfMod;
          infParts.push(`game-wide ${formatSignedNumber(globalInfMod)}`);
        }

        const infNeed = autoInf ? 0 : factionDef.influenceNumber - infModifier;

        logDetail(`Faction ${factionDef.name}: influenceable by ${charName} (${autoInf ? 'automatic' : `need ${infNeed}`})`);
        actions.push({
          action: {
            type: 'influence-attempt',
            player: playerId,
            factionInstanceId: cardInstanceId,
            influencingCharacterId: ch.instanceId,
            need: infNeed,
            explanation: autoInf
              ? `Automatic influence (${infParts.join(', ')})`
              : `Need roll >= ${infNeed} (${infParts.join(', ')})`,
          },
          viable: true,
        });

        // Dragons "Roused" factions (Smaug Roused le-285): "Modifications:
        // influencer discards a major item (+3) or a greater item (+6)." Offer
        // one extra influence-attempt per eligible carried item — the influencer
        // may pay the discard to lower the (very high) need.
        const infMod = factionDef.effects?.find(
          (e): e is Extract<CardEffect, { type: 'influence-modification' }> => e.type === 'influence-modification',
        );
        if (infMod) {
          const influencerItems = player.characters[ch.instanceId]?.items ?? [];
          for (const option of infMod.options) {
            for (const item of influencerItems) {
              const itemDef = defById(state, item.definitionId);
              if ((itemDef as { subtype?: string } | undefined)?.subtype !== option.discardItemSubtype) continue;
              const itemName = itemDef?.name ?? (item.definitionId as string);
              const bonusNeed = infNeed - option.value;
              logDetail(`Faction ${factionDef.name}: ${charName} may discard ${option.discardItemSubtype} item "${itemName}" for ${formatSignedNumber(option.value)} (need ${bonusNeed})`);
              actions.push({
                action: {
                  type: 'influence-attempt',
                  player: playerId,
                  factionInstanceId: cardInstanceId,
                  influencingCharacterId: ch.instanceId,
                  need: bonusNeed,
                  explanation: `Need roll >= ${bonusNeed} — discard ${option.discardItemSubtype} item "${itemName}" for ${formatSignedNumber(option.value)} (${infParts.join(', ')})`,
                  discardForBonus: { itemInstanceId: item.instanceId, value: option.value },
                },
                viable: true,
              });
            }
          }
        }

        // LE "Orcs of Udûn"-style factions: an eligible Orc/Troll leader may
        // additionally choose to take the faction under their control on
        // success (leaving the site untapped). Offer this as a separate
        // variant so the player decides ("you may").
        if (getLeaderControlEffect(factionDef) && charDef && isCharacterCard(charDef) && leaderControlEligibility(factionDef, charDef)) {
          logDetail(`Faction ${factionDef.name}: ${charName} may take it under leader control (site not tapped)`);
          actions.push({
            action: {
              type: 'influence-attempt',
              player: playerId,
              factionInstanceId: cardInstanceId,
              influencingCharacterId: ch.instanceId,
              need: infNeed,
              explanation: `Need roll >= ${infNeed} — place under ${charName}'s control, site not tapped (${infParts.join(', ')})`,
              placeUnderLeaderControl: true,
            },
            viable: true,
          });
        }
      }
      continue;
    }

    // TODO: information
  }

  // Glove of Radagast (wh-111): a `grant-ally-play` permission with
  // `fromDiscard` lets a granted ally be played from the discard pile as well
  // as the hand. The hand-source case is handled by the loop above (the ally's
  // site-match is relaxed via `grantedByAllyPlay`); here we source the same
  // matching allies from the discard pile. All the normal ally gates apply
  // (untapped site, company open to joins, an untapped controller, manifestation
  // blocks, company duplication limits, MEWH §10 cross-alignment, Eddy tax).
  const allyPlayGrant = findAllyPlayGrant(state, player, company);
  if (allyPlayGrant?.effect.fromDiscard
      && !companyBlocksJoins(state, company.id)
      && !companyHasNoAllyRestriction(state, player, company)
      && untappedCharacters.length > 0) {
    for (const discardCard of player.discardPile) {
      const allyDef = defById(state, discardCard.definitionId);
      if (!allyDef || !isAllyCard(allyDef)) continue;
      if (!allyPlayGrantAllowsAlly(state, player, company, allyDef)) continue;

      // MEWH §10 cross-alignment site-tap (mirrors the hand loop). A Double-dealing
      // unlock lifts it at the played-on site.
      if (player.alignment === 'fallen-wizard' && siteTapCrossAlignmentBlocked(allyDef, siteDef)) {
        const crossUnlocked = hasSiteFlagForPlayer(
          state.activeConstraints, 'cross-alignment-resources-unlocked', siteDefId, playerId,
        );
        if (!crossUnlocked) {
          logDetail(`Discard ally ${allyDef.name}: barred — cross-alignment site-tap (MEWH §10)`);
          continue;
        }
      }

      if (eddyTaxUnpaid) continue;

      if (siteIsTapped && !hasPlayFlag(allyDef, 'playable-at-tapped-site')) {
        logDetail(`Discard ally ${allyDef.name}: site is already tapped`);
        continue;
      }

      const blockingManifestation = manifestationOfEntityInPlay(state, allyDef);
      if (blockingManifestation) {
        logDetail(`Discard ally ${allyDef.name}: blocked — manifestation "${blockingManifestation}" already in play`);
        continue;
      }

      const discardAllyDupLimit = findDuplicationLimitEffect(allyDef, 'company');
      if (discardAllyDupLimit) {
        const copiesInCompany = countAttachedInCompany(state, player, company, allyDef.name, 'allies');
        if (copiesInCompany >= discardAllyDupLimit.max) {
          logDetail(`Discard ally ${allyDef.name}: company duplication limit reached (${copiesInCompany}/${discardAllyDupLimit.max})`);
          continue;
        }
      }

      for (const ch of untappedCharacters) {
        const charName = defById(state, ch.definitionId)?.name ?? ch.instanceId;
        logDetail(`Discard ally ${allyDef.name}: playable from discard under ${charName} (Glove of Radagast)`);
        actions.push({
          action: {
            type: 'play-hero-resource',
            player: playerId,
            cardInstanceId: discardCard.instanceId,
            companyId: company.id,
            attachToCharacterId: ch.instanceId,
            fromDiscard: true,
          },
          viable: true,
        });
      }
    }
  }

  // Resource short-events (e.g. Marvels Told) — per CoE 2.1.1 the resource
  // player may play these during any phase of their turn unless a rule or
  // effect restricts them.
  const shortEventActions = playResourceShortEventActions(
    state, playerId, evaluatedInstances, 'site',
  );
  actions.push(...shortEventActions);
  for (const ea of shortEventActions) {
    const id = (ea.action as { cardInstanceId?: string }).cardInstanceId;
    if (typeof id === 'string') evaluatedInstances.add(id);
  }

  // Character-recruitment events (A Chance Meeting tw-188): bring a character
  // into play at a company at a qualifying site during the site phase, bypassing
  // the one-character-per-turn limit.
  const recruitViaEventEvaluated = recruitViaEventActions(state, playerId);
  actions.push(...recruitViaEventEvaluated);
  for (const ea of recruitViaEventEvaluated) {
    const a = ea.action as { characterInstanceId?: string; viaEventInstanceId?: string };
    if (a.characterInstanceId) evaluatedInstances.add(a.characterInstanceId);
    if (a.viaEventInstanceId) evaluatedInstances.add(a.viaEventInstanceId);
  }

  // Manifestation swaps (Strider ba-1 → Aragorn II): playable whenever a
  // normal resource could be played (CRF 22), so offered here too.
  const manifestationSwapEvaluated = manifestationSwapActions(state, playerId);
  actions.push(...manifestationSwapEvaluated);
  for (const ea of manifestationSwapEvaluated) {
    const a = ea.action as { cardInstanceId?: string };
    if (a.cardInstanceId) evaluatedInstances.add(a.cardInstanceId);
  }

  // Discard-to-recruit (Folco Boffin dm-180): playable whenever a normal
  // resource could be played (CRF 22).
  const discardToRecruitEvaluated = discardToRecruitActions(state, playerId);
  actions.push(...discardToRecruitEvaluated);
  for (const ea of discardToRecruitEvaluated) {
    const a = ea.action as { cardInstanceId?: string };
    if (a.cardInstanceId) evaluatedInstances.add(a.cardInstanceId);
  }

  // Mark remaining hand cards as not playable
  for (const handCard of player.hand) {
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    const def = defById(state, handCard.definitionId);
    const name = def?.name ?? 'card';
    actions.push(notPlayable(playerId, handCard.instanceId, `${name}: not playable during site phase`));
  }

  // Rule 2.1.1: resource player may activate any-phase grant-actions (e.g. Cram untap-bearer)
  actions.push(...grantedActionActivations(state, playerId, 'anyPhase'));

  // Site-phase grant-actions declared on the current site (e.g. The Worthy Hills as-142:
  // tap sage + scout to untap the site).
  actions.push(...sitePhaseGrantActions(state, playerId, company));

  // Eddy in Fate's Tide (ba-57): while the tax is unpaid, offer to tap one
  // untapped character (one action per candidate) to pay toward the two-character
  // tax that gates ally/item play at any version of the bound site.
  if (eddyTaxUnpaid) {
    for (const ch of untappedCharacters) {
      const charName = defById(state, ch.definitionId)?.name ?? ch.instanceId;
      logDetail(`Eddy in Fate's Tide: offering to tap ${charName} toward the site tax`);
      actions.push({
        action: { type: 'pay-site-tax', player: playerId, characterId: ch.instanceId },
        viable: true,
      });
    }
  }

  // Opponent influence attempts (rule 10.10)
  const oppInfluence = opponentInfluenceActions(state, playerId, siteState, company, player, untappedCharacters);
  actions.push(...oppInfluence);

  // Pass to end this company's site phase
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });

  return actions;
}

/**
 * Emit `activate-granted-action` actions for `grant-action` effects declared
 * directly on the company's current site. Handles two patterns:
 *
 * - `"sage-and-scout-in-company"` cost (The Worthy Hills as-142): taps one
 *   untapped sage AND one untapped scout to untap a tapped site. Only offered
 *   when the site is already tapped.
 *
 * - `"discard-minors-for-major"` action (Hermit's Hill dm-32): discards two
 *   minor items from the company to unlock major/hoard item playability for
 *   the rest of the company's site phase. Only offered when the site is
 *   untapped and the company holds at least two minor items.
 *
 * - `"discard-minors-for-gold-ring"` action (Hermit's Hill le-382): the
 *   minion sibling — discards two minor items to unlock gold ring
 *   playability (regardless of the ring's text restrictions) for the rest
 *   of the company's site phase. Same preconditions, plus the company must
 *   be covert.
 */
function sitePhaseGrantActions(
  state: GameState,
  playerId: PlayerId,
  company: import('../../index.js').Company,
): EvaluatedAction[] {
  const siteInstanceId = company.currentSite?.instanceId ?? null;
  if (!siteInstanceId) return [];

  const siteDefId = resolveInstanceId(state, siteInstanceId);
  if (!siteDefId) return [];
  const siteDef = defById(state, siteDefId);
  if (!siteDef) return [];

  const allGrantEffects = getCardEffects(siteDef).filter(
    (e): e is import('../../types/effects.js').GrantActionEffect => e.type === 'grant-action',
  );
  if (allGrantEffects.length === 0) return [];

  const player = playerById(state, playerId)!;
  const siteIsTapped = company.currentSite?.status === CardStatus.Tapped;
  const actions: EvaluatedAction[] = [];

  for (const effect of allGrantEffects) {
    // sage-and-scout-in-company: site must be tapped (ability untaps it)
    if (effect.cost.tap === 'sage-and-scout-in-company') {
      if (!siteIsTapped) continue;

      const sages = company.characters.filter(cId => {
        const char = player.characters[cId];
        if (!char || char.status !== CardStatus.Untapped) return false;
        const def = defById(state, char.definitionId);
        if (!isCharacterCard(def)) return false;
        const skills = getEffectiveSkills(state, char, def as { skills?: readonly string[] });
        return skills.includes('sage');
      });
      const scouts = company.characters.filter(cId => {
        const char = player.characters[cId];
        if (!char || char.status !== CardStatus.Untapped) return false;
        const def = defById(state, char.definitionId);
        if (!isCharacterCard(def)) return false;
        const skills = getEffectiveSkills(state, char, def as { skills?: readonly string[] });
        return skills.includes('scout');
      });

      if (sages.length === 0 || scouts.length === 0) {
        logDetail(`Site grant-action "${effect.action}": no eligible sage+scout pair in company`);
        continue;
      }
      for (const sageId of sages) {
        for (const scoutId of scouts) {
          if ((sageId as string) === (scoutId as string)) continue;
          logDetail(`Site grant-action "${effect.action}": sage ${sageId as string} + scout ${scoutId as string} eligible`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: sageId,
              secondCharacterId: scoutId,
              sourceCardId: siteInstanceId,
              sourceCardDefinitionId: siteDefId,
              actionId: effect.action,
              rollThreshold: 0,
            },
            viable: true,
          });
        }
      }
      continue;
    }

    // discard-minors-for-major (Hermit's Hill dm-32) /
    // discard-minors-for-gold-ring (Hermit's Hill le-382): site must be
    // untapped; company needs ≥2 minor items. The minion variant is
    // additionally restricted to covert companies ("a covert company may
    // discard two minor items…").
    if (effect.action === 'discard-minors-for-major' || effect.action === 'discard-minors-for-gold-ring') {
      if (siteIsTapped) continue;

      if (effect.action === 'discard-minors-for-gold-ring' && !isCovertCompany(company, player, state)) {
        logDetail(`Site grant-action "${effect.action}": company is overt — covert company required`);
        continue;
      }

      // Collect all minor items across the company's characters
      const minorItems: { itemId: import('../../index.js').CardInstanceId; bearerId: import('../../index.js').CardInstanceId }[] = [];
      for (const charId of company.characters) {
        const char = player.characters[charId];
        if (!char) continue;
        for (const item of char.items) {
          const itemDef = defById(state, item.definitionId);
          if (itemDef && 'subtype' in itemDef && (itemDef as { subtype: string }).subtype === 'minor') {
            minorItems.push({ itemId: item.instanceId, bearerId: charId });
          }
        }
      }

      if (minorItems.length < 2) {
        logDetail(`Site grant-action "${effect.action}": fewer than 2 minor items in company`);
        continue;
      }

      // Emit one action per unordered pair of minor items
      for (let i = 0; i < minorItems.length; i++) {
        for (let j = i + 1; j < minorItems.length; j++) {
          const first = minorItems[i];
          const second = minorItems[j];
          logDetail(`Site grant-action "${effect.action}": offering discard of items ${first.itemId as string} + ${second.itemId as string}`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: first.bearerId,
              sourceCardId: siteInstanceId,
              sourceCardDefinitionId: siteDefId,
              actionId: effect.action,
              rollThreshold: 0,
              targetCardId: first.itemId,
              secondTargetCardId: second.itemId,
            },
            viable: true,
          });
        }
      }
      continue;
    }
  }

  return actions;
}

/**
 * Generate legal actions for influencing an opponent's in-play characters
 * or allies at the same site.
 *
 * Guards (return empty if any fail):
 * - It is not the resource player's first turn
 * - The company has entered its site this turn
 * - No prior opponent interaction (influence or CvCC attack) this turn
 *
 * For each untapped character in the active company, checks opponent companies
 * at the same site for targetable characters and allies. Avatars and cards
 * controlled by avatars cannot be targeted.
 *
 * CoE rules 10.10–10.11.
 */
function opponentInfluenceActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
  company: { readonly characters: readonly import('../../index.js').CardInstanceId[]; readonly currentSite: import('../../index.js').SiteInPlay | null },
  player: import('../../index.js').PlayerState,
  untappedCharacters: import('../../index.js').CharacterInPlay[],
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];

  // Guard: must have entered the site
  if (!siteState.siteEntered) {
    logDetail(`Opponent influence: company hasn't entered site`);
    return [];
  }

  // Guard: not first turn
  if (state.turnNumber <= 2) {
    logDetail(`Opponent influence: first turn (turnNumber ${state.turnNumber}) — not allowed`);
    return [];
  }

  // Guard: no prior opponent interaction this turn
  if (siteState.opponentInteractionThisTurn !== null) {
    logDetail(`Opponent influence: already made ${siteState.opponentInteractionThisTurn} this turn`);
    return [];
  }

  // Guard: need untapped characters
  if (untappedCharacters.length === 0) {
    logDetail(`Opponent influence: no untapped characters`);
    return [];
  }

  // Find active company's site definition
  const siteInstanceId = company.currentSite?.instanceId ?? null;
  const siteDefId = siteInstanceId ? resolveInstanceId(state, siteInstanceId) : undefined;
  const siteDef = siteDefId ? defById(state, siteDefId) : undefined;
  if (!siteDef || !isSiteCard(siteDef)) return [];

  const playerIndex = getPlayerIndex(state, playerId);
  const opponentIndex = 1 - playerIndex;
  const opponent = state.players[opponentIndex];
  const opponentGI = effectiveGeneralInfluence(state, opponent.id) - opponent.generalInfluenceUsed;
  const attackerAlignment = state.players[playerIndex].alignment;
  const crossAlignmentPenalty = crossAlignmentInfluencePenalty(attackerAlignment, opponent.alignment);
  const crossAlignmentSuffix = crossAlignmentPenalty === 0
    ? ''
    : `, cross-alignment penalty: ${crossAlignmentPenalty}`;

  // Prophet of Doom (wh-106): while the override is in play, its named influencer
  // (Pallando, an untapped character in this company) "need not be at the
  // appropriate site" — he may target the opponent's cards at any site. Other
  // influencers remain bound to the same site.
  const override = getOpponentInfluenceOverride(state, player);
  const overrideInfluencer = override
    ? untappedCharacters.find(ch => {
      const d = defById(state, ch.definitionId);
      return d && isCharacterCard(d) && d.name === override.influencer;
    })
    : undefined;

  // Find opponent companies (same site normally; any site for the override
  // influencer).
  for (const oppCompany of opponent.companies) {
    if (!oppCompany.currentSite) continue;
    const oppSiteDef = resolveDef(state, oppCompany.currentSite.instanceId);
    if (!oppSiteDef || !isSiteCard(oppSiteDef)) continue;
    const sameSite = oppSiteDef.name === siteDef.name;
    // Influencers eligible for this company: everyone at the same site, else
    // only the override influencer reaching out from afar.
    const eligibleInfluencers = sameSite
      ? untappedCharacters
      : overrideInfluencer ? [overrideInfluencer] : [];
    if (eligibleInfluencers.length === 0) continue;

    logDetail(`Opponent influence: opponent company at ${oppSiteDef.name}${sameSite ? ' (same site)' : ' (reachable via Prophet of Doom)'}`);

    // Check each opponent character at this site
    for (const oppCharId of oppCompany.characters) {
      const oppChar = opponent.characters[oppCharId];
      if (!oppChar) continue;
      const oppCharDef = defById(state, oppChar.definitionId);
      if (!oppCharDef || !isCharacterCard(oppCharDef)) continue;

      // Skip avatars
      if (isAvatarCharacter(oppCharDef)) {
        logDetail(`Opponent influence: ${oppCharDef.name} is avatar — skip`);
        continue;
      }

      // Skip characters controlled by avatar (follower of avatar)
      // controlledBy is 'general' or a CardInstanceId of the controlling character
      if (oppChar.controlledBy !== 'general') {
        const ctrlChar = opponent.characters[oppChar.controlledBy];
        if (ctrlChar) {
          const ctrlDef = defById(state, ctrlChar.definitionId)!;
          if (isAvatarCharacter(ctrlDef)) {
            logDetail(`Opponent influence: ${oppCharDef.name} controlled by avatar ${ctrlDef.name} — skip`);
            continue;
          }
        }
      }

      // Determine controller's unused DI (rule 10.12 step 5)
      // Only applies when the target is under direct influence (not GI)
      let controllerDI = 0;
      if (oppChar.controlledBy !== 'general') {
        controllerDI = availableDI(state, oppChar.controlledBy, opponent);
      }

      // Generate action per eligible influencer
      for (const ch of eligibleInfluencers) {
        const charDef = defById(state, ch.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;

        const influencerDI = availableDI(state, ch.instanceId, player);
        const explanation = `Influencer DI: ${influencerDI}, opponent GI: ${opponentGI}, target mind: ${oppCharDef.mind}, controller DI: ${controllerDI}${crossAlignmentSuffix}`;

        logDetail(`Opponent influence: ${charDef.name} can target ${oppCharDef.name} (${explanation})`);
        // Base action (no reveal)
        actions.push({
          action: {
            type: 'opponent-influence-attempt',
            player: playerId,
            influencingCharacterId: ch.instanceId,
            targetPlayer: opponent.id,
            targetInstanceId: oppCharId,
            targetKind: 'character',
            explanation,
          },
          viable: true,
        });

        // Identical card reveal variant (rule 10.11): same name, any alignment
        const identicalInHand = player.hand.find(h => {
          const hDef = defById(state, h.definitionId);
          return hDef && (isCharacterCard(hDef) || isAllyCard(hDef)) && hDef.name === oppCharDef.name;
        });
        if (identicalInHand) {
          const revealExplanation = `${explanation} (reveal identical → mind treated as 0)`;
          logDetail(`Opponent influence: ${charDef.name} can reveal identical ${oppCharDef.name} from hand`);
          actions.push({
            action: {
              type: 'opponent-influence-attempt',
              player: playerId,
              influencingCharacterId: ch.instanceId,
              targetPlayer: opponent.id,
              targetInstanceId: oppCharId,
              targetKind: 'character',
              revealedCardInstanceId: identicalInHand.instanceId,
              explanation: revealExplanation,
            },
            viable: true,
          });
        }
      }

      // Check allies on this character
      for (const allyInst of oppChar.allies) {
        const allyDef = defById(state, allyInst.definitionId);
        if (!allyDef || !isAllyCard(allyDef)) continue;

        const allyMind = allyDef.mind;

        // Controller DI for ally = DI of the character controlling it
        const allyControllerDI = availableDI(state, oppCharId, opponent);

        for (const ch of eligibleInfluencers) {
          const charDef = defById(state, ch.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;

          const influencerDI = availableDI(state, ch.instanceId, player);
          const explanation = `Influencer DI: ${influencerDI}, opponent GI: ${opponentGI}, target mind: ${allyMind}, controller DI: ${allyControllerDI}${crossAlignmentSuffix}`;

          logDetail(`Opponent influence: ${charDef.name} can target ally ${allyDef.name} (${explanation})`);
          // Base action (no reveal)
          actions.push({
            action: {
              type: 'opponent-influence-attempt',
              player: playerId,
              influencingCharacterId: ch.instanceId,
              targetPlayer: opponent.id,
              targetInstanceId: allyInst.instanceId,
              targetKind: 'ally',
              explanation,
            },
            viable: true,
          });

          // Identical card reveal variant
          const identicalAllyInHand = player.hand.find(h => {
            const hDef = defById(state, h.definitionId);
            return hDef && (isCharacterCard(hDef) || isAllyCard(hDef)) && hDef.name === allyDef.name;
          });
          if (identicalAllyInHand) {
            const revealExplanation = `${explanation} (reveal identical → mind treated as 0)`;
            logDetail(`Opponent influence: ${charDef.name} can reveal identical ${allyDef.name} from hand`);
            actions.push({
              action: {
                type: 'opponent-influence-attempt',
                player: playerId,
                influencingCharacterId: ch.instanceId,
                targetPlayer: opponent.id,
                targetInstanceId: allyInst.instanceId,
                targetKind: 'ally',
                revealedCardInstanceId: identicalAllyInHand.instanceId,
                explanation: revealExplanation,
              },
              viable: true,
            });
          }
        }
      }

      // Items on this character (CoE rule 8.1 item clause): the influencer must
      // be at the same site (already ensured), the item must not have a
      // permanent-event played on it, AND the resource player must reveal an
      // identical item card from hand. The reveal is mandatory, so an item
      // attempt is only offered when a matching item sits in the influencer's
      // hand. The comparison value (rule 8.3) is the controlling character's
      // mind; its unused DI is subtracted as controller DI.
      const itemControllerMind = oppCharDef.mind;
      const itemControllerDI = availableDI(state, oppCharId, opponent);
      for (const itemInst of oppChar.items) {
        const itemDef = defById(state, itemInst.definitionId);
        if (!itemDef || !isItemCard(itemDef)) continue;
        // Skip items that have a permanent-event attached to them.
        const hasPermEventOnItem = opponent.cardsInPlay.some(c => c.attachedToItem === itemInst.instanceId);
        if (hasPermEventOnItem) {
          logDetail(`Opponent influence: item ${itemDef.name} has a permanent-event on it — cannot be influenced`);
          continue;
        }
        const identicalItemInHand = player.hand.find(h => {
          const hDef = defById(state, h.definitionId);
          return hDef && isItemCard(hDef) && hDef.name === itemDef.name;
        });
        if (!identicalItemInHand) {
          logDetail(`Opponent influence: no identical ${itemDef.name} in hand — cannot influence item`);
          continue;
        }
        for (const ch of eligibleInfluencers) {
          const charDef = defById(state, ch.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          const influencerDI = availableDI(state, ch.instanceId, player);
          const explanation = `Influencer DI: ${influencerDI}, opponent GI: ${opponentGI}, target mind (controller): ${itemControllerMind}, controller DI: ${itemControllerDI}${crossAlignmentSuffix} (reveal identical ${itemDef.name})`;
          logDetail(`Opponent influence: ${charDef.name} can target item ${itemDef.name} (${explanation})`);
          actions.push({
            action: {
              type: 'opponent-influence-attempt',
              player: playerId,
              influencingCharacterId: ch.instanceId,
              targetPlayer: opponent.id,
              targetInstanceId: itemInst.instanceId,
              targetKind: 'item',
              revealedCardInstanceId: identicalItemInHand.instanceId,
              explanation,
            },
            viable: true,
          });
        }
      }
    }
  }

  // Faction re-influence: target in-play factions of the opponent.
  // CoE rule 8.3 final list — "the value required for the influence check on
  // the faction that is already in play" serves as the comparison value.
  // The active company must be at a site where the faction is playable
  // (re-influence happens at the faction's home site). No controller DI
  // applies to factions (they're controlled by the player, not a character).
  for (const factionInPlay of opponent.cardsInPlay) {
    const factionDef = defById(state, factionInPlay.definitionId);
    if (!factionDef || !isFactionCard(factionDef)) continue;

    // Normally re-influence requires the active company to be at a site where
    // the faction is playable. Prophet of Doom's override influencer may reach
    // any of the opponent's in-play factions regardless of the current site.
    const playableHere = factionDef.playableAt.some(entry => siteMatchesEntry(siteDef, entry, undefined, siteRegionTypeOf(state, siteDef), isUnderDeepsSurfaceSite(state, siteDef)));
    const factionInfluencers = playableHere
      ? untappedCharacters
      : overrideInfluencer ? [overrideInfluencer] : [];
    if (factionInfluencers.length === 0) {
      logDetail(`Opponent influence: ${factionDef.name} not playable at ${siteDef.name} — skip`);
      continue;
    }

    const targetValue = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;

    for (const ch of factionInfluencers) {
      const charDef = defById(state, ch.definitionId);
      if (!charDef || !isCharacterCard(charDef)) continue;

      const influencerDI = availableDI(state, ch.instanceId, player);
      const explanation = `Influencer DI: ${influencerDI}, opponent GI: ${opponentGI}, faction in-play influence #: ${targetValue}${crossAlignmentSuffix}`;

      logDetail(`Opponent influence: ${charDef.name} can re-influence faction ${factionDef.name} (${explanation})`);
      actions.push({
        action: {
          type: 'opponent-influence-attempt',
          player: playerId,
          influencingCharacterId: ch.instanceId,
          targetPlayer: opponent.id,
          targetInstanceId: factionInPlay.instanceId,
          targetKind: 'faction',
          explanation,
        },
        viable: true,
      });

      // CoE rule 8.2: identical card reveal is allowed for factions too.
      const identicalFactionInHand = player.hand.find(h => {
        const hDef = defById(state, h.definitionId);
        return hDef && isFactionCard(hDef) && hDef.name === factionDef.name;
      });
      if (identicalFactionInHand) {
        const revealExplanation = `${explanation} (reveal identical → target treated as 0)`;
        logDetail(`Opponent influence: ${charDef.name} can reveal identical ${factionDef.name} from hand`);
        actions.push({
          action: {
            type: 'opponent-influence-attempt',
            player: playerId,
            influencingCharacterId: ch.instanceId,
            targetPlayer: opponent.id,
            targetInstanceId: factionInPlay.instanceId,
            targetKind: 'faction',
            revealedCardInstanceId: identicalFactionInHand.instanceId,
            explanation: revealExplanation,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Legal actions during the 'declare-company-attack' step (CvCC).
 *
 * Only the active (resource) player can declare. For each opponent company
 * at the same site that satisfies alignment restrictions, one
 * `declare-company-attack` action is offered. A `pass` action is always
 * offered to skip and advance to the next company.
 *
 * CoE rules 8.38–8.41.
 */
function declareCompanyAttackActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail('CvCC: non-active player has no actions in declare-company-attack step');
    return [];
  }

  const player = playerById(state, playerId);
  if (!player) return [];
  const company = player.companies[siteState.activeCompanyIndex];
  if (!company?.currentSite) return [];

  const actions: GameAction[] = [];

  // If an interaction (attack or influence) already happened this turn, skip
  // offering attack actions — only the pass remains to advance the company.
  if (siteState.opponentInteractionThisTurn !== null) {
    logDetail(`CvCC: interaction already occurred this turn (${siteState.opponentInteractionThisTurn}) — only pass offered`);
    actions.push({ type: 'pass', player: playerId });
    return actions;
  }

  const siteDef = defById(state, company.currentSite.definitionId);
  const siteName = siteDef && isSiteCard(siteDef) ? siteDef.name : null;

  // Find opponent companies at the same site and check alignment restrictions
  for (const otherPlayer of state.players) {
    if (otherPlayer.id === playerId) continue;
    for (const opponentCompany of otherPlayer.companies) {
      if (!opponentCompany.currentSite) continue;
      const oppSiteDef = defById(state, opponentCompany.currentSite.definitionId);
      const oppSiteName = oppSiteDef && isSiteCard(oppSiteDef) ? oppSiteDef.name : null;
      // Same site: match by name when both resolve (handles hero/minion versions of the
      // same location), fall back to definitionId equality when definitions are unavailable.
      const sameSite = siteName && oppSiteName
        ? siteName === oppSiteName
        : company.currentSite.definitionId === opponentCompany.currentSite.definitionId;
      if (!sameSite) continue;

      const attackerCovert = isCovertCompany(company, player, state);
      const defenderCovert = isCovertCompany(opponentCompany, otherPlayer, state);
      if (!canAttackAlignment(player.alignment, otherPlayer.alignment, attackerCovert, defenderCovert)
        && !cvccAttackPermitted(state, player, company, otherPlayer, opponentCompany)) {
        logDetail(`CvCC: alignment ${player.alignment} cannot attack ${otherPlayer.alignment} — skipping ${opponentCompany.id}`);
        continue;
      }
      // A deny-company-attack site-rule (Rivendell as-160) bars the attack at
      // this location even when the alignment matrix would allow it.
      if (siteDeniesCompanyAttack(state, player, company, otherPlayer, opponentCompany)) {
        logDetail(`CvCC: site-rule denies company attacks here — skipping ${opponentCompany.id}`);
        continue;
      }

      logDetail(`CvCC: ${company.id} (${player.alignment}) can attack ${opponentCompany.id} (${otherPlayer.alignment})`);
      actions.push({
        type: 'declare-company-attack',
        player: playerId,
        attackingCompanyId: company.id,
        targetCompanyId: opponentCompany.id,
      });
    }
  }

  // Always offer pass to skip CvCC and advance to next company
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

