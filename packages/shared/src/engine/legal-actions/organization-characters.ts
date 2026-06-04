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
import { GENERAL_INFLUENCE, SiteType, Alignment, Race, isCharacterCard, isSiteCard, hasPlayFlag } from '../../index.js';
import type { PlayFlagEffect } from '../../types/effects.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import { findPlayerAvatar, matchesDefinition, characterEntries, findCharacterCompany, playerById, defById } from '../reducer-utils.js';
import { availableDI } from './organization.js';

/**
 * Returns true if the site carries a `deny-character` site-rule that matches
 * this character. The rule's `filter` is evaluated against the character's
 * card definition (dot paths reference fields like `race`, `name`, etc.).
 * When the rule declares `exceptHomesite: true`, a character whose `homesite`
 * equals the site's name is never denied.
 *
 * Example — Carn Dûm (le-359): non-Orc, non-Troll characters are denied
 * unless the site is the character's home site.
 */
function isCharacterDeniedBySiteRule(charDef: CharacterCard, siteDef: SiteCard): boolean {
  if (!siteDef.effects) return false;
  for (const eff of siteDef.effects) {
    if (eff.type !== 'site-rule' || eff.rule !== 'deny-character') continue;
    if (eff.exceptHomesite && charDef.homesite === siteDef.name) continue;
    if (matchesDefinition(charDef, eff.filter)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the character has the `agent` keyword.
 *
 * Rule 1.3.W2 / 1.3.B2: For Wizard and Balrog players, agent cards are treated
 * as hazard cards in all areas, so they cannot be played as characters at all.
 * Rule 2.II.2.2.5: Ringwraith/Fallen-wizard players may play agent characters,
 * but only at the agent's home site.
 */
function isAgentCharacter(charDef: CharacterCard): boolean {
  return (charDef.keywords ?? []).includes('agent');
}

/**
 * Returns true if the character declares the `home-site-only` play-flag, or
 * if the character has the `agent` keyword (rule 2.II.2.2.5: agents played as
 * characters can only be played at the character's home site, not at havens).
 *
 * During normal play from hand the context reason is always "play-character",
 * so the flag's optional `when` gate is ignored here — the flag is treated
 * as always active on this code path.
 */
function hasHomeSiteOnlyRestriction(charDef: CharacterCard): boolean {
  return hasPlayFlag(charDef, 'home-site-only') || isAgentCharacter(charDef);
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
    const def = defById(state, c.definitionId);
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
      if (isCharacterDeniedBySiteRule(charDef, siteDef)) {
        logDetail(`  play-restriction: ${charDef.name} denied at ${siteDef.name} by site rule`);
        continue;
      }
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
    const siteDef = defById(state, siteCard.definitionId);
    if (!siteDef || !isSiteCard(siteDef)) continue;
    if (seenSiteNames.has(siteDef.name)) continue;

    const isHaven = siteDef.siteType === SiteType.Haven;
    const isHomesite = siteDef.name === charDef.homesite;

    if (homeSiteOnly ? isHomesite : (isHaven || isHomesite)) {
      if (isCharacterDeniedBySiteRule(charDef, siteDef)) {
        logDetail(`  play-restriction: ${charDef.name} denied at ${siteDef.name} by site rule`);
        continue;
      }
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
  const player = playerById(state, playerId)!;
  const results: EvaluatedAction[] = [];

  // Rule 2.II.2.2: detect if the player's avatar is in play
  const avatar = findPlayerAvatar(state, player);
  const avatarCompany = avatar
    ? findCharacterCompany(player.companies, avatar.instanceId)
    : undefined;
  const avatarSiteId: CardInstanceId | null = avatarCompany?.currentSite?.instanceId ?? null;
  const avatarInPlay = avatarSiteId !== null;
  if (avatarInPlay) {
    logDetail(`Avatar in play at site ${avatarSiteId as string} — character play restricted (rule 2.II.2.2)`);
  }

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const cardDef = defById(state, handCard.definitionId);
    if (!isCharacterCard(cardDef)) continue;

    const charName = cardDef.name;
    const isAvatar = cardDef.mind === null;

    logDetail(`Evaluating play-character: ${charName} (mind ${cardDef.mind ?? 'avatar'}, DI ${cardDef.directInfluence})`);

    // Rule 1.3.W2 / 1.3.B2: For Wizard and Balrog players, agent cards are
    // treated as hazard cards in all areas — they cannot be played as characters.
    // Rule 2.II.2.2.5: Only Ringwraith and Fallen-wizard players may play agents
    // as characters.
    if (isAgentCharacter(cardDef)) {
      const playerAlignment = player.alignment;
      if (playerAlignment === Alignment.Wizard || playerAlignment === Alignment.Balrog) {
        logDetail(`  → blocked: ${charName} is an agent; Wizard/Balrog players treat agents as hazards (rules 1.3.W2/1.3.B2)`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason: `${charName}: agents are treated as hazard cards for Wizard/Balrog players and cannot be played as characters`,
        });
        continue;
      }
    }

    // Rule: only one character play per turn.
    // Exception: troll-triplet co-play — a character with `coPlayCompanions` may
    // be played on the same turn as one of its listed companions (e.g. Bûrat,
    // Tûma, and Wûluag may all be played in the same organization phase).
    if (phaseState.characterPlayedThisTurn) {
      // Buddy-play exception: if this character belongs to a buddy group whose
      // companion was already played this turn, it may still be played.
      const buddyPlayEffect = (cardDef.effects ?? []).find(
        (e): e is PlayFlagEffect => e.type === 'play-flag' && e.flag === 'buddy-play',
      );
      const buddyGroupPlayedThisTurn = phaseState.buddyGroupPlayedThisTurn ?? [];
      const defId = cardDef.id as string;
      const buddyAllowed = buddyGroupPlayedThisTurn.includes(defId) ||
        (buddyPlayEffect?.companions?.some(c => buddyGroupPlayedThisTurn.includes(c)) ?? false);

      if (!buddyAllowed) {
        logDetail(`  → blocked: already played a character this turn`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason: `${charName}: already played a character this turn`,
        });
        continue;
      }
      logDetail(`  → buddy-play exception: ${charName} may be played (companion played this turn)`);
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

    // MELE §8.R1: Ringwraith return-to-hand reveal restrictions.
    // (a) A player whose Ringwraith returned to hand may not reveal a *different* Ringwraith.
    if (isAvatar && cardDef.race === Race.Ringwraith && player.ringwraithReturnedToHand) {
      if (cardDef.id !== player.ringwraithReturnedToHand) {
        logDetail(`  → blocked: ${charName} is a different Ringwraith; ${player.ringwraithReturnedToHand as string} must be re-played first (MELE §8.R1)`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason: `${charName}: a Ringwraith has been returned to hand — you must re-play that Ringwraith before revealing a different one`,
        });
        continue;
      }
    }

    // (b) The opponent may not reveal the Ringwraith that was returned to that player's hand.
    const opponentPlayer = state.players.find(p => p.id !== playerId);
    if (isAvatar && cardDef.race === Race.Ringwraith && opponentPlayer?.ringwraithReturnedToHand === cardDef.id) {
      logDetail(`  → blocked: ${charName} (def ${cardDef.id}) was returned to opponent's hand; opponent must re-play it first (MELE §8.R1)`);
      results.push({
        action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
        viable: false,
        reason: `${charName}: the opponent's Ringwraith of this type was returned to their hand and may not be revealed by you`,
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
      for (const [key, char] of characterEntries(player)) {
        if (char.controlledBy !== 'general') continue;
        const ctrlDef = resolveDef(state, char.instanceId);
        if (!isCharacterCard(ctrlDef)) continue;
        const avail = availableDI(state, char.instanceId, player, cardDef);
        if (avail >= charMind) {
          diControllers.push({ instanceId: key, name: ctrlDef.name, availDI: avail });
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
