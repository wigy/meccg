/**
 * @module actions-site
 *
 * Action types for the Site phase.
 *
 * During the Site phase, companies enter sites to play resources (items,
 * allies, factions), face automatic attacks and on-guard hazards, and
 * attempt influence against opponent characters. These actions cover
 * entering sites, managing on-guard cards, playing resources, and
 * conducting influence attempts.
 */

import type { PlayerId, CardInstanceId, CompanyId } from './common.js';

/**
 * Declare that a company will enter its current site during the site phase.
 *
 * The alternative is to pass (do nothing), which ends the company's site
 * phase immediately. Entering commits the company to facing automatic
 * attacks, on-guard creatures, and agent attacks before any resources
 * can be played. (CoE lines 341–343)
 */
export interface EnterSiteAction {
  /** Action discriminant. */
  readonly type: 'enter-site';
  /** The resource player entering the site. */
  readonly player: PlayerId;
  /** The company entering its current site. */
  readonly companyId: CompanyId;
}

/**
 * Place a card face-down as an on-guard card at the active company's site
 * during the Movement/Hazard phase.
 *
 * Any card in the hazard player's hand may be placed on-guard (bluffing is
 * allowed). Only one on-guard placement per company per M/H phase.
 * Counts against the hazard limit.
 */
export interface PlaceOnGuardAction {
  /** Action discriminant. */
  readonly type: 'place-on-guard';
  /** The hazard player placing the on-guard card. */
  readonly player: PlayerId;
  /** The card instance being placed face-down. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Reveal an on-guard card placed on a company's site during the site phase.
 *
 * Used at two points:
 * - Step 1 (CoE line 345): when entering a site with automatic-attacks,
 *   the hazard player may reveal creatures keyed to the site or events
 *   affecting the automatic-attacks.
 * - During resource play (CoE line 376): when the resource player
 *   attempts to play a resource that taps the site, the hazard player
 *   may reveal an on-guard event that directly affects the company.
 */
export interface RevealOnGuardAction {
  /** Action discriminant. */
  readonly type: 'reveal-on-guard';
  /** The hazard player revealing the on-guard card. */
  readonly player: PlayerId;
  /** The on-guard card instance being revealed. */
  readonly cardInstanceId: CardInstanceId;
  /** Target character for hazard events "playable on a character" (e.g. Foolish Words). */
  readonly targetCharacterId?: CardInstanceId;
}

/**
 * Tap a character to cancel the next automatic-attack at the company's
 * current site (CRF Site Phase, Automatic-attacks: "Any character may tap
 * to cancel one automatic-attack at his home site.").
 *
 * Only offered during the `automatic-attacks` step, before that attack's
 * combat has been initiated, for an untapped character in the active
 * company whose `homesite` includes the current site's exact name (a
 * type-based homesite like "Any Dark-hold" never matches a real site name,
 * satisfying the CRF carve-out that the home site must be named). The
 * canceled attack still counts as faced — it is not the same as removing
 * an automatic-attack from the site, which cannot be done this way.
 */
export interface CancelAutoAttackAction {
  /** Action discriminant. */
  readonly type: 'cancel-auto-attack';
  /** The resource player tapping their character. */
  readonly player: PlayerId;
  /** The home-site character being tapped to cancel the attack. */
  readonly characterId: CardInstanceId;
}

/**
 * Declare a burglary attempt (Burglary, td-103): tap a character and the
 * site to attempt burglary "in lieu of facing" the site's automatic-attacks.
 *
 * Only offered during the `automatic-attacks` step before any attack has
 * been faced (`automaticAttacksResolved === 0`) and before any burglary
 * attempt or skip is already in effect this slot, for an untapped character
 * in the active company while the Burglary card is in hand. Tapping the
 * character and site happens immediately; the roll itself is a separate
 * `burglary-attempt` pending resolution so a future on-guard interaction
 * (e.g. Half an Eye Open, td-29) can modify it before it resolves.
 */
export interface DeclareBurglaryAction {
  /** Action discriminant. */
  readonly type: 'declare-burglary';
  /** The resource player declaring the attempt. */
  readonly player: PlayerId;
  /** The Burglary card instance being played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The character attempting the burglary. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Execute the dice roll for a declared burglary attempt (Burglary, td-103).
 *
 * Created by the pending-resolution system once `declare-burglary` taps the
 * character and site. The player rolls 2d6, modified by +2 if the character
 * is a Scout and +3 if he is a Hobbit. If the total is greater than 10, the
 * company's automatic-attacks are skipped entirely and an item normally
 * playable at the site may be played with the (tapped) character. If not,
 * the character must face all of the site's automatic-attacks alone, with
 * no combat support from the rest of his company.
 */
export interface BurglaryAttemptRollAction {
  /** Action discriminant. */
  readonly type: 'burglary-attempt';
  /** The resource player (who rolls). */
  readonly player: PlayerId;
  /** The character making the burglary attempt. */
  readonly characterInstanceId: CardInstanceId;
  /** roll >= need means success (already accounts for scout/Hobbit bonuses). */
  readonly need: number;
  /** Human-readable breakdown of the check. */
  readonly explanation: string;
}

/**
 * Play a hazard creature from the hazard player's hand as the site's
 * automatic-attack. Used at sites with a `site-rule: dynamic-auto-attack`
 * effect (e.g. Framsburg td-175).
 *
 * The creature is taken from the hazard player's hand and initiates combat
 * using its own prowess/strikes/body. After combat resolves, the creature
 * is placed in the hazard player's discard pile regardless of outcome
 * (the resource player does not gain kill-MP for defeating a
 * played-auto-attack creature).
 *
 * Only offered when the step is `play-site-auto-attack` and the creature's
 * keying satisfies the site's filter. Follows the Step 2 auto-attack
 * window in the CoE site phase.
 */
export interface PlaySiteAutoAttackAction {
  /** Action discriminant. */
  readonly type: 'play-site-auto-attack';
  /** The hazard player playing the creature. */
  readonly player: PlayerId;
  /** The hazard-creature card instance in the hazard player's hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Attempt to rescue prisoners held at the active company's current site
 * (CoE rule 8.36). The rescuing company must face the host's rescue-attack —
 * for Troll-purse (dm-95) this is the site's automatic-attacks at the time of
 * rescue — and on surviving it, the held prisoners are freed back into the
 * company. Held prisoners are protected from strike assignment during the
 * rescue-attack (they are captive, not fighting).
 */
export interface RescuePrisonerAction {
  /** Action discriminant. */
  readonly type: 'rescue-prisoner';
  /** The active (rescuing) player. */
  readonly player: PlayerId;
  /** The hazard host (e.g. Troll-purse) whose prisoners are being rescued. */
  readonly hostInstanceId: CardInstanceId;
}

/**
 * Declare that an agent hazard at the company's site will attack.
 *
 * Step 3 of entering a site (CoE line 358). The agent must be revealed
 * when the attack is declared if not already revealed. An agent can
 * only attack once per site phase. Agent attacks are not keyed to anything.
 */
export interface DeclareAgentAttackAction {
  /** Action discriminant. */
  readonly type: 'declare-agent-attack';
  /** The hazard player declaring the agent attack. */
  readonly player: PlayerId;
  /** The agent card instance that will attack. */
  readonly agentInstanceId: CardInstanceId;
  /**
   * For face-down agents: the home site instance to place with the agent when
   * it is revealed at declaration time (rule 9.04). If absent, the agent is
   * revealed without a home site and will be discarded at end of turn.
   * Omitted for already-revealed (face-up) agents.
   */
  readonly homeSiteInstanceId?: CardInstanceId;
  /**
   * When `true`, the agent taps as part of declaring the attack to gain an
   * extra strike (2 strikes instead of 1). Only legal for an untapped agent
   * whose card carries an `agent-attack-modifier` effect with
   * `tapForExtraStrike` (Elerína dm-7: "Agent only: may tap for an extra
   * strike").
   */
  readonly tapForExtraStrike?: boolean;
}

/**
 * Play a hero resource card (item, ally, or event) at the current site.
 *
 * Resources are the primary way to score marshalling points. The resource
 * must be playable at the company's current site type. Only one "major"
 * resource can typically be played per company per site phase.
 */
export interface PlayHeroResourceAction {
  readonly type: 'play-hero-resource';
  /** The active player playing the resource. */
  readonly player: PlayerId;
  /** The resource card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The company at the site where the resource is being played. */
  readonly companyId: CompanyId;
  /** For items, the character who will carry the item. */
  readonly attachToCharacterId?: CardInstanceId;
  /**
   * When `true`, the card is sourced from the player's discard pile instead of
   * the hand. Enabled by an in-play `grant-ally-play` effect with
   * `fromDiscard` (Glove of Radagast wh-111): a granted ally may be played from
   * the discard pile.
   */
  readonly fromDiscard?: boolean;
  /**
   * When set, the ally is being played through a player-scoped, Wizardhaven-keyed
   * `grant-ally-play` permission (An Untimely Brood wh-62) whose
   * `oncePerSitePhase` limit applies. Carries the instance id of the granting
   * permanent-event so the reducer can record the turn-scoped once-per-phase
   * lock against it.
   */
  readonly viaWizardhavenAllyGrant?: CardInstanceId;
  /**
   * When `true`, the item is sourced from a set-aside slot (`setAsideHost`)
   * instead of the hand — Great Secrets Buried There (dm-63): "Opponent may
   * play this item as though it were in his hand at any Under-deeps site
   * where it could be normally playable." Only offered at an Under-deeps site
   * for the item's owner; the card is found by searching both players'
   * `cardsInPlay` (its host may belong to either player) rather than `hand`.
   */
  readonly fromSetAside?: boolean;
}

/**
 * Attempt to influence a faction card using a character's influence.
 *
 * The influencing character rolls 2d6 and must meet or exceed the faction's
 * influence number, modified by the character's direct influence and any
 * racial bonuses. Success brings the faction under the player's control
 * for marshalling points.
 */
export interface InfluenceAttemptAction {
  readonly type: 'influence-attempt';
  /** The active player making the attempt. */
  readonly player: PlayerId;
  /** The faction card instance being played from hand. */
  readonly factionInstanceId: CardInstanceId;
  /** The character making the influence roll. */
  readonly influencingCharacterId: CardInstanceId;
  /** The unmodified 2d6 value needed for success (roll + modifiers >= influence #). */
  readonly need: number;
  /** Human-readable breakdown of the target number, DI, and bonuses. */
  readonly explanation: string;
  /**
   * For LE "Orcs of Udûn"-style factions (`leader-control` effect): when true,
   * the influencing character — an eligible Orc or Troll leader — takes the
   * faction under its control on success, leaving the site untapped. The
   * legal-action generator emits this variant alongside the normal attempt so
   * the player may choose. See {@link LeaderControlEffect}.
   */
  readonly placeUnderLeaderControl?: boolean;
  /**
   * For Dragons "Roused" factions (`influence-modification` effect): an optional
   * paid modification. When present, the influencing character discards the
   * named carried item on declare and the influence roll gains `value`. The
   * legal-action generator emits one such variant per eligible carried item;
   * `need` is already reduced by `value`. See {@link InfluenceModificationEffect}.
   */
  readonly discardForBonus?: {
    /** The carried item the influencing character discards as the cost. */
    readonly itemInstanceId: CardInstanceId;
    /** The influence-check modifier gained by paying this discard. */
    readonly value: number;
  };
}

/**
 * Declare an influence attempt against an opponent's in-play character, ally,
 * or faction.
 *
 * The resource player taps one of their untapped characters to attempt to
 * influence away an opponent's card at the same site. This triggers a
 * two-roll resolution: the attacker rolls first, then the defender rolls.
 * The attacker's roll is modified by their unused DI, minus the opponent's
 * unused GI, minus the defender's roll, minus the controller's unused DI
 * (characters/allies only). For factions the comparison value is the
 * faction's in-play influence number (see CoE rule 8.3, line 1352).
 *
 * CoE rules section 8 (general influence rules) and section 10 (tournament
 * rulings 10.10–10.12).
 */
export interface OpponentInfluenceAttemptAction {
  readonly type: 'opponent-influence-attempt';
  /** The resource player making the influence attempt. */
  readonly player: PlayerId;
  /** The untapped character being tapped to make the attempt. */
  readonly influencingCharacterId: CardInstanceId;
  /** The opponent player whose card is being targeted. */
  readonly targetPlayer: PlayerId;
  /** The instance ID of the opponent's card being influenced. */
  readonly targetInstanceId: CardInstanceId;
  /** Whether the target is a character, ally, faction, or item. */
  readonly targetKind: 'character' | 'ally' | 'faction' | 'item';
  /**
   * Optional: instance ID of an identical card revealed from hand.
   * When set, the comparison value (target mind) is treated as 0.
   * The revealed card is removed from hand regardless of outcome;
   * on failure it goes to the discard pile.
   *
   * CoE rule 10.11: "the resource player may reveal an identical resource
   * card in their hand (of any alignment)".
   */
  readonly revealedCardInstanceId?: CardInstanceId;
  /** Human-readable breakdown of modifiers for the influence check. */
  readonly explanation: string;
}

/**
 * The hazard player rolls their defensive dice for an opponent influence attempt.
 *
 * After the resource player has rolled their attack dice, the hazard player
 * rolls 2d6 which is subtracted from the attacker's modified result.
 * The final result is then compared to the target's mind value.
 *
 * CoE rules section 10, rule 10.12 step 4.
 */
export interface OpponentInfluenceDefendAction {
  readonly type: 'opponent-influence-defend';
  /** The hazard player rolling the defensive dice. */
  readonly player: PlayerId;
  /** Human-readable breakdown of the influence check so the defender knows the situation before rolling. */
  readonly explanation: string;
}

/**
 * Execute the dice roll for a faction influence attempt.
 *
 * Created by the pending-resolution system after the chain of effects
 * has fully resolved. The game pauses so the UI can display a situation
 * banner with the target number, DI, and all modifiers before the player
 * commits to rolling.
 */
export interface FactionInfluenceRollAction {
  readonly type: 'faction-influence-roll';
  /** The resource player rolling. */
  readonly player: PlayerId;
  /** The faction card being influenced. */
  readonly factionInstanceId: CardInstanceId;
  /** The character making the influence roll. */
  readonly influencingCharacterId: CardInstanceId;
  /** The 2d6 value needed for success (roll + modifiers >= influence #). */
  readonly need: number;
  /** Human-readable breakdown of the target number, DI, and bonuses. */
  readonly explanation: string;
}

/**
 * Play a minor item on a character without requiring a specific site type.
 *
 * Minor items have relaxed play conditions compared to major/greater items.
 * They can sometimes be played as a "bonus" action that doesn't count as
 * the company's resource play for the phase.
 */
/**
 * Cancel an opponent's influence check by playing a cancel-influence card
 * from hand. The influence attempt is automatically canceled (no defensive
 * roll needed). The character who pays the cost makes a corruption check.
 *
 * Played during the opponent's site phase while an
 * `opponent-influence-defend` pending resolution is queued.
 */
export interface CancelInfluenceAction {
  readonly type: 'cancel-influence';
  /** The defending player canceling the influence attempt. */
  readonly player: PlayerId;
  /** The cancel-influence card played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The character paying the cost (e.g. the wizard). */
  readonly characterId: CardInstanceId;
}

export interface PlayMinorItemAction {
  readonly type: 'play-minor-item';
  /** The active player playing the minor item. */
  readonly player: PlayerId;
  /** The minor item card instance to play from hand. */
  readonly cardInstanceId: CardInstanceId;
  /** The character at the site (used for proximity validation). */
  readonly characterId: CardInstanceId;
  /** The character who will carry the minor item. */
  readonly attachToCharacterId: CardInstanceId;
}

/**
 * Hazard player selects which automatic attack to retain during the
 * `forewarned-select-attack` step, which is inserted before
 * `automatic-attacks` when *Forewarned Is Forearmed* is in play and the
 * company's site has more than one automatic attack.
 *
 * The chosen attack index corresponds to the position in the site's
 * `automaticAttacks` array (after Dragon-lair filtering). Only the
 * selected attack is then initiated during `automatic-attacks`; the rest
 * are discarded (the resource player never faces them).
 */
export interface SelectForewarnedAttackAction {
  /** Action discriminant. */
  readonly type: 'select-forewarned-attack';
  /** The hazard player making the selection. */
  readonly player: PlayerId;
  /** Zero-based index into the site's active automatic-attacks array. */
  readonly attackIndex: number;
}

/**
 * Declare that the active company will attack an opponent's company at the
 * same site (Company vs Company Combat, CvCC).
 *
 * Legal at the end of the site phase (after play-resources) when:
 * - The resource player's company has entered the site (siteEntered === true).
 * - The opponent has a company at the same site.
 * - No influence attempt or CvCC attack has occurred this turn (opponentInteractionThisTurn === null).
 * - Alignment restrictions are satisfied (CoE rule 8.41).
 *
 * After declaration, opponentInteractionThisTurn is set to 'attack' and
 * the combat sub-state machine is initiated with isCvCC: true.
 *
 * CoE rule 8.38–8.41.
 */
export interface DeclareCompanyAttackAction {
  /** Action discriminant. */
  readonly type: 'declare-company-attack';
  /** The resource (active) player declaring the attack. */
  readonly player: PlayerId;
  /** The attacking company (the resource player's company entering the site). */
  readonly attackingCompanyId: CompanyId;
  /** The target company (the opponent's company at the same site). */
  readonly targetCompanyId: CompanyId;
}

/**
 * Tap one character to pay the Eddy in Fate's Tide (ba-57) site tax during the
 * play-resources step. Eddy's text: "Before a company can play any ally or item
 * at any version of this site, it must tap two characters during the site
 * phase." Each `pay-site-tax` taps one untapped character in the active company
 * and increments {@link SitePhaseState.eddyTaxTapped}; item and ally plays at the
 * bound site are gated until the count reaches the bound card's
 * `taxTapCharacters`.
 */
export interface PaySiteTaxAction {
  /** Action discriminant. */
  readonly type: 'pay-site-tax';
  /** The active player paying the tax. */
  readonly player: PlayerId;
  /** The untapped character in the active company to tap. */
  readonly characterId: CardInstanceId;
}

/**
 * Resolve an `influence-reveal-play-offer` pending resolution (CoE 10.13) by
 * playing the identical card that was revealed for a successful influence
 * attempt, with the influencing character.
 *
 * The play is free of the costs and gates a normal play would carry: the site
 * is not tapped, no second influence check is made, and the card's own
 * playability restrictions do not apply (an item needs no `playableAt` match,
 * a character no matching home site — "a Hobbit may be played in this way").
 *
 * Where the card lands follows from its type: an item or ally attaches to the
 * influencing character, a character joins that character's company, and a
 * faction enters play under its controller. Declining the offer is a `pass`,
 * which leaves the revealed card in hand.
 */
export interface PlayRevealedCardAction {
  /** Action discriminant. */
  readonly type: 'play-revealed-card';
  /** The player who made the successful influence attempt. */
  readonly player: PlayerId;
  /** The revealed card instance, played from hand. */
  readonly cardInstanceId: CardInstanceId;
  /**
   * For a revealed **character** only — how it is controlled. Influence is the
   * one requirement rule 10.13 does not waive, so the character must be
   * affordable under general influence or under the direct influence of a
   * character in the influencer's company. Absent for items, allies and
   * factions, which cost no influence to bring in this way.
   */
  readonly controlledBy?: 'general' | CardInstanceId;
}
