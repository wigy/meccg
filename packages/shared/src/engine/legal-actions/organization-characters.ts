/**
 * @module legal-actions/organization-characters
 *
 * Character recruitment actions during the organization phase. Evaluates each
 * character card in the active player's hand against CoE rules for play eligibility:
 * uniqueness, site availability, and influence constraints (general and direct).
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  CharacterCard,
  OrganizationPhaseState,
  SiteCard,
} from '../../index.js';
import { GENERAL_INFLUENCE, SiteType, isCharacterCard, isSiteCard, hasPlayFlag } from '../../index.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import { findPlayerAvatar } from '../reducer-utils.js';
import { availableDI } from './organization.js';

/**
 * Returns true if the character declares the `home-site-only` play-flag.
 * During normal play from hand the context reason is always "play-character",
 * so the flag's optional `when` gate is ignored here — the flag is treated
 * as always active on this code path.
 */
function hasHomeSiteOnlyRestriction(charDef: CharacterCard): boolean {
  return hasPlayFlag(charDef, 'home-site-only');
}

/**
 * Returns true if the player has an eliminated avatar (a character with
 * `mind === null` in their outOfPlayPile). CoE rule 2.05 forbids revealing
 * a replacement avatar in this case.
 */
function hasEliminatedAvatar(
  state: GameState,
  player: { readonly outOfPlayPile: readonly import('../../index.js').CardInstance[] },
): boolean {
  return player.outOfPlayPile.some(c => {
    const def = state.cardPool[c.definitionId as string];
    return isCharacterCard(def) && def.mind === null;
  });
}

/**
 * Finds all sites where a character could potentially be played.
 *
 * Returns site instance IDs matching the character's homesite name or
 * havens. Sources include both company current sites (where a company
 * already exists) and the player's site deck (where a new company would
 * be formed).
 *
 * Characters with a `home-site-only` play-restriction (e.g. Frodo, Sam) can
 * only be played at their homesite, not at havens.
 *
 * Rule 2.II.2.2: if the player's avatar is in play, non-avatar characters
 * can only be played at the avatar's current site or under DI with an
 * existing company. When {@link avatarInPlay} is true, sites from the site
 * deck are excluded (only company current sites are returned).
 */
function findPlayableSites(
  state: GameState,
  player: {
    readonly companies: readonly import('../../index.js').Company[];
    readonly siteDeck: readonly import('../../index.js').CardInstance[];
  },
  charDef: CharacterCard,
  avatarInPlay: boolean,
): { instanceId: CardInstanceId; siteDef: SiteCard; siteName: string }[] {
  const results: { instanceId: CardInstanceId; siteDef: SiteCard; siteName: string }[] = [];
  const seenInstances = new Set<string>();
  const seenSiteNames = new Set<string>();
  const homeSiteOnly = hasHomeSiteOnlyRestriction(charDef);

  if (homeSiteOnly) {
    logDetail(`  play-restriction: ${charDef.name} has home-site-only — havens excluded`);
  }

  // Sites where the player already has a company
  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteId = company.currentSite.instanceId;
    if (seenInstances.has(siteId as string)) continue;
    seenInstances.add(siteId as string);

    const siteDef = resolveDef(state, siteId);
    if (!isSiteCard(siteDef)) continue;

    const isHaven = siteDef.siteType === SiteType.Haven;
    const isHomesite = siteDef.name === charDef.homesite;

    if (homeSiteOnly ? isHomesite : (isHaven || isHomesite)) {
      results.push({ instanceId: siteId, siteDef, siteName: siteDef.name });
      seenSiteNames.add(siteDef.name);
    }
  }

  // Sites available in the player's site deck (character forms a new company).
  // Rule 2.II.2.2: when the avatar is in play, characters can only be played
  // at the avatar's current site or under DI — skip site deck entirely.
  // Deduplicate by site name: multiple copies of the same site in the deck
  // should only produce one legal action (using the first matching instance).
  if (avatarInPlay) {
    logDetail(`  avatar in play — site deck excluded (rule 2.II.2.2)`);
  }
  for (const siteCard of avatarInPlay ? [] : player.siteDeck) {
    const siteDef = state.cardPool[siteCard.definitionId as string];
    if (!siteDef || !isSiteCard(siteDef)) continue;
    if (seenSiteNames.has(siteDef.name)) continue;

    const isHaven = siteDef.siteType === SiteType.Haven;
    const isHomesite = siteDef.name === charDef.homesite;

    if (homeSiteOnly ? isHomesite : (isHaven || isHomesite)) {
      results.push({ instanceId: siteCard.instanceId, siteDef, siteName: siteDef.name });
      seenSiteNames.add(siteDef.name);
    }
  }

  return results;
}

/**
 * Checks whether a unique character with the given name is already in play
 * across any player.
 */
function isUniqueCharacterInPlay(state: GameState, charName: string): boolean {
  for (const p of state.players) {
    for (const char of Object.values(p.characters)) {
      const def = resolveDef(state, char.instanceId);
      if (isCharacterCard(def) && def.name === charName) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Generates play-character evaluated actions for each character in the
 * active player's hand. Each character is checked against:
 *
 * 1. Must be organization phase and active player's turn.
 * 2. Only one character play allowed per turn.
 * 3. Card must be a character card.
 * 4. If unique, must not already be in play (either player).
 * 5. Must have a matching site available (homesite or haven) — either
 *    where a company already exists or in the player's site deck.
 * 6. Must fit under general influence (mind ≤ remaining GI) or under
 *    direct influence of a character with enough unused DI.
 */
export function playCharacterActions(
  state: GameState,
  playerId: PlayerId,
): EvaluatedAction[] {
  const phaseState = state.phaseState as OrganizationPhaseState;
  const player = state.players.find(p => p.id === playerId)!;
  const results: EvaluatedAction[] = [];

  // Rule 2.II.2.2: detect if the player's avatar is in play
  const avatar = findPlayerAvatar(state, player);
  const avatarCompany = avatar
    ? player.companies.find(c => c.characters.includes(avatar.instanceId))
    : undefined;
  const avatarSiteId: CardInstanceId | null = avatarCompany?.currentSite?.instanceId ?? null;
  const avatarInPlay = avatarSiteId !== null;
  if (avatarInPlay) {
    logDetail(`Avatar in play at site ${avatarSiteId as string} — character play restricted (rule 2.II.2.2)`);
  }

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const cardDef = state.cardPool[handCard.definitionId as string];
    if (!isCharacterCard(cardDef)) continue;

    const charName = cardDef.name;
    const isAvatar = cardDef.mind === null;

    logDetail(`Evaluating play-character: ${charName} (mind ${cardDef.mind ?? 'avatar'}, DI ${cardDef.directInfluence})`);

    // Rule: only one character play per turn
    if (phaseState.characterPlayedThisTurn) {
      logDetail(`  → blocked: already played a character this turn`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: already played a character this turn`,
      });
      continue;
    }

    // Rule: unique characters cannot be in play twice
    if (cardDef.unique && isUniqueCharacterInPlay(state, charName)) {
      logDetail(`  → blocked: ${charName} is unique and already in play`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: unique character already in play`,
      });
      continue;
    }

    // Rule 2.I.5 (CoE rule 2.05): a player whose avatar has been eliminated
    // cannot reveal another avatar.
    if (isAvatar && hasEliminatedAvatar(state, player)) {
      logDetail(`  → blocked: ${charName} is an avatar and this player already has an eliminated avatar`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: cannot reveal another avatar after one was eliminated`,
      });
      continue;
    }

    // Find valid sites (homesite or haven — from companies or site deck)
    // Note: findPlayableSites already handles home-site-only and avatar restrictions
    const playableSites = findPlayableSites(state, player, cardDef, avatarInPlay && !isAvatar);

    if (playableSites.length === 0) {
      const reason = hasHomeSiteOnlyRestriction(cardDef)
        ? `${charName}: homesite (${cardDef.homesite}) not available (home-site-only restriction)`
        : `${charName}: homesite (${cardDef.homesite}) and no haven available`;
      logDetail(`  → blocked: ${reason}`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason,
      });
      continue;
    }

    if (isAvatar) {
      // Avatars are always controlled under general influence and cost no mind
      for (const site of playableSites) {
        logDetail(`  → viable: play avatar at ${site.siteName}`);
        results.push({
          action: {
            type: 'play-character',
            player: playerId,
            characterInstanceId: cardInstanceId,
            atSite: site.instanceId,
            controlledBy: 'general',
          },
          viable: true,
        });
      }
    } else {
      // Non-avatar: check GI/DI constraints
      const charMind = cardDef.mind;
      const remainingGI = GENERAL_INFLUENCE - player.generalInfluenceUsed;
      const canPlayUnderGI = charMind <= remainingGI;

      // Find characters with enough DI to control this character as a follower.
      // Only characters under general influence can take followers.
      const diControllers: { instanceId: CardInstanceId; name: string; availDI: number }[] = [];
      for (const [key, char] of Object.entries(player.characters)) {
        if (char.controlledBy !== 'general') continue;
        const ctrlDef = resolveDef(state, char.instanceId);
        if (!isCharacterCard(ctrlDef)) continue;
        const avail = availableDI(state, char.instanceId, player, cardDef);
        if (avail >= charMind) {
          diControllers.push({ instanceId: key as CardInstanceId, name: ctrlDef.name, availDI: avail });
        }
      }

      if (!canPlayUnderGI && diControllers.length === 0) {
        logDetail(`  → blocked: mind ${charMind} exceeds remaining GI (${remainingGI}) and no character has enough DI`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason: `${charName}: mind ${charMind} exceeds remaining general influence (${remainingGI}) and no character has sufficient direct influence`,
        });
        continue;
      }

      // Generate viable actions for each (site, controlledBy) combination
      for (const site of playableSites) {
        // Rule 2.II.2.2: with avatar in play, GI play only at avatar's site
        const giAllowedAtSite = !avatarInPlay || site.instanceId === avatarSiteId;
        if (canPlayUnderGI && giAllowedAtSite) {
          logDetail(`  → viable: play under GI at ${site.siteName} (mind ${charMind}, remaining GI ${remainingGI})`);
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: cardInstanceId,
              atSite: site.instanceId,
              controlledBy: 'general',
            },
            viable: true,
          });
        }

        // DI followers must be played into the same company as the controller
        for (const ctrl of diControllers) {
          // Check the controller is in a company at this site
          const companyAtSite = player.companies.find(
            c => c.currentSite?.instanceId === site.instanceId && c.characters.includes(ctrl.instanceId),
          );
          if (!companyAtSite) continue;

          logDetail(`  → viable: play under DI of ${ctrl.name} (avail DI ${ctrl.availDI}) at ${site.siteName}`);
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: cardInstanceId,
              atSite: site.instanceId,
              controlledBy: ctrl.instanceId,
            },
            viable: true,
          });
        }
      }
    }
  }

  return results;
}
