/**
 * @module legal-actions/organization-events
 *
 * Event card play actions during the organization phase. Evaluates permanent
 * resource events (played directly to the table) and short events with
 * special play-as-resource effects (e.g. Twilight cancelling environments).
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  CardDefinitionId,
  HeroResourceEventCard,
  MinionResourceEventCard,
  HazardEventCard,
  PlayTargetEffect,
} from '../../index.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { isCharacterCard, isAvatarCharacter, isSiteCard, isFactionCard } from '../../types/cards.js';
import { Race } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { getEffectiveSkills } from '../effects/index.js';
import { getEffectiveSiteType } from '../effective.js';
import { logDetail } from './log.js';
import { notPlayable } from './action-builders.js';
import { isSiteProtectedForPlayer, playerById, defById, countCopiesInPlay, countPlayerHeldCopies, countAttachedInCompany, countCompanyBoundCopies, countPermanentEventCopiesAtSite, defNamesOf, itemKeywordsOf, itemSubtypesOf, getCardEffects, isCardNameInPlayOrCharacters, isCovertCompany, findDuplicationLimitEffect, findPlayConditionEffect, findFallenWizardAvatarName, siteRegionTypeOf, matchesCompanyContextCondition, isCompanyEventPlayProhibited } from '../reducer-utils.js';
import { wizardSpecificName } from '../fallen-wizard-specific.js';
import { buildPlayerStateContext } from './organization.js';
import { buildFactionPlayableRegions } from '../recompute-derived.js';
import { isSetAsideCard, cardTargetsSetAside } from '../set-aside.js';

/**
 * The combined count of a player's supporters for Girdle of Radagast (wh-110):
 * every ally in play (an ally borne by any of the player's characters) plus
 * every **unique faction** in play that can be played at a site in the anchor
 * Wizardhaven's region or an adjacent region. The parenthetical region
 * restriction on the card applies only to the factions, so allies always count.
 */
function girdleSupporterCount(
  state: GameState,
  player: import('../../index.js').PlayerState,
  siteDef: import('../../index.js').SiteCard,
): number {
  // Allies in play — allies attach to characters (CharacterInPlay.allies).
  let count = 0;
  for (const ch of Object.values(player.characters)) {
    count += ch.allies.length;
  }

  // Region set: the Wizardhaven's region plus its adjacent regions.
  const regionSet = new Set<string>();
  const anchorRegion = siteDef.region;
  if (anchorRegion) {
    regionSet.add(anchorRegion);
    for (const cardDef of Object.values(state.cardPool)) {
      const rc = cardDef as { cardType?: string; name?: string; adjacentRegions?: readonly string[] };
      if (rc.cardType === 'region' && rc.name === anchorRegion) {
        for (const adj of rc.adjacentRegions ?? []) regionSet.add(adj);
        break;
      }
    }
  }

  // Unique factions in play playable at a site in the region set.
  for (const c of player.cardsInPlay) {
    const def = defById(state, c.definitionId);
    if (!def || !isFactionCard(def) || !def.unique) continue;
    const playableRegions = buildFactionPlayableRegions(state, def);
    if (playableRegions.some(r => regionSet.has(r))) count++;
  }
  return count;
}

/**
 * Whether `company` contains an Orc or Troll character (MEWH §9). Half-orcs
 * carry `race: Orc`, so they are included.
 */
function companyHasOrcOrTroll(
  state: GameState,
  company: import('../../index.js').PlayerState['companies'][number],
  player: import('../../index.js').PlayerState,
): boolean {
  return company.characters.some(cId => {
    const ch = player.characters[cId];
    if (!ch) return false;
    const def = defById(state, ch.definitionId);
    return !!def && 'race' in def
      && ((def as { race: string }).race === Race.Orc || (def as { race: string }).race === Race.Troll);
  });
}

/**
 * Evaluates permanent-event resource cards in hand for play during organization.
 * Permanent resource events can be played directly to the table without a site.
 * Unique permanent events cannot be played if one with the same name is already in play.
 */
export function playPermanentEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId] as HeroResourceEventCard | MinionResourceEventCard | undefined;
    if (!def || (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') || def.eventType !== 'permanent') continue;

    // Rule 5.F1 [FALLEN-WIZARD]: Stage resource permanent-events can only be
    // played during the organization phase. The exceptions are cards that
    // declare their own timing in their text (e.g. "Playable during the site
    // phase") — those target a site and are handled by the site-target branch
    // below. Stage permanent-events that target a character or have no target
    // (e.g. Wizard's Myrmidon wh-84) must not be offered during the
    // movement/hazard phase, where this function is also consulted under the
    // general "any phase" allowance of rule 2.1.1.
    const isStageResource = (def as { alignment?: string }).alignment === 'stage';
    if (isStageResource && state.phaseState.phase !== Phase.Organization) {
      logDetail(`Stage permanent-event ${def.name}: only playable during the organization phase (current phase ${state.phaseState.phase})`);
      continue;
    }

    // A permanent-event carrying an `active-company` play-condition declares its
    // own site-phase timing (Delver's Harvest wh-65: "Playable during the site
    // phase if one of your companies enters the Deep Mines site."). Such a card
    // is offered only by the site-phase play path (legal-actions/site.ts),
    // never here — even during the organization phase.
    if (findPlayConditionEffect(def, 'active-company')) {
      logDetail(`Permanent event ${def.name}: site-phase timing (active-company play-condition) — not offered in this phase`);
      continue;
    }

    // Check uniqueness: unique permanent events can't be played if already in play
    if (def.unique) {
      const alreadyInPlay = countCopiesInPlay(state, def.name) > 0;
      if (alreadyInPlay) {
        logDetail(`Permanent event ${def.name}: unique and already in play`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} is unique and already in play`));
        continue;
      }
    }

    // Wizard-specific Stage resources (e.g. Truths of Doom wh-108 "Pallando
    // specific", The Forge-master wh-117 "Saruman specific") are bound to one
    // Fallen-wizard avatar (CoE 1.3.4). Per CoE 2.2.F2 they remain playable for
    // as long as that avatar has NOT been eliminated — the avatar need NOT be in
    // play, so the card can be played even before the Fallen-wizard is first
    // brought into play from the deck. `findFallenWizardAvatarName` resolves the
    // player's declared avatar whether it is in play or still in the
    // deck/hand/discard/sideboard, and returns undefined once it is eliminated.
    const requiredWizard = wizardSpecificName(def);
    if (requiredWizard) {
      const avatarName = findFallenWizardAvatarName(state, player);
      if (avatarName !== requiredWizard) {
        logDetail(`Permanent event ${def.name}: ${requiredWizard}-specific, but player's Fallen-wizard is ${avatarName ?? 'none / eliminated'}`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} is ${requiredWizard}-specific`));
        continue;
      }
    }

    // Check duplication-limit with scope "game": cannot play if a copy is already in play
    const dupLimit = findDuplicationLimitEffect(def, 'game');
    if (dupLimit) {
      const copiesInPlay = countCopiesInPlay(state, def.name);
      if (copiesInPlay >= dupLimit.max) {
        logDetail(`Permanent event ${def.name}: cannot be duplicated (${copiesInPlay}/${dupLimit.max} in play)`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} cannot be duplicated`));
        continue;
      }
    }

    // Check duplication-limit with scope "player": each player independently limited
    const playerDupLimit = findDuplicationLimitEffect(def, 'player');
    if (playerDupLimit) {
      const copiesOwned = countPlayerHeldCopies(state, player, def.name);
      if (copiesOwned >= playerDupLimit.max) {
        logDetail(`Permanent event ${def.name}: player duplication limit reached (${copiesOwned}/${playerDupLimit.max})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} cannot be duplicated by a given player`));
        continue;
      }
    }

    // play-condition: player-state — a generic DSL condition on the active
    // player's avatar/alignment/stage-point context. Used by Gatherer of
    // Loyalties (wh-70): "Playable if you have more than 3 stage points." and A
    // Strident Spawn (wh-61): "Playable if you are Pallando or Saruman and have
    // 6 or more stage points and a protected Wizardhaven."
    const playerStateCondition = findPlayConditionEffect(def, 'player-state');
    if (playerStateCondition?.condition) {
      const ctx = buildPlayerStateContext(state, player, playerId);
      if (!matchesCondition(playerStateCondition.condition, ctx)) {
        logDetail(`Permanent event ${def.name}: play-condition player-state not satisfied (stagePoints=${player.stagePoints})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: play condition not met`));
        continue;
      }
    }

    // play-target DSL: cards targeting a site.
    const sitePlayTarget = def.effects?.find(
      (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
    );
    if (sitePlayTarget) {
      // Rule 5.F1 [FALLEN-WIZARD]: Stage resource permanent-events are played
      // during the organization phase only. A site-targeting Stage resource
      // (The Fortress of Isen wh-68, Fortress of the Towers wh-69, Guarded
      // Haven wh-74, Double-dealing wh-66, Saruman's Machinery wh-120) is
      // offered here against any of the player's companies whose current site
      // matches the play-target filter; playing it binds the card to that site.
      // Caverns Unchoked (ba-51) is a Balrog resource permanent-event that
      // likewise declares organization-phase-on-site timing (via its
      // `surface-region-adjacency` effect). Non-Stage site-targeting permanent
      // events without such a marker (e.g. hero events erratated "Playable
      // during the site phase") are handled by the site phase instead.
      const isCavernsUnchoked = def.effects?.some(e => e.type === 'surface-region-adjacency') ?? false;
      const orgPhaseSiteTiming = isStageResource || isCavernsUnchoked;
      if (!orgPhaseSiteTiming) {
        logDetail(`Permanent event ${def.name}: requires a site target — only playable during the site phase`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} can only be played during the site phase`));
        continue;
      }
      // Caverns Unchoked (ba-51) is "Playable ... during the organization
      // phase." Stage resources are already blocked outside the organization
      // phase above; block the non-stage Caverns Unchoked here too so the
      // rule-2.1.1 "any phase" allowance does not offer it during movement/hazard.
      if (isCavernsUnchoked && state.phaseState.phase !== Phase.Organization) {
        logDetail(`Permanent event ${def.name}: only playable during the organization phase (current ${state.phaseState.phase})`);
        continue;
      }

      // play-condition: site-protected — the bound site must already carry a
      // `site-protected` constraint owned by this player (Saruman's Machinery
      // wh-120: "Playable on your protected Isengard or The White Towers").
      const siteProtectedCond = findPlayConditionEffect(def, 'site-protected');
      const supportersInRegionCond = findPlayConditionEffect(def, 'supporters-in-region');
      const siteDupLimit = findDuplicationLimitEffect(def, 'site');
      let anySite = false;
      for (const company of player.companies) {
        if (!company.currentSite) continue;
        const siteDefId = company.currentSite.definitionId;
        const siteDef = defById(state, siteDefId);
        if (!siteDef || !isSiteCard(siteDef)) continue;
        if (sitePlayTarget.filter) {
          // Mirror the site-phase matcher context: expose the site's region
          // type (lives on a separate region card) and its *effective* type
          // after any wizardhaven-conversion / site-type-override, so filters
          // like Hidden Haven's region gate or Guarded Haven's "your
          // Wizardhaven [{H}]" match dynamically converted sites.
          const regionType = siteRegionTypeOf(state, siteDef);
          const effectiveSiteType = getEffectiveSiteType(state, siteDefId, siteDef.siteType, company.currentSite.instanceId);
          const matchTarget = { ...(siteDef as unknown as Record<string, unknown>), regionType, effectiveSiteType };
          if (!matchesCondition(sitePlayTarget.filter, matchTarget)) {
            logDetail(`Permanent event ${def.name}: site ${siteDef.name} does not match play-target filter`);
            continue;
          }
        }
        if (siteProtectedCond) {
          const protectedForPlayer = isSiteProtectedForPlayer(state, siteDefId, playerId);
          if (!protectedForPlayer) {
            logDetail(`Permanent event ${def.name}: site ${siteDef.name} is not protected for ${playerId as string}`);
            continue;
          }
        }
        if (siteDupLimit) {
          const copiesAtSite = countPermanentEventCopiesAtSite(state, def.name, siteDefId);
          if (copiesAtSite >= siteDupLimit.max) {
            logDetail(`Permanent event ${def.name}: site duplication limit reached at ${siteDef.name}`);
            continue;
          }
        }
        // play-condition: supporters-in-region — Girdle of Radagast (wh-110):
        // "… 6 allies and/or unique factions in play (the factions must be
        // playable at sites in the Wizardhaven's region or adjacent regions)."
        if (supportersInRegionCond?.min !== undefined) {
          const supporters = girdleSupporterCount(state, player, siteDef);
          if (supporters < supportersInRegionCond.min) {
            logDetail(`Permanent event ${def.name}: only ${supporters} supporter(s) for ${siteDef.name} region, need ${supportersInRegionCond.min}`);
            continue;
          }
        }
        anySite = true;
        logDetail(`Permanent event ${def.name}: playable on site ${siteDef.name}`);
        actions.push({
          action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetSiteDefinitionId: siteDefId },
          viable: true,
        });
      }
      if (!anySite) {
        logDetail(`Permanent event ${def.name}: no company at a matching site`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid site target`));
      }
      continue;
    }

    // play-condition: card-not-in-play — blocked if named card is in play
    const cardNotInPlayCondition = findPlayConditionEffect(def, 'card-not-in-play');
    if (cardNotInPlayCondition?.cardName) {
      const blockerName = cardNotInPlayCondition.cardName;
      const blockerInPlay = isCardNameInPlayOrCharacters(state, blockerName);
      if (blockerInPlay) {
        logDetail(`Permanent event ${def.name}: blocked because ${blockerName} is in play`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: cannot be played while ${blockerName} is in play`));
        continue;
      }
    }

    // play-target DSL: character-targeting permanent events get one action per qualifying character
    const playTarget = def.effects?.find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    if (playTarget?.target === 'character') {
      const charDupLimit = findDuplicationLimitEffect(def, 'character');
      const companyDupLimit = findDuplicationLimitEffect(def, 'company');
      // play-condition: site-type — the character's company must be at one of the required site types
      const siteTypeCondition = findPlayConditionEffect(def, 'site-type');
      // play-condition: same-site-has-character-race — a company at the same site must have a character of the given race
      const sameSiteRaceCondition = findPlayConditionEffect(def, 'same-site-has-character-race');
      // play-condition: company-context — a generic DSL condition on the target
      // character's company (To Fealty Sworn ba-33). During the organization
      // phase no faction has been played this site phase, so the
      // `playedUniqueHeroFactionAtFreeHold` flag is always false here — only the
      // "in the same company as <named card>" alternative can be satisfied.
      const companyContextCondition = findPlayConditionEffect(def, 'company-context');
      let anyTarget = false;
      for (const company of player.companies) {
        if (companyContextCondition?.condition
          && !matchesCompanyContextCondition(state, player, company, companyContextCondition.condition, false)) {
          logDetail(`Permanent event ${def.name}: company ${company.id as string} does not satisfy company-context play-condition`);
          continue;
        }
        if (siteTypeCondition) {
          const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : null;
          const companySiteType = siteDef && 'siteType' in siteDef ? (siteDef as { siteType: string }).siteType : null;
          if (!companySiteType || !siteTypeCondition.siteTypes?.includes(companySiteType)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} not at required site type [${siteTypeCondition.siteTypes?.join(', ') ?? '?'}] (actual: ${companySiteType ?? 'none'})`);
            continue;
          }
        }
        if (sameSiteRaceCondition?.race) {
          const requiredRace = sameSiteRaceCondition.race;
          const companySiteId = company.currentSite?.definitionId;
          const racePresent = player.companies.some(otherCompany => {
            if (!companySiteId || otherCompany.currentSite?.definitionId !== companySiteId) return false;
            return otherCompany.characters.some(cId => {
              const ch = player.characters[cId];
              if (!ch) return false;
              const cDef = defById(state, ch.definitionId);
              return cDef && 'race' in cDef && (cDef as { race?: string }).race === requiredRace;
            });
          });
          if (!racePresent) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} has no ${requiredRace} at the same site`);
            continue;
          }
        }
        if (companyDupLimit) {
          const copiesInCompany = countAttachedInCompany(state, player, company, def.name, 'items');
          if (copiesInCompany >= companyDupLimit.max) {
            logDetail(`Permanent event ${def.name}: company duplication limit reached (${copiesInCompany}/${companyDupLimit.max})`);
            continue;
          }
        }
        const companySkills = company.characters.flatMap(cId => {
          const ch = player.characters[cId];
          if (!ch) return [];
          const cDef = defById(state, ch.definitionId);
          return cDef && isCharacterCard(cDef) ? getEffectiveSkills(state, ch, cDef) : [];
        });
        // True if the company contains any character who can use shadow-magic:
        // ringwraiths can use it by default; others need the "shadow-magic" skill.
        const hasShadowMagicUser = company.characters.some(cId => {
          const ch = player.characters[cId];
          if (!ch) return false;
          const cDef = defById(state, ch.definitionId);
          if (!cDef || !isCharacterCard(cDef)) return false;
          if ((cDef as { race?: string }).race === 'ringwraith') return true;
          return getEffectiveSkills(state, ch, cDef as { skills?: readonly string[] }).includes('shadow-magic');
        });
        for (const charId of company.characters) {
          const charData = player.characters[charId];
          if (!charData) continue;
          const charDef = defById(state, charData.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          if (playTarget.filter) {
            const itemKeywords = itemKeywordsOf(state, charData.items);
            const itemNames = defNamesOf(state, charData.items);
            const ctx = {
              target: {
                race: charDef.race,
                status: charData.status,
                skills: getEffectiveSkills(state, charData, charDef),
                name: charDef.name,
                // Mind cost of the character (null for avatars). Lets a card
                // gate on the printed mind, e.g. Awaiting the Call (le-165)
                // "on a character with a mind of 6 or less".
                mind: charDef.mind,
                keywords: (charDef as { keywords?: readonly string[] }).keywords ?? [],
                itemKeywords,
                itemNames,
                isAvatar: isAvatarCharacter(charDef),
              },
              company: { skills: companySkills, hasShadowMagicUser },
            };
            if (!matchesCondition(playTarget.filter, ctx)) continue;
          }
          if (charDupLimit) {
            const copiesOnChar = charData.items.filter(item => {
              const iDef = defById(state, item.definitionId);
              return iDef && iDef.name === def.name;
            }).length;
            if (copiesOnChar >= charDupLimit.max) {
              logDetail(`Permanent event ${def.name}: duplication limit on ${charDef.name}`);
              continue;
            }
          }
          anyTarget = true;
          logDetail(`Permanent event ${def.name}: playable on ${charDef.name}`);
          actions.push({
            action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetCharacterId: charId },
            viable: true,
          });
        }
      }
      if (!anyTarget) {
        logDetail(`Permanent event ${def.name}: no valid target`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid target`));
      }
      continue;
    }

    // play-target DSL: company-targeting permanent events get one action per qualifying company
    if (playTarget?.target === 'company') {
      const companyDupLimit = findDuplicationLimitEffect(def, 'company');
      // MEWH §9: a Fallen-wizard may not play a hero resource permanent-event on
      // a company containing an Orc or Troll.
      const heroEventForFw = player.alignment === 'fallen-wizard'
        && (def as { alignment?: string }).alignment === 'wizard';
      let anyTarget = false;
      for (const company of player.companies) {
        if (!company.currentSite) continue;
        if (heroEventForFw && companyHasOrcOrTroll(state, company, player)) {
          logDetail(`Permanent event ${def.name}: hero resource cannot be played on company ${company.id as string} — contains an Orc/Troll (MEWH §9)`);
          continue;
        }
        // Stormcrow (td-73): "No such cards may be played on each Wizard's
        // company." A resource permanent-event played on the company as a whole
        // is barred from any company containing a prohibited race (a Wizard).
        if (isCompanyEventPlayProhibited(state, player, company)) {
          logDetail(`Permanent event ${def.name}: cannot be played on company ${company.id as string} — a Stormcrow-style effect prohibits company events there`);
          continue;
        }
        const siteDef = defById(state, company.currentSite.definitionId);
        if (!siteDef || !('siteType' in siteDef)) continue;
        const siteType = (siteDef as { siteType: string }).siteType;
        // Count members: characters + allies attached to all characters
        const allyCount = company.characters.reduce((sum, cId) => {
          const ch = player.characters[cId];
          return sum + (ch ? ch.allies.length : 0);
        }, 0);
        const memberCount = company.characters.length + allyCount;
        // Company duplication limit: check cardsInPlay bound to this company
        if (companyDupLimit) {
          const existingCopies = countCompanyBoundCopies(state, def.name, company.id);
          if (existingCopies >= companyDupLimit.max) {
            logDetail(`Permanent event ${def.name}: company duplication limit reached on ${company.id as string} (${existingCopies}/${companyDupLimit.max})`);
            continue;
          }
        }
        if (playTarget.filter) {
          const overt = !isCovertCompany(company, player, state);
          const orcCount = company.characters.reduce((n, cId) => {
            const ch = player.characters[cId];
            if (!ch) return n;
            const cDef = defById(state, ch.definitionId);
            return n + (cDef && 'race' in cDef && (cDef as { race: string }).race === Race.Orc ? 1 : 0);
          }, 0);
          const ctx = { target: { siteType, memberCount, overt, orcCount } };
          if (!matchesCondition(playTarget.filter, ctx)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} filter not met (siteType=${siteType}, memberCount=${memberCount}, overt=${String(overt)}, orcCount=${orcCount})`);
            continue;
          }
        }
        anyTarget = true;
        logDetail(`Permanent event ${def.name}: playable on company ${company.id as string} (siteType=${siteType}, memberCount=${memberCount})`);
        actions.push({
          action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetCompanyId: company.id },
          viable: true,
        });
      }
      if (!anyTarget) {
        logDetail(`Permanent event ${def.name}: no valid company target`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} requires a qualifying company`));
      }
      continue;
    }

    logDetail(`Permanent event ${def.name}: playable`);
    actions.push({
      action: { type: 'play-permanent-event', player: playerId, cardInstanceId },
      viable: true,
    });
  }

  return actions;
}

/**
 * Evaluates short-event cards with `playable-as-resource` in hand (e.g. Twilight).
 * These cancel and discard an environment card in play. One action is offered per
 * valid (card, target) pair. If no environment is in play the card is not playable.
 */
export function playShortEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId] as HazardEventCard | undefined;
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;

    // Only cards with the playable-as-resource flag
    if (!hasPlayFlag(def, 'playable-as-resource')) continue;

    // Tookish Blood (tw-104) resource mode: "played as a resource card" on one
    // of the controller's own Hobbit characters, protecting it from discard /
    // return-to-hand for the rest of the turn. Offer one action per own
    // character matching the companion `play-target` filter (Hobbit).
    const protectEffect = getCardEffects(def).find(e => e.type === 'protect-from-removal');
    if (protectEffect) {
      const playTarget = getCardEffects(def).find(
        (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
      );
      let anyTarget = false;
      for (const [charId, charData] of Object.entries(player.characters)) {
        const charDef = defById(state, charData.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (playTarget?.filter) {
          const ctx = {
            target: {
              race: charDef.race,
              skills: charDef.skills,
              name: charDef.name,
              possessions: defNamesOf(state, charData.items),
              itemKeywords: itemKeywordsOf(state, charData.items),
              itemSubtypes: itemSubtypesOf(state, charData.items),
            },
          };
          if (!matchesCondition(playTarget.filter, ctx)) continue;
        }
        anyTarget = true;
        logDetail(`Resource short event ${def.name}: can protect ${charDef.name} from removal this turn`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId,
            targetCharacterId: charId as CardInstanceId,
          },
          viable: true,
        });
      }
      if (!anyTarget) {
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: no eligible character to protect`));
      }
      continue;
    }

    // Find environment cards — in a player's cardsInPlay (permanent events
    // like Doors of Night / Gates of Morning), or declared earlier in the
    // same chain of effects.
    const isEnv = (defId: string): boolean => {
      const d = state.cardPool[defId as CardDefinitionId];
      return !!d && 'keywords' in d
        && !!(d as { keywords?: readonly string[] }).keywords?.includes('environment');
    };
    // MEAS §1: cards placed "off to the side" are untargetable except by cards
    // that specifically affect set-aside cards.
    const mayTargetSetAside = cardTargetsSetAside(def);
    const envTargets: { instanceId: CardInstanceId; definitionId: string }[] = [];
    for (const p of state.players) {
      for (const c of p.cardsInPlay) {
        if (isSetAsideCard(c) && !mayTargetSetAside) continue;
        if (isEnv(c.definitionId as string)) envTargets.push(c);
      }
    }
    // Chain entries: environments declared earlier in the same chain
    if (state.chain) {
      for (const entry of state.chain.entries) {
        if (entry.resolved || entry.negated) continue;
        if (!entry.card) continue;
        if (isEnv(entry.card.definitionId as string)) {
          envTargets.push({ instanceId: entry.card.instanceId, definitionId: entry.card.definitionId as string });
        }
      }
    }

    if (envTargets.length === 0) {
      logDetail(`Short event ${def.name}: no environment in play to cancel`);
      actions.push(notPlayable(playerId, cardInstanceId, 'No environment to cancel'));
      continue;
    }

    for (const target of envTargets) {
      const targetDef = state.cardPool[target.definitionId as CardDefinitionId];
      logDetail(`Short event ${def.name}: can cancel environment ${targetDef?.name ?? target.definitionId}`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetInstanceId: target.instanceId,
        },
        viable: true,
      });
    }
  }

  return actions;
}
