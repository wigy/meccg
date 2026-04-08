/**
 * @module legal-actions/organization-companies
 *
 * Company management actions during the organization phase: movement planning,
 * influence reassignment, item transfers between characters, company splitting,
 * character movement between companies, and company merging.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  GameAction,
  SiteCard,
} from '../../index.js';
import { GENERAL_INFLUENCE, isCharacterCard, isSiteCard, buildMovementMap, getReachableSites, BASE_MAX_REGION_DISTANCE } from '../../index.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import { isRegressive } from '../reverse-actions.js';
import { availableDI } from './organization.js';

/**
 * Computes plan-movement actions for each company.
 * For every company, emits one viable action per reachable site in the player's
 * site deck, determined by the movement map (starter and region movement).
 * Companies that already have a destination planned are skipped.
 */
export function planMovementActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];
  const movementMap = buildMovementMap(state.cardPool);

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    if (company.destinationSite !== null) continue;

    const currentSiteDef = resolveDef(state, company.currentSite.instanceId);
    if (!currentSiteDef || !isSiteCard(currentSiteDef)) continue;

    // Build candidate sites from the player's site deck
    const candidateSites: SiteCard[] = [];
    const siteInstMap = new Map<string, CardInstanceId>();
    for (const siteCard of player.siteDeck) {
      const siteDef = state.cardPool[siteCard.definitionId as string];
      if (!siteDef || !isSiteCard(siteDef)) continue;
      candidateSites.push(siteDef);
      siteInstMap.set(siteDef.name, siteCard.instanceId);
    }

    // Gwaihir special movement: can reach any non-shadow/dark site
    if (company.specialMovement === 'gwaihir') {
      const regionTypeMap = buildRegionTypeMap(state);
      logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: Gwaihir special movement — filtering sites`);
      for (const siteDef of candidateSites) {
        const destInstId = siteInstMap.get(siteDef.name);
        if (!destInstId) continue;
        // Exclude sites in Shadow-land (shadow) or Dark-domain (dark) regions
        const regionType = siteDef.region ? regionTypeMap.get(siteDef.region) : undefined;
        if (regionType === 'shadow' || regionType === 'dark') {
          logDetail(`  ${siteDef.name} in ${siteDef.region} (${regionType}) — excluded by Gwaihir`);
          continue;
        }
        logDetail(`  ${siteDef.name} in ${siteDef.region ?? '?'} (${regionType ?? '?'}) — reachable via Gwaihir`);
        const candidate: GameAction = {
          type: 'plan-movement',
          player: playerId,
          companyId: company.id,
          destinationSite: destInstId,
        };
        const regress = isRegressive(candidate, state.reverseActions);
        actions.push({
          action: { ...candidate, ...(regress ? { regress: true } : {}) },
          viable: true,
        });
      }
      continue;
    }

    const effectiveMaxRegions = BASE_MAX_REGION_DISTANCE + (company.extraRegionDistance ?? 0);
    const reachable = getReachableSites(movementMap, currentSiteDef, candidateSites, effectiveMaxRegions);
    // Deduplicate: a site reachable by both starter and region movement only needs one action
    const seen = new Set<string>();
    logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: ${reachable.length} reachable site(s)`);

    for (const r of reachable) {
      const destInstId = siteInstMap.get(r.site.name);
      if (!destInstId) continue;
      if (seen.has(destInstId as string)) continue;
      seen.add(destInstId as string);
      const candidate: GameAction = {
        type: 'plan-movement',
        player: playerId,
        companyId: company.id,
        destinationSite: destInstId,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Builds a map from region name to its region type by scanning the card pool.
 * Used to check whether a site's region is shadow-land, dark-domain, etc.
 */
function buildRegionTypeMap(state: GameState): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, card] of Object.entries(state.cardPool)) {
    if (card.cardType === 'region') {
      map.set(card.name, (card as { regionType: string }).regionType);
    }
  }
  return map;
}

/**
 * Computes move-to-influence actions during the organization phase.
 *
 * Two types of influence reassignment (CoE rules lines 227-228):
 *
 * 1. **To DI (become follower)**: A non-avatar character under GI, who has
 *    no followers themselves, can be moved under the DI of a non-follower
 *    character in the same company. The character's mind must not exceed
 *    the controller's available direct influence.
 *
 * 2. **To GI (un-follow)**: A follower can be moved to general influence,
 *    provided the total non-follower mind would not exceed the player's
 *    maximum general influence.
 */
export function moveToInfluenceActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      const isAvatar = charDef.mind === null;

      if (char.controlledBy === 'general' && !isAvatar && char.followers.length === 0) {
        // Rule 227: Move non-avatar character without followers to DI of a
        // non-follower character in the same company
        for (const ctrlInstId of company.characters) {
          if (ctrlInstId === charInstId) continue;
          const ctrl = player.characters[ctrlInstId as string];
          if (!ctrl) continue;
          // Controller must be under GI (non-follower)
          if (ctrl.controlledBy !== 'general') continue;
          const avail = availableDI(state, ctrl.instanceId, player, charDef);
          if (avail >= charDef.mind) {
            const ctrlDef = resolveDef(state, ctrl.instanceId);
            const ctrlName = isCharacterCard(ctrlDef) ? ctrlDef.name : '?';
            logDetail(`  → viable: move ${charDef.name} (mind ${charDef.mind}) under DI of ${ctrlName} (avail DI ${avail})`);
            const candidate: GameAction = {
              type: 'move-to-influence',
              player: playerId,
              characterInstanceId: charInstId,
              controlledBy: ctrlInstId,
            };
            const regress = isRegressive(candidate, state.reverseActions);
            actions.push({
              action: { ...candidate, ...(regress ? { regress: true } : {}) },
              viable: true,
            });
          }
        }
      } else if (char.controlledBy !== 'general') {
        // Rule 228: Move a follower to general influence if GI allows
        const remainingGI = GENERAL_INFLUENCE - player.generalInfluenceUsed;
        if (charDef.mind !== null && charDef.mind <= remainingGI) {
          logDetail(`  → viable: move ${charDef.name} (mind ${charDef.mind}) to GI (remaining GI ${remainingGI})`);
          const candidate: GameAction = {
            type: 'move-to-influence',
            player: playerId,
            characterInstanceId: charInstId,
            controlledBy: 'general',
          };
          const regress = isRegressive(candidate, state.reverseActions);
          actions.push({
            action: { ...candidate, ...(regress ? { regress: true } : {}) } as GameAction,
            viable: true,
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Computes transfer-item actions during the organization phase.
 *
 * Per CoE rules (2.II.5), items can be transferred between two characters
 * at the same site (not necessarily in the same company). After the transfer,
 * the initial bearer must make a corruption check — the reducer enqueues a
 * {@link PendingResolution} of kind `corruption-check` via the unified
 * pending-resolution system; that resolution gates all other organization
 * actions until it is resolved.
 *
 * Emits one viable action per valid (item, fromCharacter, toCharacter) triple.
 */
export function transferItemActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build a map from site instance ID → list of character instance IDs at that site
  const siteToCharacters = new Map<string, CardInstanceId[]>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite.instanceId as string;
    const existing = siteToCharacters.get(siteKey) ?? [];
    existing.push(...company.characters);
    siteToCharacters.set(siteKey, existing);
  }

  // For each character with items, find valid transfer targets at the same site
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite.instanceId as string;
    const charsAtSite = siteToCharacters.get(siteKey) ?? [];

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char || char.items.length === 0) continue;

      const charDef = resolveDef(state, char.instanceId);
      const charName = isCharacterCard(charDef) ? charDef.name : '?';

      for (const item of char.items) {
        const itemDef = state.cardPool[item.definitionId as string];
        const itemName = itemDef?.name ?? '?';

        for (const targetInstId of charsAtSite) {
          if (targetInstId === charInstId) continue;
          const target = player.characters[targetInstId as string];
          if (!target) continue;

          const targetDef = resolveDef(state, target.instanceId);
          const targetName = isCharacterCard(targetDef) ? targetDef.name : '?';

          logDetail(`  → viable: transfer ${itemName} from ${charName} to ${targetName}`);
          const candidate: GameAction = {
            type: 'transfer-item',
            player: playerId,
            itemInstanceId: item.instanceId,
            fromCharacterId: charInstId,
            toCharacterId: targetInstId,
          };
          const regress = isRegressive(candidate, state.reverseActions);
          actions.push({
            action: { ...candidate, ...(regress ? { regress: true } : {}) },
            viable: true,
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Computes split-company actions during the organization phase.
 *
 * A character under general influence (with no restriction on having followers)
 * can split off from their company to form a new company at the same site.
 * The character's followers automatically accompany them. The source company
 * must retain at least one GI character after the split.
 *
 * Emits one action per GI character that can legally split off. Followers
 * move automatically with their host in the reducer.
 */
export function splitCompanyActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    if (!company.currentSite) continue;

    // Count GI characters (non-followers) in this company
    const giChars = company.characters.filter(id => {
      const c = player.characters[id as string];
      return c && c.controlledBy === 'general';
    });

    // Need at least 2 GI characters to split (one stays, one leaves)
    if (giChars.length < 2) continue;

    for (const charInstId of giChars) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      logDetail(`  → viable: split ${charDef.name} (+ ${char.followers.length} followers) from ${company.id as string}`);
      const candidate: GameAction = {
        type: 'split-company',
        player: playerId,
        sourceCompanyId: company.id,
        characterId: charInstId,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Computes move-to-company actions during the organization phase.
 *
 * A character under general influence can move to a different company at
 * the same site. Their followers automatically accompany them. The source
 * company must retain at least one GI character after the move.
 *
 * Emits one action per valid (character, targetCompany) pair.
 */
export function moveToCompanyActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build map from site definition ID → companies at that site
  const siteToCompanies = new Map<string, typeof player.companies[number][]>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite.instanceId as string;
    const existing = siteToCompanies.get(siteKey) ?? [];
    existing.push(company);
    siteToCompanies.set(siteKey, existing);
  }

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const companiesAtSite = siteToCompanies.get(company.currentSite.instanceId as string) ?? [];
    if (companiesAtSite.length < 2) continue;

    // Count GI characters in this company
    const giChars = company.characters.filter(id => {
      const c = player.characters[id as string];
      return c && c.controlledBy === 'general';
    });

    // Need at least 2 GI characters so one can leave and one stays
    if (giChars.length < 2) continue;

    for (const charInstId of giChars) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      for (const targetCompany of companiesAtSite) {
        if (targetCompany.id === company.id) continue;

        logDetail(`  → viable: move ${charDef.name} from ${company.id as string} to ${targetCompany.id as string}`);
        const candidate: GameAction = {
          type: 'move-to-company',
          player: playerId,
          characterInstanceId: charInstId,
          sourceCompanyId: company.id,
          targetCompanyId: targetCompany.id,
        };
        const regress = isRegressive(candidate, state.reverseActions);
        actions.push({
          action: { ...candidate, ...(regress ? { regress: true } : {}) },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Computes merge-companies actions during the organization phase.
 *
 * Two companies at the same site can be merged into one. All characters
 * from the source company move into the target company, and the source
 * company is dissolved. This increases the combined company's hazard limit
 * but consolidates combat strength.
 *
 * Emits one action per valid (sourceCompany, targetCompany) pair at the same site.
 */
export function mergeCompaniesActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId)!;
  const actions: EvaluatedAction[] = [];

  // Build map from site instance ID → companies at that site
  const siteToCompanies = new Map<string, typeof player.companies[number][]>();
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteKey = company.currentSite.instanceId as string;
    const existing = siteToCompanies.get(siteKey) ?? [];
    existing.push(company);
    siteToCompanies.set(siteKey, existing);
  }

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const companiesAtSite = siteToCompanies.get(company.currentSite.instanceId as string) ?? [];
    if (companiesAtSite.length < 2) continue;

    for (const targetCompany of companiesAtSite) {
      if (targetCompany.id === company.id) continue;

      logDetail(`  → viable: merge company ${company.id as string} into ${targetCompany.id as string}`);
      const candidate: GameAction = {
        type: 'merge-companies',
        player: playerId,
        sourceCompanyId: company.id,
        targetCompanyId: targetCompany.id,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) },
        viable: true,
      });
    }
  }

  return actions;
}
