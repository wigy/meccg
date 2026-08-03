/**
 * @module legal-actions/organization-characters
 *
 * Character recruitment actions during the organization phase. Evaluates each
 * character card in the active player's hand against CoE rules for play eligibility:
 * uniqueness, site availability, and influence constraints (general and direct).
 */

import type { GameState, PlayerId, EvaluatedAction, CardInstanceId, CharacterCard, SiteCard, CharacterInPlay, Company, PlayerState } from '../../index.js';
import { hasPlayFlag, hasFollowerGrantPermission } from '../../effects/play-flags.js';
import { requirePhaseState, isBalrogAvatarDef } from '../../state-utils.js';
import { isCharacterCard, isSiteCard, isAvatarCharacter } from '../../types/cards.js';
import { SiteType, RegionType, Alignment, Race } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import type { PlayFlagEffect, RingwraithFollowerSlotsEffect, RingwraithSelfFollowerEffect, RecruitmentVehicleEffect, CardEffect } from '../../types/effects.js';
import { logDetail } from './log.js';
import { evaluateAction } from '../../rules/evaluator.js';
import { CHARACTER_PLAY_RULES } from '../../rules/definitions/character-play.js';
import { resolveDef } from '../effects/index.js';
import { findPlayerAvatar, matchesDefinition, characterEntries, findCharacterCompany, playerById, defById, companyBlocksJoins, getCardEffects, isHavenForPlayer, generalInfluenceControlLimit, isUniqueCharacterInPlay, playerPlaysAsSauron, playerHasNoCharacterPlayLimit, wouldViolateRingwraithComposition, isDarkhavenSiteDef, siteRegionTypeOf, parseHomesiteNames } from '../reducer-utils.js';
import { blockingManifestationForCharacterPlay } from '../manifestations.js';
import { companyAtSiteInstance, companyExemptsCharacterFromInfluence, companyExemptsCharacterFromPlayLimit } from '../company-composition.js';
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
 * Returns true if the site carries an `allow-agent-play` site-rule, which lets
 * agent characters be brought into play there under direct influence even
 * though the site is not the agent's home site (Bree le-356). The permission
 * is direct-influence-only; the general-influence branch below skips such sites.
 */
function siteAllowsAgentPlay(siteDef: SiteCard): boolean {
  return (siteDef.effects ?? []).some(
    eff => eff.type === 'site-rule' && eff.rule === 'allow-agent-play',
  );
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
): { instanceId: CardInstanceId; maxMind: number; agentRecruit: boolean } | undefined {
  for (const card of player.hand) {
    const def = defById(state, card.definitionId);
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects ?? [];
    const eff = effects.find((e): e is RecruitmentVehicleEffect => e.type === 'recruitment-vehicle');
    if (eff) return { instanceId: card.instanceId, maxMind: eff.maxMind, agentRecruit: eff.agentRecruit === true };
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
    // MEBA §12: The Balrog must come into play at The Under-gates (his home
    // site) — not at Moria or any other Darkhaven. Like a Fallen-wizard avatar,
    // he gets no extra-haven entry, so home-site-only confines him to The
    // Under-gates.
    || (isAvatarCharacter(charDef) && (charDef.alignment === Alignment.FallenWizard || charDef.alignment === Alignment.Balrog));
}

/**
 * For a Wizard or Ringwraith avatar, returns the specific haven names where
 * the avatar may be revealed in addition to its home site (rule 2.II.2.1
 * W1/R1: Wizard avatars may also be played at Rivendell; Ringwraith avatars
 * may also be played at Minas Morgul or Dol Guldur). Returns `null` for
 * characters with no such restriction — ordinary (non-avatar) characters may
 * be played at ANY haven, and Fallen-wizard/Balrog avatars are already
 * confined to their home site by {@link hasHomeSiteOnlyRestriction} and never
 * reach the haven branch.
 */
function avatarExtraHavenNames(charDef: CharacterCard): readonly string[] | null {
  if (!isAvatarCharacter(charDef)) return null;
  if (charDef.alignment === Alignment.Wizard) return ['Rivendell'];
  if (charDef.alignment === Alignment.Ringwraith) return ['Minas Morgul', 'Dol Guldur'];
  return null;
}

/**
 * True when the player has an in-play permanent-event carrying an
 * `avatar-home-site-restriction` effect (Saw Further and Deeper dm-156). While
 * such a card is in play, the player's avatar may only be brought into play at
 * its home site — the extra-haven reveal option (Rivendell for a Wizard, Minas
 * Morgul / Dol Guldur for a Ringwraith) is suppressed.
 */
function playerHasAvatarHomeSiteRestriction(
  state: GameState,
  player: PlayerState,
): boolean {
  return player.cardsInPlay.some(card => {
    const def = defById(state, card.definitionId);
    return getCardEffects(def).some(e => e.type === 'avatar-home-site-restriction');
  });
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
 * True when the one-character-play-per-turn limit blocks this candidate.
 * A character was already played this turn AND neither exception applies:
 *
 * - Buddy-play (troll-triplet co-play): a character with `coPlayCompanions`
 *   may be played on the same turn as one of its listed companions (e.g.
 *   Bûrat, Tûma, and Wûluag may all be played in the same organization phase).
 * - MEBA §characters: a Balrog player may bring a SECOND character into play
 *   this organization phase, but it must be non-unique. The first play sets
 *   the count to 1; the second (non-unique) is still allowed.
 */
function characterPlayLimitReached(
  phaseState: {
    readonly characterPlayedThisTurn: boolean;
    readonly charactersBroughtIntoPlayThisTurn?: number;
    readonly buddyGroupPlayedThisTurn?: readonly string[];
  },
  alignment: Alignment,
  cardDef: CharacterCard,
): boolean {
  if (!phaseState.characterPlayedThisTurn) return false;

  const buddyPlayEffect = (cardDef.effects ?? []).find(
    (e): e is PlayFlagEffect => e.type === 'play-flag' && e.flag === 'buddy-play',
  );
  const buddyGroupPlayedThisTurn = phaseState.buddyGroupPlayedThisTurn ?? [];
  const defId = cardDef.id as string;
  const buddyAllowed = buddyGroupPlayedThisTurn.includes(defId) ||
    (buddyPlayEffect?.companions?.some(c => buddyGroupPlayedThisTurn.includes(c)) ?? false);

  const playedCount = phaseState.charactersBroughtIntoPlayThisTurn ?? 1;
  const balrogSecondAllowed = alignment === Alignment.Balrog
    && playedCount < 2
    && !cardDef.unique;

  if (balrogSecondAllowed) {
    logDetail(`  → Balrog second-character exception: ${cardDef.name} (non-unique) may be played as the 2nd character this turn`);
  } else if (buddyAllowed) {
    logDetail(`  → buddy-play exception: ${cardDef.name} may be played (companion played this turn)`);
  }
  return !buddyAllowed && !balrogSecondAllowed;
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
    readonly alignment: Alignment;
  },
  charDef: CharacterCard,
  avatarInPlay: boolean,
  /**
   * Open to the Summons (wh-46): when true and `charDef` is an agent, Darkhavens
   * are added to the agent's playable sites (in addition to its home site), so
   * the agent may be summoned there via the vehicle.
   */
  includeDarkhavensForAgent = false,
  /**
   * Saw Further and Deeper (dm-156): when true and `charDef` is an avatar, the
   * avatar's extra-haven reveal option (Rivendell / Minas Morgul / Dol Guldur)
   * is suppressed, confining the avatar to its home site.
   */
  avatarHomeSiteOnly = false,
): { instanceId: CardInstanceId; siteDef: SiteCard; siteName: string; directInfluenceOnly: boolean }[] {
  const results: { instanceId: CardInstanceId; siteDef: SiteCard; siteName: string; directInfluenceOnly: boolean }[] = [];
  const seenInstances = new Set<string>();
  const seenSiteNames = new Set<string>();
  const homeSiteOnly = hasHomeSiteOnlyRestriction(charDef)
    || (avatarHomeSiteOnly && isAvatarCharacter(charDef));
  const extraHavenNames = avatarExtraHavenNames(charDef);
  const allowAgentDarkhaven = includeDarkhavensForAgent && isAgentCharacter(charDef);

  if (homeSiteOnly) {
    logDetail(`  play-restriction: ${charDef.name} has home-site-only — havens excluded`);
  } else if (extraHavenNames) {
    logDetail(`  play-restriction: ${charDef.name} is an avatar — only havens [${extraHavenNames.join(', ')}] qualify`);
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
    let isHaven = getEffectiveSiteType(state, company.currentSite.definitionId, siteDef.siteType, company.currentSite.instanceId, true) === SiteType.Haven;
    if (isHaven && extraHavenNames && !extraHavenNames.includes(siteDef.name)) isHaven = false;
    const isHomesite = homesiteMatchesSite(state, charDef, siteDef, player.alignment);
    const agentDarkhaven = allowAgentDarkhaven && isDarkhavenSiteDef(siteDef);
    // Bree (le-356) `allow-agent-play`: an agent may join a company already at
    // this site under direct influence, even though it is not the agent's home
    // site. General-influence play is not granted (directInfluenceOnly below).
    const agentPlayHere = isAgentCharacter(charDef) && siteAllowsAgentPlay(siteDef);

    if ((homeSiteOnly ? (isHomesite || agentPlayHere) : (isHaven || isHomesite)) || agentDarkhaven) {
      if (isCharacterDeniedBySiteRule(charDef, siteDef)) {
        logDetail(`  play-restriction: ${charDef.name} denied at ${siteDef.name} by site rule`);
        continue;
      }
      if (agentPlayHere && !isHomesite) {
        logDetail(`  play-permission: ${charDef.name} (agent) may be played at ${siteDef.name} under direct influence (allow-agent-play)`);
      }
      results.push({ instanceId: siteId, siteDef, siteName: siteDef.name, directInfluenceOnly: agentPlayHere && !isHomesite });
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

    let isHaven = siteDef.siteType === SiteType.Haven;
    if (isHaven && extraHavenNames && !extraHavenNames.includes(siteDef.name)) isHaven = false;
    const isHomesite = homesiteMatchesSite(state, charDef, siteDef, player.alignment);
    const agentDarkhaven = allowAgentDarkhaven && isDarkhavenSiteDef(siteDef);

    if ((homeSiteOnly ? isHomesite : (isHaven || isHomesite)) || agentDarkhaven) {
      if (isCharacterDeniedBySiteRule(charDef, siteDef)) {
        logDetail(`  play-restriction: ${charDef.name} denied at ${siteDef.name} by site rule`);
        continue;
      }
      results.push({ instanceId: siteCard.instanceId, siteDef, siteName: siteDef.name, directInfluenceOnly: false });
      seenSiteNames.add(siteDef.name);
    }
  }

  return results;
}

/**
 * Returns true if the character's `homesite` designates the given site:
 * either by exact site name (including a comma-separated list of multiple
 * home sites, e.g. Freca dm-182: `"Edoras, Dunnish Clan-hold"` — the
 * character's home site is *either* named site), or by the region-form home
 * site used by Ringwraith avatars (`"Any site in <region>"` matches any site
 * whose `region` is that region).
 *
 * Two Under-deeps home-site forms (MEBA) are also resolved here:
 * - `"any non-Dark-hold Under-deeps site"` (ba-6/7/8) matches any Under-deeps
 *   site whose type is not Dark-hold.
 * - `"Any Dark-hold"` is **remapped** to the above for a Balrog player
 *   (MEBA §characters: "Characters with a home site of 'Any Dark-hold' have a
 *   home site of 'Any non-Dark-hold Under-deeps site' instead"); for every
 *   other alignment it keeps its literal meaning (matched via Dark-hold
 *   Darkhavens through the haven path, not here).
 *
 * The **site-type home-site form** `"Any <site-type>"` (Gandalf wh-4:
 * `"Any Free-hold"`) matches any site whose *printed* type is that type — using
 * `siteDef.siteType`, not the effective type, so a Free-hold converted into a
 * Wizardhaven by Chambers in the Royal Court (wh-97) remains one of Gandalf's
 * home sites even though its effective type now reads `haven`. Dark-hold is
 * excluded from this form: "Any Dark-hold" keeps the special meaning above.
 *
 * The **compound exclusion form** `"Any non-<exclusion> <site-type>[ in a
 * <region-type>]"` (Alatar wh-1: `"Any non-'Dragon's lair' Ruins & Lairs in a
 * Wilderness"`; as-1/5/6: `"Any non-Under-deeps Ruins & Lairs"`) is delegated
 * to {@link matchesCompoundHomesite}.
 */
export function homesiteMatchesSite(state: GameState, charDef: CharacterCard, siteDef: SiteCard, playerAlignment?: Alignment): boolean {
  let homesite = charDef.homesite;
  if (playerAlignment === Alignment.Balrog && homesite === 'Any Dark-hold') {
    homesite = 'any non-Dark-hold Under-deeps site';
  }
  if (parseHomesiteNames(homesite).includes(siteDef.name)) return true;
  if (siteDef.region !== undefined && homesite === `Any site in ${siteDef.region}`) return true;
  if (homesite.toLowerCase() === 'any non-dark-hold under-deeps site') {
    const isUnderDeeps = siteDef.keywords?.includes('under-deeps') ?? false;
    return isUnderDeeps && siteDef.siteType !== SiteType.DarkHold;
  }
  const anySiteType = SITE_TYPE_HOMESITE_LABELS[homesite];
  if (anySiteType !== undefined) return siteDef.siteType === anySiteType;
  return matchesCompoundHomesite(state, homesite, siteDef);
}

/**
 * Bare site-type labels used both by the simple `"Any <site-type>"` home-site
 * form and, prefixed with `"Any "`, by {@link SITE_TYPE_HOMESITE_LABELS}. Kept
 * separate so the compound-exclusion form ({@link matchesCompoundHomesite})
 * can reuse the same labels without the "Any " prefix.
 */
const SITE_TYPE_LABELS: Readonly<Record<string, SiteType>> = {
  'Free-hold': SiteType.FreeHold,
  'Border-hold': SiteType.BorderHold,
  'Ruins & Lairs': SiteType.RuinsAndLairs,
  'Shadow-hold': SiteType.ShadowHold,
  'Haven': SiteType.Haven,
};

/**
 * `"Any <site-type>"` home-site labels → the printed {@link SiteType} they match
 * (see {@link homesiteMatchesSite}). Dark-hold is intentionally absent: its
 * "Any Dark-hold" form has bespoke (Balrog-remap / Darkhaven) handling.
 */
const SITE_TYPE_HOMESITE_LABELS: Readonly<Record<string, SiteType>> = Object.fromEntries(
  Object.entries(SITE_TYPE_LABELS).map(([label, type]) => [`Any ${label}`, type]),
);

/**
 * Exclusion clauses recognized in the compound `"Any non-<exclusion>
 * <site-type>..."` home-site form — each maps the bracketed word(s) to a
 * predicate that's true when the candidate site is the excluded kind.
 * `"Dragon's lair"` (Alatar wh-1) means any site with a Dragon automatic-attack,
 * identified by the `lairOf` tag site definitions carry (CRF 22: "each site
 * with a Dragon automatic-attack"). `"Under-deeps"` (as-1/5/6) reuses the same
 * `under-deeps` keyword the dedicated Balrog home-site form checks above.
 */
const HOMESITE_EXCLUSIONS: Readonly<Record<string, (siteDef: SiteCard) => boolean>> = {
  'dragon’s lair': siteDef => Boolean((siteDef as { lairOf?: unknown }).lairOf),
  'under-deeps': siteDef => siteDef.keywords?.includes('under-deeps') ?? false,
};

/**
 * Region-type labels recognized in the compound home-site form's optional
 * `"... in a <region-type>"` suffix, mapped to the {@link RegionType} they
 * designate.
 */
const REGION_TYPE_HOMESITE_LABELS: Readonly<Record<string, RegionType>> = {
  'wilderness': RegionType.Wilderness,
  'border-land': RegionType.Border,
  'free-domain': RegionType.Free,
  'shadow-land': RegionType.Shadow,
  'dark-domain': RegionType.Dark,
  'coastal-land': RegionType.Coastal,
};

/**
 * Matches `"Any non-<exclusion> <site-type>[ in a <region-type>]"`, either
 * with the exclusion in curly/straight quotes (`"Any non-“Dragon’s lair”
 * Ruins & Lairs in a Wilderness"`) or as a single bare word (`"Any
 * non-Under-deeps Ruins & Lairs"`). Group 3 is lazy so the optional region
 * suffix, when present, is peeled off rather than swallowed into the
 * site-type label.
 */
const COMPOUND_HOMESITE_PATTERN = /^Any non-(?:[“"]([^”"]+)[”"]|(\S+)) (.+?)(?: in an? (.+))?$/;

/**
 * Evaluates the compound exclusion home-site form (see
 * {@link COMPOUND_HOMESITE_PATTERN}) against a candidate site. Returns `false`
 * — "not a match" rather than throwing — for any `homesite` text that isn't
 * this form, or whose exclusion/site-type/region-type label isn't recognized,
 * so unmodeled or malformed home-site text degrades to "no home site" instead
 * of crashing the legal-action computation.
 */
function matchesCompoundHomesite(state: GameState, homesite: string, siteDef: SiteCard): boolean {
  const match = COMPOUND_HOMESITE_PATTERN.exec(homesite);
  if (!match) return false;
  const [, quotedExclusion, bareExclusion, siteTypeLabel, regionLabel] = match;
  const excludes = HOMESITE_EXCLUSIONS[(quotedExclusion ?? bareExclusion ?? '').toLowerCase()];
  if (!excludes || excludes(siteDef)) return false;
  const siteType = SITE_TYPE_LABELS[siteTypeLabel];
  if (siteType === undefined || siteDef.siteType !== siteType) return false;
  if (regionLabel === undefined) return true;
  const regionType = REGION_TYPE_HOMESITE_LABELS[regionLabel.toLowerCase()];
  return regionType !== undefined && siteRegionTypeOf(state, siteDef) === regionType;
}

/**
 * Evaluates playing an avatar card from hand as a "Ringwraith follower" of the
 * player's revealed Ringwraith (CoE 2.II.2.1.R4–R5).
 *
 * Follower play requires an enabling ability — either a `ringwraith-follower-slots`
 * effect on the revealed avatar (e.g. The Witch-king le-58: "up to two
 * Ringwraith followers in his company may be controlled with no influence"),
 * OR a `ringwraith-self-follower` effect on the card being played, which grants
 * its own slot (e.g. Ûvatha the Ringwraith le-57: "He may join another
 * Ringwraith's company … requires no influence to control"). A self-granting
 * follower is admitted regardless of the revealed avatar's slot ability and
 * does not consume that avatar's slot budget.
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

  // The Lidless Eye (le-203) / Sauron (ba-43): "You may not... play Ringwraith
  // followers." While the acting player counts as Sauron, no Ringwraith follower
  // may be played (even one enabled by a slot ability on the revealed avatar).
  const actingPlayer = playerById(state, playerId);
  if (actingPlayer && playerPlaysAsSauron(state, actingPlayer)) {
    return blocked(`${cardDef.name}: you are Sauron — you may not play Ringwraith followers while The Lidless Eye is in play`);
  }

  const avatarDef = resolveDef(state, avatar.instanceId);
  if (!isCharacterCard(avatarDef)) {
    return blocked(`${cardDef.name}: an avatar is already revealed — a different avatar cannot be played (rule 2.II.2.1.1)`);
  }

  const slots = (avatarDef.effects ?? []).find(
    (e): e is RingwraithFollowerSlotsEffect => e.type === 'ringwraith-follower-slots',
  );
  // A self-granting follower (Ûvatha le-57) brings its own slot: it may be
  // played as a follower even when the revealed avatar has no slot ability, and
  // it does not draw from that avatar's slot budget.
  const selfFollower = (cardDef.effects ?? []).find(
    (e): e is RingwraithSelfFollowerEffect => e.type === 'ringwraith-self-follower',
  );
  if (!slots && !selfFollower) {
    return blocked(`${cardDef.name}: ${avatarDef.name} is already revealed and has no ability allowing a Ringwraith follower to be played (rule 2.II.2.1.1)`);
  }
  if (cardDef.race !== Race.Ringwraith) {
    return blocked(`${cardDef.name}: only Ringwraith avatars may be played as Ringwraith followers`);
  }

  // Slot-budget check only applies when relying on the host avatar's slots. A
  // self-granting follower is exempt (it grants its own slot).
  if (slots && !selfFollower) {
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
  }

  // CoE 2.II.2.1.R4: the controlling Ringwraith must be at a Darkhaven or
  // the follower's home site.
  const siteDef = resolveDef(state, avatarSiteId);
  if (!isSiteCard(siteDef) || !(siteDef.siteType === SiteType.Haven || homesiteMatchesSite(state, cardDef, siteDef))) {
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

  logDetail(`  → viable: play ${cardDef.name} as Ringwraith follower of ${avatarDef.name} at ${siteDef.name} (${selfFollower ? 'self-granted slot' : `via ${avatarDef.name}'s ${slots?.count ?? 0} slot(s)`}, no influence)`);
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
  const phaseState = requirePhaseState(state, Phase.Organization);
  const player = playerById(state, playerId)!;
  const results: EvaluatedAction[] = [];

  // Rule 2.II.2.2: detect if the player's avatar is in play
  const avatar = findPlayerAvatar(state, player);
  const avatarCompany = avatar
    ? findCharacterCompany(player.companies, avatar.instanceId)
    : undefined;
  const avatarSiteId: CardInstanceId | null = avatarCompany?.currentSite?.instanceId ?? null;
  const avatarInPlay = avatarSiteId !== null;

  // MEBA §characters: "When a Balrog player brings into play a non-unique
  // character with a mind of 3 or less, that character may come from his hand,
  // his discard pile, or his sideboard." Surface those extra candidates
  // alongside the hand; the reducer locates the actual source pile by instance.
  const candidateCards: { readonly instanceId: CardInstanceId; readonly definitionId: import('../../index.js').CardDefinitionId }[] = [...player.hand];
  if (player.alignment === Alignment.Balrog) {
    const isLowMindNonUnique = (defId: import('../../index.js').CardDefinitionId): boolean => {
      const def = defById(state, defId);
      if (!isCharacterCard(def)) return false;
      // `mind` is read before the uniqueness test: the card types declare
      // `unique: true` as a literal, so a `!def.unique` guard narrows `def` to
      // `never` and any later field access fails to compile. The runtime value
      // of `unique` is still honoured by returning it last.
      if (def.mind === null || def.mind > 3) return false;
      return !def.unique;
    };
    for (const card of [...player.discardPile, ...player.sideboard]) {
      if (isLowMindNonUnique(card.definitionId)) candidateCards.push(card);
    }
  }

  if (avatarInPlay) {
    logDetail(`Avatar in play at site ${avatarSiteId as string} — character play restricted (rule 2.II.2.2)`);
  }

  // Per-player facts shared by every candidate's eligibility context.
  const playsAsSauron = playerPlaysAsSauron(state, player);
  // Sauron (ba-43): "there is no limit to the number of characters you may
  // bring into play" — a `no-character-play-limit` marker in play skips the
  // one-character-per-turn gate entirely.
  const noCharacterPlayLimit = playerHasNoCharacterPlayLimit(state, player);
  if (noCharacterPlayLimit) {
    logDetail('no-character-play-limit marker in play — one-character-per-turn limit lifted');
  }
  const agentsAreHazards = player.alignment === Alignment.Wizard || player.alignment === Alignment.Balrog;
  const playerAvatarEliminated = hasEliminatedAvatar(state, player);
  const opponentPlayer = state.players.find(p => p.id !== playerId);

  for (const handCard of candidateCards) {
    const cardInstanceId = handCard.instanceId;
    const cardDef = defById(state, handCard.definitionId);
    if (!isCharacterCard(cardDef)) continue;

    const charName = cardDef.name;
    const isAvatar = cardDef.mind === null;

    logDetail(`Evaluating play-character: ${charName} (mind ${cardDef.mind ?? 'avatar'}, DI ${cardDef.directInfluence})`);

    // CoE 2.II.2.2.F2: the Fallen-wizard Orc/Troll permission is precomputed
    // (rather than folded into the context inline) because a matching
    // permission may also unlock play at the player's own Wizardhavens —
    // A Strident Spawn (wh-61) lets Half-orcs be played at the player's
    // Wizardhavens even when the avatar is elsewhere; the per-site loop
    // below consumes that flag. (Half-orcs are race Orc.)
    const isFwOrcTroll = player.alignment === Alignment.FallenWizard
      && (cardDef.race === Race.Orc || cardDef.race === Race.Troll);
    const orcTrollPerm = isFwOrcTroll
      ? orcTrollPlayPermission(state, player, cardDef)
      : { permitted: true, atOwnWizardhavens: false };

    // An Unexpected Party (dm-114): companies carrying a matching
    // `company-character-play-exempt` / `company-influence-exempt` waive,
    // respectively, the one-character-per-turn limit and the influence cost for
    // this candidate. Both are per-company, so the sets are re-checked against
    // the company standing at each playable site below; here they only make the
    // pre-loop gates lenient enough that the per-site branch is reached.
    const playLimitExemptCompanies = new Set(
      player.companies
        .filter(c => companyExemptsCharacterFromPlayLimit(state, c.id, cardDef))
        .map(c => c.id as string),
    );
    const influenceExemptCompanies = new Set(
      player.companies
        .filter(c => companyExemptsCharacterFromInfluence(state, c.id, cardDef))
        .map(c => c.id as string),
    );
    const rawPlayLimitReached = noCharacterPlayLimit
      ? false
      : characterPlayLimitReached(phaseState, player.alignment, cardDef);

    // Sequential eligibility gates, evaluated declaratively against
    // CHARACTER_PLAY_RULES (rules/definitions/character-play.ts). The probe
    // action carries no site: it is surfaced only when blocked, so the client
    // can dim the card with the failure reason as a tooltip.
    const gate = evaluateAction(
      { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
      CHARACTER_PLAY_RULES,
      {
        card: {
          name: charName,
          isAvatar,
          isRingwraithAvatar: isAvatar && cardDef.race === Race.Ringwraith,
          isHazardAgentOnly: hasPlayFlag(cardDef, 'hazard-agent-only'),
          isAgent: isAgentCharacter(cardDef),
          unique: cardDef.unique,
          isOrcOrTroll: isFwOrcTroll,
        },
        ctx: {
          playsAsSauron,
          agentsAreHazards,
          characterPlayLimitReached: rawPlayLimitReached && playLimitExemptCompanies.size === 0,
          uniqueAlreadyInPlay: cardDef.unique && isUniqueCharacterInPlay(state, charName),
          blockingManifestation: blockingManifestationForCharacterPlay(state, cardDef),
          hasEliminatedAvatar: playerAvatarEliminated,
          mustReplayReturnedRingwraith: isAvatar && cardDef.race === Race.Ringwraith
            && player.ringwraithReturnedToHand !== undefined
            && cardDef.id !== player.ringwraithReturnedToHand,
          opponentReturnedThisRingwraith: isAvatar && cardDef.race === Race.Ringwraith
            && opponentPlayer?.ringwraithReturnedToHand === cardDef.id,
          fwOrcTrollPermitted: orcTrollPerm.permitted,
        },
      },
    );
    if (!gate.viable) {
      logDetail(`  → blocked: ${gate.reason}`);
      results.push(gate);
      continue;
    }
    const orcTrollAtWizardhavens = orcTrollPerm.atOwnWizardhavens;
    if (isFwOrcTroll) {
      logDetail(`  → Orc/Troll play permitted${orcTrollAtWizardhavens ? ' (and at own Wizardhavens regardless of avatar location)' : ''}`);
    }

    // Rule 2.II.2.1.1: a player who has revealed their avatar cannot play a
    // different avatar — except as a Ringwraith follower enabled by an
    // in-play ability (CoE 2.II.2.1.R4–R5, e.g. The Witch-king le-58).
    if (isAvatar && avatarInPlay && avatar) {
      results.push(ringwraithFollowerPlayAction(state, playerId, player, cardInstanceId, cardDef, avatar, avatarSiteId));
      continue;
    }

    // Recruitment vehicle in hand (Thrall of the Voice wh-82; Open to the
    // Summons wh-46). Detected before site selection because the agent-summons
    // variant (wh-46) widens an agent's playable sites to include Darkhavens.
    const vehicle = recruitmentVehicleInHand(state, player);
    // Open to the Summons (wh-46): a Ringwraith or Fallen-wizard may summon one
    // agent into a company at a Darkhaven, placing the card with the agent.
    const isAgentSummonsCandidate = !isAvatar
      && vehicle?.agentRecruit === true
      && isAgentCharacter(cardDef)
      && (player.alignment === Alignment.Ringwraith || player.alignment === Alignment.FallenWizard);

    // Saw Further and Deeper (dm-156): while it is in play, the player's avatar
    // may only be brought into play at its home site (no Rivendell reveal).
    const avatarHomeSiteOnly = isAvatar && playerHasAvatarHomeSiteRestriction(state, player);

    // Find valid sites (homesite or haven — from companies or site deck)
    // Note: findPlayableSites already handles home-site-only and avatar restrictions
    const playableSites = findPlayableSites(state, player, cardDef, avatarInPlay && !isAvatar, isAgentSummonsCandidate, avatarHomeSiteOnly);

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
        // Rule 3.07, same gate as the non-avatar branch below: a Ringwraith
        // avatar revealed into a company of non-Ringwraiths (or an avatar of
        // another race joining a Ringwraith's company) is illegal away from a
        // Darkhaven. The Ringwraith's own Darkhavens are exempt, so the normal
        // [R1] reveal at Minas Morgul / Dol Guldur is unaffected.
        const joined = companyAtSiteInstance(player, site.instanceId);
        if (joined
          && !isDarkhavenSiteDef(site.siteDef)
          && wouldViolateRingwraithComposition(state, [...joined.characters, cardInstanceId])) {
          logDetail(`  → skip ${site.siteName}: a Ringwraith's company may only hold other Ringwraiths away from a Darkhaven (rule 3.07)`);
          continue;
        }
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
      const recruitViaVehicle = vehicle !== undefined
        && vehicle.agentRecruit === false
        && player.alignment === Alignment.FallenWizard
        && charMind > 5
        && charMind <= vehicle.maxMind
        && cardDef.race !== Race.Orc
        && cardDef.race !== Race.Troll;
      // Open to the Summons (wh-46): the reduced cost applies only at Darkhavens
      // (computed per-site below). Thrall's reduction is site-independent.
      const summonsCostMind = Math.max(1, charMind - 1);
      const costMind = recruitViaVehicle ? Math.max(1, charMind - 1) : charMind;
      const recruitField = recruitViaVehicle && vehicle ? { viaRecruitmentInstanceId: vehicle.instanceId } : {};
      // Affordability gate below must use the *lowest* achievable cost so an
      // agent affordable only at its Darkhaven (mind − 1) is not filtered out by
      // the home-site cost (full mind).
      // An Unexpected Party (dm-114): where a `company-influence-exempt` company
      // is a possible destination the character costs nothing, so the pre-loop
      // affordability gate must not reject it on its printed mind.
      const minCostMind = influenceExemptCompanies.size > 0
        ? 0
        : (isAgentSummonsCandidate ? Math.min(costMind, summonsCostMind) : costMind);
      if (recruitViaVehicle) {
        logDetail(`  → recruitment vehicle available: ${charName} (mind ${charMind} → cost ${costMind}) may be brought in via Thrall of the Voice`);
      }
      if (isAgentSummonsCandidate) {
        logDetail(`  → agent-summons vehicle available: ${charName} (mind ${charMind}) may be summoned at a Darkhaven for cost ${summonsCostMind}`);
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

      const remainingGI = generalInfluenceControlLimit(state, playerId) - player.generalInfluenceUsed;
      // Gate on the lowest achievable cost (an agent summonable at a Darkhaven
      // pays mind − 1 there even if the full mind is unaffordable). Per-site
      // affordability is re-checked in the loop below.
      const canPlayUnderGI = minCostMind <= remainingGI;

      // Find characters with enough DI to control this character as a follower.
      // Only characters under general influence can take followers. The Balrog
      // (ba-3) "may not have any followers" — excluded even though he is under
      // general influence, unless a fána card such as Great Shadow (ba-62)
      // grants him the permission ("The Balrog gains ... and may have
      // followers", encoded as the `grants-followers` play-flag on an
      // attached item).
      const diControllers: { instanceId: CardInstanceId; name: string; availDI: number }[] = [];
      for (const [key, char] of characterEntries(player)) {
        if (char.controlledBy !== 'general') continue;
        const ctrlDef = resolveDef(state, char.instanceId);
        if (!isCharacterCard(ctrlDef)) continue;
        if (isBalrogAvatarDef(ctrlDef) && !hasFollowerGrantPermission(char.items, state.cardPool)) continue;
        const avail = availableDI(state, char.instanceId, player, cardDef);
        if (avail >= minCostMind) {
          diControllers.push({ instanceId: key, name: ctrlDef.name, availDI: avail });
        }
      }

      if (!canPlayUnderGI && diControllers.length === 0) {
        logDetail(`  → blocked: mind cost ${minCostMind} exceeds remaining GI (${remainingGI}) and no character has enough DI`);
        results.push({
          action: { type: 'play-character', player: playerId, characterInstanceId: cardInstanceId, atSite: '' as CardInstanceId, controlledBy: 'general' },
          viable: false,
          reason: `${charName}: mind ${minCostMind} exceeds remaining general influence (${remainingGI}) and no character has sufficient direct influence`,
        });
        continue;
      }

      // Generate viable actions for each (site, controlledBy) combination
      for (const site of playableSites) {
        // An Unexpected Party (dm-114): the company already standing at this
        // site is the one the character joins (see `handlePlayCharacter`), so
        // its bound exemptions decide both gates here. With the turn's single
        // character slot already spent, only an exempting company may still be
        // joined; a `company-influence-exempt` company costs nothing to join.
        const companyHere = companyAtSiteInstance(player, site.instanceId);
        const companyHereId = companyHere ? (companyHere.id as string) : undefined;
        // Rule 3.07: away from a Darkhaven, a Ringwraith's company may only hold
        // other Ringwraiths. Joining the company already standing here must not
        // create that mix — in either direction (a non-Ringwraith joining a
        // Ringwraith's company, or a Ringwraith joining anyone else's).
        if (companyHere
          && !isDarkhavenSiteDef(site.siteDef)
          && wouldViolateRingwraithComposition(state, [...companyHere.characters, cardInstanceId])) {
          logDetail(`  → skip ${site.siteName}: a Ringwraith's company may only hold other Ringwraiths away from a Darkhaven (rule 3.07)`);
          continue;
        }
        if (rawPlayLimitReached && (companyHereId === undefined || !playLimitExemptCompanies.has(companyHereId))) {
          logDetail(`  → skip ${site.siteName}: one-character-per-turn limit reached and no company there exempts ${charName}`);
          continue;
        }
        const influenceFreeHere = companyHereId !== undefined && influenceExemptCompanies.has(companyHereId);
        // Rule 2.II.2.2: with avatar in play, GI play only at avatar's site.
        // A Strident Spawn (wh-61) relaxes this for Half-orcs at the player's
        // own Wizardhavens ("even if your Fallen-wizard is not there").
        const isOwnWizardhaven = orcTrollAtWizardhavens
          && isHavenForPlayer(site.siteDef, player.alignment, { state, siteDefinitionId: site.siteDef.id, playerId });
        const giAllowedAtSite = !avatarInPlay || site.instanceId === avatarSiteId || isOwnWizardhaven;
        // Open to the Summons (wh-46): the agent is summoned *via the vehicle*
        // (card placed with it, mind − 1) only at a Darkhaven; at its home site
        // it is played normally at full mind with no vehicle attached.
        const summonHere = isAgentSummonsCandidate && isDarkhavenSiteDef(site.siteDef);
        const costHere = summonHere ? summonsCostMind : costMind;
        // The waiver applies to the general-influence branch only: a character
        // that "does not require influence to be controlled" is held under
        // general influence for free, never as somebody's direct-influence
        // follower at a discount.
        const giCostHere = influenceFreeHere ? 0 : costHere;
        const recruitFieldHere = summonHere && vehicle ? { viaRecruitmentInstanceId: vehicle.instanceId } : recruitField;
        // Bree (le-356) `allow-agent-play` grants direct-influence play only;
        // never offer the agent under general influence at such a site.
        if (site.directInfluenceOnly) {
          logDetail(`  → GI play skipped at ${site.siteName}: agent may only be played under direct influence here (allow-agent-play)`);
        }
        if (giCostHere <= remainingGI && giAllowedAtSite && !site.directInfluenceOnly) {
          logDetail(`  → viable: play under GI at ${site.siteName} (mind cost ${giCostHere}, remaining GI ${remainingGI})${influenceFreeHere ? ' — influence waived by a company-influence-exempt card' : ''}${recruitViaVehicle ? ' via recruitment vehicle' : ''}${summonHere ? ' via agent-summons at Darkhaven' : ''}`);
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: cardInstanceId,
              atSite: site.instanceId,
              controlledBy: 'general',
              ...recruitFieldHere,
            },
            viable: true,
          });
        }

        // DI followers must be played into the same company as the controller
        for (const ctrl of diControllers) {
          if (ctrl.availDI < costHere) continue;
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

          logDetail(`  → viable: play under DI of ${ctrl.name} (avail DI ${ctrl.availDI}, cost ${costHere}) at ${site.siteName}${summonHere ? ' via agent-summons at Darkhaven' : ''}`);
          results.push({
            action: {
              type: 'play-character',
              player: playerId,
              characterInstanceId: cardInstanceId,
              atSite: site.instanceId,
              controlledBy: ctrl.instanceId,
              ...recruitFieldHere,
            },
            viable: true,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Computes discard-character actions during the organization phase.
 *
 * CoE rule 3.22: the resource player can only discard a character while
 * organizing if that character is not an avatar and is at a haven or its
 * home site. Offered for every qualifying character in every company of the
 * player; the discard itself (possessions, followers, influence release) is
 * handled by the reducer.
 *
 * CoE rule 2.II.2: playing or discarding a character is the *same* once-per-
 * turn organizing action — so a discard is gated by
 * `characterPlayLimitReached` exactly like a play, reusing the play-side
 * exceptions (Sauron's unlimited plays, the Balrog's second non-unique
 * action).
 */
export function discardCharacterActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const phaseState = requirePhaseState(state, Phase.Organization);
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];
  const noCharacterPlayLimit = playerHasNoCharacterPlayLimit(state, player);

  for (const company of player.companies) {
    if (!company.currentSite) continue;
    const siteDef = resolveDef(state, company.currentSite.instanceId);
    if (!isSiteCard(siteDef)) continue;

    // A site converted into a Wizardhaven (Hidden Haven, wh-75) counts as a
    // haven for the converting Fallen-wizard, same as in playCharacterActions.
    const isHaven = isHavenForPlayer(siteDef, player.alignment, {
      state, siteDefinitionId: company.currentSite.definitionId, playerId,
    });

    for (const charInstId of company.characters) {
      const char = player.characters[charInstId];
      if (!char) continue;
      const charDef = resolveDef(state, char.instanceId);
      if (!isCharacterCard(charDef)) continue;
      if (isAvatarCharacter(charDef)) {
        logDetail(`  discard-character: ${charDef.name} is an avatar — cannot be discarded (rule 3.22)`);
        continue;
      }
      if (!isHaven && !homesiteMatchesSite(state, charDef, siteDef, player.alignment)) {
        logDetail(`  discard-character: ${charDef.name} at ${siteDef.name} — neither a haven nor its home site (rule 3.22)`);
        continue;
      }
      if (!noCharacterPlayLimit && characterPlayLimitReached(phaseState, player.alignment, charDef)) {
        logDetail(`  discard-character: ${charDef.name} — already played/discarded a character this turn (rule 2.II.2)`);
        continue;
      }
      logDetail(`  → viable: discard ${charDef.name} at ${siteDef.name} (${isHaven ? 'haven' : 'home site'})`);
      actions.push({
        action: { type: 'discard-character', player: playerId, characterInstanceId: charInstId },
        viable: true,
      });
    }
  }

  return actions;
}
