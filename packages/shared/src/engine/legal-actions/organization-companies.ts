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
  PlayerState,
  CardEffect,
  CompanyId,
} from '../../index.js';
import { GENERAL_INFLUENCE, isCharacterCard, isItemCard, isSiteCard, buildMovementMap, getReachableSites, BASE_MAX_REGION_DISTANCE, hasNoDirectInfluenceRestriction, SiteType, Race, RegionType, isAvatarCharacter, Skill } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { logDetail } from './log.js';
import { playerById, defById, getCardEffects } from '../reducer-utils.js';
import { resolveDef } from '../effects/index.js';
import { isRegressive } from '../reverse-actions.js';
import { availableDI } from './organization.js';

/**
 * Look up a site card definition by site name, scanning the card pool.
 * Returns undefined if no matching site is found.
 */
function findSiteByName(state: GameState, name: string): SiteCard | undefined {
  for (const def of Object.values(state.cardPool)) {
    if (isSiteCard(def) && def.name === name) return def;
  }
  return undefined;
}

/**
 * Resolve a site name against one site card's `adjacentSites` map.
 *
 * Handles wildcard keys of the form `"*region:<RegionName>"`: if a key
 * starts with `*region:`, the target site's region is looked up and
 * compared to `<RegionName>`. Returns the required roll, or `undefined`
 * if the target is not listed as adjacent on the given site card.
 */
export function resolveAdjacency(state: GameState, site: SiteCard, targetName: string): number | undefined {
  const adj = site.adjacentSites;
  if (!adj) return undefined;

  // Direct name match
  if (adj[targetName] !== undefined) return adj[targetName];

  // Wildcard: "*region:<regionName>"
  for (const [key, roll] of Object.entries(adj)) {
    if (!key.startsWith('*region:')) continue;
    const regionName = key.slice('*region:'.length);
    const targetCard = findSiteByName(state, targetName);
    if (targetCard?.region === regionName) return roll;
  }
  return undefined;
}

/**
 * Check whether two sites are Under-deeps-adjacent in either direction.
 *
 * Returns true when either site's `adjacentSites` lists the other (or
 * matches via a wildcard region key). At least one of the two sites must
 * carry the `under-deeps` keyword for the result to be meaningful.
 */
export function isUnderDeepsAdjacent(state: GameState, origin: SiteCard, dest: SiteCard): boolean {
  if (resolveAdjacency(state, origin, dest.name) !== undefined) return true;
  if (resolveAdjacency(state, dest, origin.name) !== undefined) return true;
  return false;
}

/**
 * Collect all sites reachable via Under-deeps movement from the given
 * current site. At least one side of each pair must carry the
 * `under-deeps` keyword; adjacency is checked bidirectionally.
 */
function getUnderDeepsReachable(state: GameState, currentSiteDef: SiteCard, candidateSites: readonly SiteCard[]): SiteCard[] {
  const currentIsUD = currentSiteDef.keywords?.includes('under-deeps') ?? false;
  const results: SiteCard[] = [];

  for (const dest of candidateSites) {
    if (dest.name === currentSiteDef.name) continue;
    const destIsUD = dest.keywords?.includes('under-deeps') ?? false;

    // At least one side must be Under-deeps
    if (!currentIsUD && !destIsUD) continue;

    if (isUnderDeepsAdjacent(state, currentSiteDef, dest)) {
      results.push(dest);
    }
  }
  return results;
}

/**
 * Returns true if a Ringwraith company has a mode card (Black Rider,
 * Fell Rider, or Heralded Lord) bound to it via `cardsInPlay`.
 *
 * Mode cards are permanent-event resources with a `ringwraith-mode` effect.
 * They are bound to the company via `CardInPlay.companyId`. Without a mode
 * card the Ringwraith may only move Darkhaven-to-Darkhaven (MELE §1.2).
 */
function ringwraithHasModeCard(
  state: GameState,
  company: { readonly id: import('../../index.js').CompanyId },
  player: PlayerState,
): boolean {
  for (const card of player.cardsInPlay) {
    if (card.companyId !== company.id) continue;
    const def = defById(state, card.definitionId);
    if (!def) continue;
    if (getCardEffects(def).some(e => e.type === 'ringwraith-mode')) return true;
  }
  return false;
}

/**
 * Returns the total passive movement bonus (extra regions) granted to a company
 * by allies carrying a `passive-movement-bonus` effect whose condition is met.
 *
 * The bonus applies when every character in the company has at least one ally
 * whose name is in the effect's `allyNames` list. Duplicate effects (same value
 * + same allyNames) are de-duplicated; the result is the max unique bonus found.
 */
function collectPassiveMovementBonus(
  state: GameState,
  characterIds: readonly CardInstanceId[],
  player: PlayerState,
): number {
  const seenKeys = new Set<string>();
  let bonus = 0;

  for (const charId of characterIds) {
    const char = player.characters[charId as string];
    if (!char) continue;

    for (const ally of char.allies) {
      const allyDef = state.cardPool[ally.definitionId as string] as { effects?: readonly CardEffect[] } | undefined;
      if (!allyDef?.effects) continue;

      for (const eff of allyDef.effects) {
        if (eff.type !== 'passive-movement-bonus') continue;
        const key = `${eff.value}:${eff.allyNames.slice().sort().join(',')}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const allQualify = characterIds.every(cId => {
          const c = player.characters[cId as string];
          return c?.allies.some(a => {
            const aDef = state.cardPool[a.definitionId as string] as { name?: string } | undefined;
            return aDef?.name !== undefined && eff.allyNames.includes(aDef.name);
          });
        });

        if (allQualify) {
          logDetail(`Passive movement bonus +${eff.value} regions: all company characters have a qualifying ally`);
          bonus = Math.max(bonus, eff.value);
        }
      }
    }
  }

  return bonus;
}

/**
 * Computes plan-movement actions for each company.
 * For every company, emits one viable action per reachable site in the player's
 * site deck, determined by the movement map (starter and region movement),
 * plus Under-deeps movement when applicable.
 * Companies that already have a destination planned are skipped.
 */
export function planMovementActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
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
      const siteDef = defById(state, siteCard.definitionId);
      if (!siteDef || !isSiteCard(siteDef)) continue;
      candidateSites.push(siteDef);
      siteInstMap.set(siteDef.name, siteCard.instanceId);
    }

    // Rule 3.37 / 3.39: a company may declare movement to a site card that
    // this player already has in play, either:
    //   (a) as another company's currentSite, or
    //   (b) as another company's pending destinationSite (face-down movement
    //       already declared this organization phase).
    // Such a destination is not drawn from the site deck; the card instance
    // is shared.
    for (const sibling of player.companies) {
      if (sibling.id === company.id) continue;
      const siblingSites = [sibling.currentSite, sibling.destinationSite];
      for (const siblingSite of siblingSites) {
        if (!siblingSite) continue;
        if (siblingSite.instanceId === company.currentSite.instanceId) continue;
        const siblingDef = defById(state, siblingSite.definitionId);
        if (!siblingDef || !isSiteCard(siblingDef)) continue;
        // Deck entries win — if the same site name is already a deck candidate,
        // keep the deck instance as the canonical choice. Likewise, once we've
        // added a sibling-in-play entry for this name we don't add a second
        // (e.g. currentSite wins over destinationSite if both siblings reference
        // the same site name via different instances, though in practice they
        // share the instance once movement resolves).
        if (siteInstMap.has(siblingDef.name)) continue;
        candidateSites.push(siblingDef);
        siteInstMap.set(siblingDef.name, siblingSite.instanceId);
        logDetail(`  sibling-in-play destination ${siblingDef.name} via company ${sibling.id as string}`);
      }
    }

    // Rule 2.II.7.1: no two companies sharing an origin may declare movement
    // to the same new site during one organization phase. Drop any candidate
    // whose definition is already another sibling-at-same-origin's
    // destinationSite. Compare by definitionId, not instanceId, because two
    // companies at the same named site may hold different card instances.
    const blockedByRule_2_II_7_1 = new Set<string>(); // definitionIds
    for (const sibling of player.companies) {
      if (sibling.id === company.id) continue;
      if (!sibling.currentSite) continue;
      if (sibling.currentSite.definitionId !== company.currentSite.definitionId) continue;
      if (sibling.destinationSite) {
        blockedByRule_2_II_7_1.add(sibling.destinationSite.definitionId as string);
      }
    }

    // Gwaihir special movement: can reach any non-shadow/dark site
    if (company.specialMovement === 'gwaihir') {
      const regionTypeMap = buildRegionTypeMap(state);
      logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: Gwaihir special movement — filtering sites`);
      for (const siteDef of candidateSites) {
        const destInstId = siteInstMap.get(siteDef.name);
        if (!destInstId) continue;
        if (blockedByRule_2_II_7_1.has(siteDef.id)) {
          logDetail(`  ${siteDef.name} blocked by rule 2.II.7.1 (sibling at same origin already targets it)`);
          continue;
        }
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

    const effectiveMaxRegions = BASE_MAX_REGION_DISTANCE + (company.extraRegionDistance ?? 0) + collectPassiveMovementBonus(state, company.characters, player);
    const currentIsUD = currentSiteDef.keywords?.includes('under-deeps') ?? false;
    // Under-deeps sites are only reachable via under-deeps movement (handled below), never via
    // regular starter/region movement. When already at an under-deeps site, regular movement
    // does not apply at all.
    const regularCandidates = currentIsUD ? [] : candidateSites.filter(s => !(s.keywords?.includes('under-deeps') ?? false));
    let reachable = getReachableSites(movementMap, currentSiteDef, regularCandidates, effectiveMaxRegions);

    // MELE §1.2: Ringwraith movement restrictions.
    // Check whether this company has a Ringwraith avatar.
    const hasRingwraithAvatar = player.alignment === 'ringwraith' && company.characters.some(cId => {
      const char = player.characters[cId as string];
      if (!char) return false;
      const def = defById(state, char.definitionId);
      return def && isCharacterCard(def) && isAvatarCharacter(def) && def.race === Race.Ringwraith;
    });

    if (hasRingwraithAvatar) {
      const hasModeCard = ringwraithHasModeCard(state, company, player);

      // Gate: without a mode card, Ringwraith may only move to Darkhaven (siteType: haven).
      if (!hasModeCard) {
        const before = reachable.length;
        reachable = reachable.filter(r => r.site.siteType === SiteType.Haven);
        logDetail(`Company ${company.id as string}: Ringwraith has no mode card — restricted to Darkhaven destinations (${before} → ${reachable.length})`);
      }

      // Ringwraith companies may never move through Coastal Seas regions (MELE §1.1).
      const beforeCoastal = reachable.length;
      reachable = reachable.filter(r => !(r.site.sitePath ?? []).includes(RegionType.Coastal));
      if (reachable.length !== beforeCoastal) {
        logDetail(`Company ${company.id as string}: filtered out ${beforeCoastal - reachable.length} Coastal Seas destination(s) for Ringwraith`);
      }
    }

    // Deduplicate: a site reachable by both starter and region movement only needs one action
    const seen = new Set<string>();
    logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: ${reachable.length} reachable site(s)`);

    for (const r of reachable) {
      const destInstId = siteInstMap.get(r.site.name);
      if (!destInstId) continue;
      if (seen.has(destInstId as string)) continue;
      seen.add(destInstId as string);
      if (blockedByRule_2_II_7_1.has(r.site.id)) {
        logDetail(`  ${r.site.name} blocked by rule 2.II.7.1 (sibling at same origin already targets it)`);
        continue;
      }
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

    // --- Under-deeps movement pass ---
    const udReachable = getUnderDeepsReachable(state, currentSiteDef, candidateSites);
    logDetail(`Company ${company.id as string} at ${currentSiteDef.name}: ${udReachable.length} Under-deeps destination(s)`);
    for (const dest of udReachable) {
      const destInstId = siteInstMap.get(dest.name);
      if (!destInstId) continue;
      if (seen.has(destInstId as string)) continue;
      seen.add(destInstId as string);
      if (blockedByRule_2_II_7_1.has(dest.id)) {
        logDetail(`  ${dest.name} blocked by rule 2.II.7.1 (sibling at same origin already targets it)`);
        continue;
      }
      logDetail(`  Under-deeps destination: ${dest.name}`);
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
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;

      const isAvatar = charDef.mind === null;

      if (char.controlledBy === 'general' && !isAvatar && char.followers.length === 0) {
        // Block DI assignment when an attached hazard forbids it (e.g. Rebel-talk)
        if (hasNoDirectInfluenceRestriction(char.hazards, state.cardPool)) {
          logDetail(`  → blocked: ${charDef.name} has no-direct-influence restriction`);
        } else
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
  const player = playerById(state, playerId)!;
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
        const itemDef = defById(state, item.definitionId);
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

/** Regular item subtypes (minor/major/greater) that are storable at any Haven per CoE rule 2.II.4. */
const REGULAR_ITEM_SUBTYPES = new Set(['minor', 'major', 'greater']);

/**
 * Computes store-item actions during the organization phase.
 *
 * Two categories of items are storable (CoE rule 2.II.4):
 *
 * 1. **Regular items** (subtype minor, major, or greater) without an explicit
 *    `storable-at` restriction: storable at any Haven site.
 * 2. **Items with a `storable-at` effect**: storable only at sites whose name
 *    appears in the effect's `sites` list, or whose type appears in
 *    `siteTypes`. This covers special items (e.g. Rescue Prisoners) and
 *    items with alternative storage sites (e.g. Sapling of the White Tree).
 *
 * After storage, the initial bearer must make a corruption check.
 * Emits one action per valid (item, character) pair.
 */
export function storeItemActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const company of player.companies) {
    if (!company.currentSite) continue;

    const siteDef = resolveDef(state, company.currentSite.instanceId);
    if (!siteDef || !isSiteCard(siteDef)) continue;
    const siteName = siteDef.name;
    const siteType = siteDef.siteType;

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char || char.items.length === 0) continue;

      const charDef = resolveDef(state, char.instanceId);
      const charName = isCharacterCard(charDef) ? charDef.name : '?';

      for (const item of char.items) {
        const itemDef = defById(state, item.definitionId);
        if (!itemDef) continue;

        const effects = ('effects' in itemDef)
          ? (itemDef as { effects?: readonly { type: string; sites?: readonly string[]; siteTypes?: readonly string[] }[] }).effects
          : undefined;
        const storableEffect = effects?.find(e => e.type === 'storable-at');

        let isStorable = false;
        if (storableEffect) {
          const siteNameMatch = storableEffect.sites?.includes(siteName) ?? false;
          const siteTypeMatch = storableEffect.siteTypes?.includes(siteType) ?? false;
          isStorable = siteNameMatch || siteTypeMatch;
        } else if (isItemCard(itemDef) && siteType === 'haven') {
          isStorable = REGULAR_ITEM_SUBTYPES.has(itemDef.subtype);
        }

        if (!isStorable) continue;

        const itemName = itemDef.name ?? '?';
        logDetail(`  → viable: store ${itemName} from ${charName} at ${siteName}`);
        actions.push({
          action: {
            type: 'store-item',
            player: playerId,
            itemInstanceId: item.instanceId,
            characterId: charInstId,
          },
          viable: true,
        });
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
  const player = playerById(state, playerId)!;
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

      // Validate all followers are actually in this company (guards against stale state)
      const followersInCompany = char.followers.every(f => company.characters.some(c => c === f));
      if (!followersInCompany) {
        logDetail(`  → skip: ${charDef.name} has followers not in this company (stale state)`);
        continue;
      }

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
  const player = playerById(state, playerId)!;
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

        const atHaven = companyAtHaven(state, targetCompany);
        const resultingCharIds = [...targetCompany.characters, charInstId];

        // Rules 3.24–3.26 apply only at non-haven sites.
        if (!atHaven) {
          const resultingSize = effectiveSize(state, resultingCharIds);
          if (resultingSize > 7) {
            logDetail(`  → skip: move ${charDef.name} to ${targetCompany.id as string} — would exceed size limit (${resultingSize} > 7)`);
            continue;
          }
          if (wouldViolateRaceMixing(state, resultingCharIds)) {
            logDetail(`  → skip: move ${charDef.name} to ${targetCompany.id as string} — race-mixing restriction (rule 3.25)`);
            continue;
          }
          if (wouldViolateLeaderRestriction(state, resultingCharIds, targetCompany.id)) {
            logDetail(`  → skip: move ${charDef.name} to ${targetCompany.id as string} — leader restriction (rule 3.26)`);
            continue;
          }
        }

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
/**
 * Check whether a company's current site is a haven.
 * Havens exempt companies from size limits, race-mixing, and leader restrictions.
 */
function companyAtHaven(state: GameState, company: { currentSite?: { instanceId: CardInstanceId } | null }): boolean {
  if (!company.currentSite) return false;
  const siteDefId = resolveInstanceId(state, company.currentSite.instanceId);
  if (!siteDefId) return false;
  const siteDef = defById(state, siteDefId);
  return !!(siteDef && isSiteCard(siteDef) && siteDef.siteType === SiteType.Haven);
}

/**
 * Compute effective company size per CoE rule 3.24.
 * Hobbits and Orc scouts each count as half a character (total rounded up).
 */
function effectiveSize(state: GameState, charInstIds: readonly CardInstanceId[]): number {
  let halfCount = 0;
  let fullCount = 0;
  for (const charInstId of charInstIds) {
    const defId = resolveInstanceId(state, charInstId);
    const def = defId ? defById(state, defId) : undefined;
    if (!def || !isCharacterCard(def)) { fullCount++; continue; }
    const isHobbit = def.race === Race.Hobbit;
    const isOrcScout = def.race === Race.Orc && def.skills.includes(Skill.Scout);
    if (isHobbit || isOrcScout) halfCount++;
    else fullCount++;
  }
  return Math.ceil(fullCount + halfCount / 2);
}

/** The MECCG races that cannot mix with Orcs/Trolls (CoE rule 3.25). */
const HERO_RACES = new Set<Race>([Race.Dunadan, Race.Dwarf, Race.Elf, Race.Hobbit]);
/** The MECCG races that cannot mix with hero races (CoE rule 3.25). */
const DARK_RACES = new Set<Race>([Race.Orc, Race.Troll]);

/**
 * Check if combining the given characters would violate the race-mixing
 * restriction (CoE rule 3.25): Dúnedain, Dwarves, Elves, and Hobbits
 * cannot be in the same company as Orcs and Trolls.
 */
function wouldViolateRaceMixing(state: GameState, charInstIds: readonly CardInstanceId[]): boolean {
  let hasHeroRace = false;
  let hasDarkRace = false;
  for (const id of charInstIds) {
    const defId = resolveInstanceId(state, id);
    const def = defId ? defById(state, defId) : undefined;
    if (!def || !isCharacterCard(def)) continue;
    if (HERO_RACES.has(def.race)) hasHeroRace = true;
    if (DARK_RACES.has(def.race)) hasDarkRace = true;
  }
  return hasHeroRace && hasDarkRace;
}

/**
 * Check if the given characters would violate the leader restriction
 * (CoE rule 3.26): a company may only contain one Leader-keyword character.
 *
 * When `companyId` is provided, checks whether the target company has a
 * company-bound permanent event with `extra-troll-leader-slot` (e.g. *Orders
 * from Lugbúrz*), which allows one Troll Leader in addition to one other
 * leader (total of two leaders, one of which must be a Troll).
 */
function wouldViolateLeaderRestriction(
  state: GameState,
  charInstIds: readonly CardInstanceId[],
  companyId?: CompanyId,
): boolean {
  let leaderCount = 0;
  let trollLeaderCount = 0;
  for (const id of charInstIds) {
    const defId = resolveInstanceId(state, id);
    const def = defId ? defById(state, defId) : undefined;
    if (!def || !isCharacterCard(def)) continue;
    // Natural Leader keyword on the character card
    let isLeader = def.keywords?.includes('Leader') ?? false;
    // Also check attached items for grant-keyword: 'Leader' effects
    if (!isLeader) {
      for (const player of state.players) {
        const char = player.characters[id as string];
        if (!char) continue;
        for (const item of char.items) {
          const itemDef = state.cardPool[item.definitionId as string];
          const effects = getCardEffects(itemDef);
          if (effects.some(e => e.type === 'grant-keyword' && (e as { keyword: string }).keyword === 'Leader')) {
            isLeader = true;
          }
        }
        break;
      }
    }
    if (isLeader) {
      leaderCount++;
      if (def.race === Race.Troll) trollLeaderCount++;
    }
  }

  if (leaderCount <= 1) return false;

  // When the company has an extra-troll-leader-slot permanent event, one Troll
  // leader is permitted alongside one other leader (total two leaders allowed).
  if (companyId && leaderCount === 2 && trollLeaderCount >= 1) {
    const hasExtraSlot = state.players.some(p =>
      p.cardsInPlay.some(card => {
        if ((card.companyId as string | undefined) !== (companyId as string)) return false;
        const def = state.cardPool[card.definitionId as string];
        return getCardEffects(def).some(e => e.type === 'extra-troll-leader-slot');
      }),
    );
    if (hasExtraSlot) {
      logDetail(`wouldViolateLeaderRestriction: extra-troll-leader-slot active on company ${companyId as string} — allowing Troll leader alongside other leader`);
      return false;
    }
  }

  return leaderCount > 1;
}

export function mergeCompaniesActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
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

      const atHaven = companyAtHaven(state, targetCompany);
      const mergedCharIds = [...targetCompany.characters, ...company.characters];

      // Rules 3.24–3.26 apply only at non-haven sites.
      if (!atHaven) {
        const mergedSize = effectiveSize(state, mergedCharIds);
        if (mergedSize > 7) {
          logDetail(`  → skip: merge ${company.id as string} into ${targetCompany.id as string} — would exceed size limit (${mergedSize} > 7)`);
          continue;
        }
        if (wouldViolateRaceMixing(state, mergedCharIds)) {
          logDetail(`  → skip: merge ${company.id as string} into ${targetCompany.id as string} — race-mixing restriction (rule 3.25)`);
          continue;
        }
        if (wouldViolateLeaderRestriction(state, mergedCharIds, targetCompany.id)) {
          logDetail(`  → skip: merge ${company.id as string} into ${targetCompany.id as string} — leader restriction (rule 3.26)`);
          continue;
        }
      }

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
