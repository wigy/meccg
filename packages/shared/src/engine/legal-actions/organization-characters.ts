/**
 * @module legal-actions/organization-characters
 *
 * Character recruitment actions during the organization phase. Evaluates each
 * character card in the active player's hand against CoE rules for play eligibility:
 * uniqueness, site availability, and influence constraints (general and direct).
 */

import type { GameState, PlayerId, EvaluatedAction, CardInstanceId, CharacterCard, OrganizationPhaseState, SiteCard, CharacterInPlay, Company, PlayerState } from '../../index.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { isCharacterCard, isSiteCard, isAvatarCharacter } from '../../types/cards.js';
import { SiteType, Alignment, Race } from '../../types/common.js';
import type { PlayFlagEffect, RingwraithFollowerSlotsEffect, RecruitmentVehicleEffect, CardEffect } from '../../types/effects.js';
import { logDetail } from './log.js';
import { resolveDef } from '../effects/index.js';
import { findPlayerAvatar, matchesDefinition, characterEntries, findCharacterCompany, playerById, defById, companyBlocksJoins, getCardEffects, isHavenForPlayer, effectiveGeneralInfluence, isUniqueCharacterInPlay } from '../reducer-utils.js';
import { getEffectiveSiteType } from '../effective.js';
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
 * Evaluates the Fallen-wizard Orc/Troll play permission (CoE 2.II.2.2.F2) for a
 * candidate character. A Fallen-wizard player may only play an Orc or Troll
 * character (Half-orcs count as Orcs) when a Stage resource in play
 * "specifically allows" it — modelled as an `allow-character-play` effect on a
 * card the player controls whose `filter` matches the character's definition.
 *
 * Returns `permitted` (whether any in-play permission matches) and
 * `atOwnWizardhavens` (whether a matching permission also lets the character be
 * played at the controller's Wizardhavens even when the avatar is not there —
 * A Strident Spawn wh-61).
 */
function orcTrollPlayPermission(
  state: GameState,
  player: PlayerState,
  charDef: CharacterCard,
): { permitted: boolean; atOwnWizardhavens: boolean } {
  let permitted = false;
  let atOwnWizardhavens = false;
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    for (const eff of getCardEffects(def)) {
      if (eff.type !== 'allow-character-play') continue;
      if (!matchesDefinition(charDef, eff.filter)) continue;
      permitted = true;
      if (eff.atOwnWizardhavens) atOwnWizardhavens = true;
    }
  }
  return { permitted, atOwnWizardhavens };
}

/**
 * Find an in-hand recruitment vehicle (Thrall of the Voice, wh-82) for this
 * player, returning its card instance and `maxMind`. A recruitment vehicle lets
 * a Fallen-wizard bring one otherwise-ineligible character into play; see
 * {@link RecruitmentVehicleEffect}. Returns the first such card, or undefined.
 */
function recruitmentVehicleInHand(
  state: GameState,
  player: { readonly hand: readonly { readonly instanceId: CardInstanceId; readonly definitionId: import('../../index.js').CardDefinitionId }[] },
): { instanceId: CardInstanceId; maxMind: number } | undefined {
  for (const card of player.hand) {
    const def = defById(state, card.definitionId);
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects ?? [];
    const eff = effects.find((e): e is RecruitmentVehicleEffect => e.type === 'recruitment-vehicle');
    if (eff) return { instanceId: card.instanceId, maxMind: eff.maxMind };
  }
  return undefined;
}

/**
 * Returns true if the character declares the `home-site-only` play-flag, or
 * if the character has the `agent` keyword (rule 2.II.2.2.5: agents played as
 * characters can only be played at the character's home site, not at havens),
 * or if it is a Fallen-wizard avatar (rule 2.II.2.1.F1: a Fallen-wizard avatar
 * can only be played at the avatar's home site — unlike a Wizard avatar, which
 * may also be played at Rivendell [W1], or a Ringwraith avatar, which may also
 * be played at Minas Morgul or Dol Guldur [R1], a Fallen-wizard avatar gets no
 * extra havens).
 *
 * During normal play from hand the context reason is always "play-character",
 * so the flag's optional `when` gate is ignored here — the flag is treated
 * as always active on this code path.
 */
function hasHomeSiteOnlyRestriction(charDef: CharacterCard): boolean {
  return hasPlayFlag(charDef, 'home-site-only')
    || isAgentCharacter(charDef)
    || (isAvatarCharacter(charDef) && charDef.alignment === Alignment.FallenWizard);
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

    // A site converted into a Wizardhaven (Hidden Haven, wh-75) lets the
    // Fallen-wizard bring characters into play there, just like a printed
    // haven. The conversion installs a `site.type` → haven override, so the
    // effective type already reads as a haven.
    const isHaven = getEffectiveSiteType(state, company.currentSite.definitionId, siteDef.siteType) === SiteType.Haven;
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
 * Returns true if the character's `homesite` designates the given site:
 * either by exact site name, or by the region-form home site used by
 * Ringwraith avatars (`"Any site in <region>"` matches any site whose
 * `region` is that region).
 */
function homesiteMatchesSite(charDef: CharacterCard, siteDef: SiteCard): boolean {
  if (charDef.homesite === siteDef.name) return true;
  return siteDef.region !== undefined && charDef.homesite === `Any site in ${siteDef.region}`;
}

/**
 * Evaluates playing an avatar card from hand as a "Ringwraith follower" of the
 * player's revealed Ringwraith (CoE 2.II.2.1.R4–R5).
 *
 * Follower play requires an enabling ability — a `ringwraith-follower-slots`
 * effect on the revealed avatar (e.g. The Witch-king le-58: "up to two
 * Ringwraith followers in his company may be controlled with no influence").
 * The follower enters the controlling Ringwraith's company at its current
 * site, which must be a Darkhaven or the follower's home site. Because the
 * follower's `mind` is null it consumes none of the avatar's direct
 * influence, and the one-character-per-turn rule (checked upstream) enforces
 * the "separate organization phases" clause.
 */
function ringwraithFollowerPlayAction(
  state: GameState,
  playerId: PlayerId,
  player: {
    readonly characters: Readonly<Record<string, CharacterInPlay>>;
    readonly companies: readonly Company[];
  },
  cardInstanceId: CardInstanceId,
  cardDef: CharacterCard,
  avatar: CharacterInPlay,
  avatarSiteId: CardInstanceId,
): EvaluatedAction {
  const blocked = (reason: string): EvaluatedAction => {
    logDetail(`  → blocked: ${reason}`);
    return {
      action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
      viable: false,
      reason,
    };
  };

  const avatarDef = resolveDef(state, avatar.instanceId);
  if (!isCharacterCard(avatarDef)) {
    return blocked(`${cardDef.name}: an avatar is already revealed — a different avatar cannot be played (rule 2.II.2.1.1)`);
  }

  const slots = (avatarDef.effects ?? []).find(
    (e): e is RingwraithFollowerSlotsEffect => e.type === 'ringwraith-follower-slots',
  );
  if (!slots) {
    return blocked(`${cardDef.name}: ${avatarDef.name} is already revealed and has no ability allowing a Ringwraith follower to be played (rule 2.II.2.1.1)`);
  }
  if (cardDef.race !== Race.Ringwraith) {
    return blocked(`${cardDef.name}: only Ringwraith avatars may be played as Ringwraith followers`);
  }

  // Count the Ringwraith followers (avatar cards) the avatar already controls.
  const ringwraithFollowers = avatar.followers.filter(fid => {
    const follower = player.characters[fid as string];
    if (!follower) return false;
    const fDef = resolveDef(state, follower.instanceId);
    return isCharacterCard(fDef) && fDef.mind === null;
  }).length;
  if (ringwraithFollowers >= slots.count) {
    return blocked(`${cardDef.name}: ${avatarDef.name} already controls ${ringwraithFollowers} Ringwraith follower(s) (max ${slots.count})`);
  }

  // CoE 2.II.2.1.R4: the controlling Ringwraith must be at a Darkhaven or
  // the follower's home site.
  const siteDef = resolveDef(state, avatarSiteId);
  if (!isSiteCard(siteDef) || !(siteDef.siteType === SiteType.Haven || homesiteMatchesSite(cardDef, siteDef))) {
    return blocked(`${cardDef.name}: ${avatarDef.name} is not at a Darkhaven or at ${cardDef.name}'s home site (${cardDef.homesite})`);
  }

  // The follower joins the avatar's company; respect company-close effects
  // (e.g. Fell Rider's block-company-joins).
  const avatarCompany = findCharacterCompany(player.companies, avatar.instanceId);
  if (!avatarCompany) {
    return blocked(`${cardDef.name}: ${avatarDef.name} is not in a company`);
  }
  if (companyBlocksJoins(state, avatarCompany.id)) {
    return blocked(`${cardDef.name}: ${avatarDef.name}'s company is closed to new joins`);
  }

  logDetail(`  → viable: play ${cardDef.name} as Ringwraith follower of ${avatarDef.name} at ${siteDef.name} (${ringwraithFollowers}/${slots.count} slots used, no influence)`);
  return {
    action: {
      type: 'play-character',
      player: playerId,
      characterInstanceId: cardInstanceId,
      atSite: avatarSiteId,
      controlledBy: avatar.instanceId,
    },
    viable: true,
  };
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

    // Rule 2.II.2.1.1: a player who has revealed their avatar cannot play a
    // different avatar — except as a Ringwraith follower enabled by an
    // in-play ability (CoE 2.II.2.1.R4–R5, e.g. The Witch-king le-58).
    if (isAvatar && avatarInPlay && avatar) {
      results.push(ringwraithFollowerPlayAction(state, playerId, player, cardInstanceId, cardDef, avatar, avatarSiteId));
      continue;
    }

    // CoE 2.II.2.2.F2: a Fallen-wizard player cannot play Orc or Troll
    // characters (Half-orcs are race Orc) unless a Stage resource in play
    // specifically allows it (Bad Company wh-63 for any Orc/Troll; A Strident
    // Spawn wh-61 for Half-orcs). A Strident Spawn additionally lets Half-orcs
    // be played at the player's Wizardhavens even when the avatar is elsewhere.
    let orcTrollAtWizardhavens = false;
    if (player.alignment === Alignment.FallenWizard
        && (cardDef.race === Race.Orc || cardDef.race === Race.Troll)) {
      const perm = orcTrollPlayPermission(state, player, cardDef);
      if (!perm.permitted) {
        const reason = `${charName}: a Fallen-wizard cannot play Orc or Troll characters without a Stage resource in play that allows it (e.g. Bad Company)`;
        logDetail(`  → blocked: ${reason}`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason,
        });
        continue;
      }
      orcTrollAtWizardhavens = perm.atOwnWizardhavens;
      logDetail(`  → Orc/Troll play permitted${orcTrollAtWizardhavens ? ' (and at own Wizardhavens regardless of avatar location)' : ''}`);
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

      // Recruitment vehicle (Thrall of the Voice, wh-82): a Fallen-wizard may
      // bring one character with printed mind above the standard maximum of 5
      // (up to the vehicle's maxMind) into play "instead of a normal character"
      // by placing the vehicle with it. Per the CRF this cannot bring an Orc or
      // Troll into play. The recruit may be a minion agent. When recruiting, the
      // vehicle's "-1 to his mind" reduces the influence cost (min 1).
      const vehicle = recruitmentVehicleInHand(state, player);
      const recruitViaVehicle = vehicle !== undefined
        && player.alignment === Alignment.FallenWizard
        && charMind > 5
        && charMind <= vehicle.maxMind
        && cardDef.race !== Race.Orc
        && cardDef.race !== Race.Troll;
      const costMind = recruitViaVehicle ? Math.max(1, charMind - 1) : charMind;
      const recruitField = recruitViaVehicle && vehicle ? { viaRecruitmentInstanceId: vehicle.instanceId } : {};
      if (recruitViaVehicle) {
        logDetail(`  → recruitment vehicle available: ${charName} (mind ${charMind} → cost ${costMind}) may be brought in via Thrall of the Voice`);
      }

      // MEWH §11 / Characters: a Fallen-wizard may not start or bring into play
      // any character with a mind greater than 5 — unless a recruitment vehicle
      // lifts the limit for this one character.
      if (player.alignment === 'fallen-wizard' && charMind > 5 && !recruitViaVehicle) {
        const reason = (vehicle && charMind > vehicle.maxMind)
          ? `${charName}: mind ${charMind} exceeds Thrall of the Voice's maximum of ${vehicle.maxMind}`
          : (vehicle && (cardDef.race === Race.Orc || cardDef.race === Race.Troll))
            ? `${charName}: Thrall of the Voice cannot bring an Orc or Troll into play`
            : `${charName}: mind ${charMind} exceeds the Fallen-wizard maximum of 5`;
        logDetail(`  → blocked: ${reason}`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason,
        });
        continue;
      }

      const remainingGI = effectiveGeneralInfluence(state, playerId) - player.generalInfluenceUsed;
      const canPlayUnderGI = costMind <= remainingGI;

      // Find characters with enough DI to control this character as a follower.
      // Only characters under general influence can take followers.
      const diControllers: { instanceId: CardInstanceId; name: string; availDI: number }[] = [];
      for (const [key, char] of characterEntries(player)) {
        if (char.controlledBy !== 'general') continue;
        const ctrlDef = resolveDef(state, char.instanceId);
        if (!isCharacterCard(ctrlDef)) continue;
        const avail = availableDI(state, char.instanceId, player, cardDef);
        if (avail >= costMind) {
          diControllers.push({ instanceId: key, name: ctrlDef.name, availDI: avail });
        }
      }

      if (!canPlayUnderGI && diControllers.length === 0) {
        logDetail(`  → blocked: mind cost ${costMind} exceeds remaining GI (${remainingGI}) and no character has enough DI`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason: `${charName}: mind ${costMind} exceeds remaining general influence (${remainingGI}) and no character has sufficient direct influence`,
        });
        continue;
      }

      // Generate viable actions for each (site, controlledBy) combination
      for (const site of playableSites) {
        // Rule 2.II.2.2: with avatar in play, GI play only at avatar's site.
        // A Strident Spawn (wh-61) relaxes this for Half-orcs at the player's
        // own Wizardhavens ("even if your Fallen-wizard is not there").
        const isOwnWizardhaven = orcTrollAtWizardhavens
          && isHavenForPlayer(site.siteDef, player.alignment, { state, siteDefinitionId: site.siteDef.id, playerId });
        const giAllowedAtSite = !avatarInPlay || site.instanceId === avatarSiteId || isOwnWizardhaven;
        if (canPlayUnderGI && giAllowedAtSite) {
          logDetail(`  → viable: play under GI at ${site.siteName} (mind cost ${costMind}, remaining GI ${remainingGI})${recruitViaVehicle ? ' via recruitment vehicle' : ''}`);
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: cardInstanceId,
              atSite: site.instanceId,
              controlledBy: 'general',
              ...recruitField,
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

          // Fell Rider (block-company-joins): no direct-influence follower may
          // join a company closed by a bound mode card.
          if (companyBlocksJoins(state, companyAtSite.id)) {
            logDetail(`  → blocked: ${site.siteName} company is closed to new joins (block-company-joins)`);
            continue;
          }

          logDetail(`  → viable: play under DI of ${ctrl.name} (avail DI ${ctrl.availDI}) at ${site.siteName}`);
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: cardInstanceId,
              atSite: site.instanceId,
              controlledBy: ctrl.instanceId,
              ...recruitField,
            },
            viable: true,
          });
        }
      }
    }
  }

  return results;
}
